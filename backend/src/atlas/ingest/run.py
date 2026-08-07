import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from ..config import settings
from ..db import connect, migrate, transaction
from . import fetch, parse
from .families import Roster, load_roster, validate_against_ledger


@dataclass
class IngestResult:
    ledger_as_of: str
    models_seen: int
    points_written: int
    families: int
    skipped: bool = False  # both sources 304 and the DB already has data

    def summary(self) -> str:
        if self.skipped:
            return f"no change upstream (ledger as of {self.ledger_as_of}); nothing to do"
        return (
            f"ingested {self.models_seen} models / {self.points_written} price points "
            f"across {self.families} families (ledger as of {self.ledger_as_of})"
        )


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def ingest(
    conn: sqlite3.Connection | None = None,
    *,
    roster: Roster | None = None,
    ledger_path: Path | None = None,
    snapshot_path: Path | None = None,
    force: bool = False,
) -> IngestResult:
    """Idempotent. The ledger is authoritative: each run replaces a model's
    price points wholesale rather than appending."""
    owns_conn = conn is None
    conn = conn or connect()
    try:
        migrate(conn)
        roster = roster or load_roster(settings.families_file)

        run_id = conn.execute(
            "INSERT INTO ingest_runs (started_at, status) VALUES (?, 'running')", (_now(),)
        ).lastrowid
        conn.commit()

        try:
            ledger_fetch = (
                fetch.load_local(ledger_path)
                if ledger_path
                else fetch.fetch_json(settings.ledger_url, settings.cache_dir)
            )
            snapshot_fetch = (
                fetch.load_local(snapshot_path)
                if snapshot_path
                else fetch.fetch_json(settings.snapshot_url, settings.cache_dir)
            )
            ledger = ledger_fetch.payload
            as_of = ledger.get("as_of", "")
            ledger_models = ledger.get("models", {})

            # Validate before considering the skip: families.yaml changes
            # independently of upstream, so a roster edit that names a model the
            # ledger doesn't have must still fail loudly even when both fetches
            # came back 304.
            validate_against_ledger(roster, ledger_models)

            has_data = conn.execute("SELECT COUNT(*) AS n FROM models").fetchone()["n"] > 0
            roster_matches_db = has_data and _roster_matches(conn, roster)
            if (
                not force
                and roster_matches_db
                and ledger_fetch.from_cache
                and snapshot_fetch.from_cache
            ):
                result = IngestResult(as_of, 0, 0, 0, skipped=True)
                _finish(conn, run_id, as_of, 0, 0, "ok")
                return result

            rows = parse.build_rows(ledger, parse.index_snapshot(snapshot_fetch.payload), roster.ids)

            with transaction(conn):
                points = _write_models(conn, rows)
                _write_families(conn, roster)

            result = IngestResult(as_of, len(rows), points, len(roster.families))
            _finish(conn, run_id, as_of, len(rows), points, "ok")
            return result

        except Exception as exc:
            _finish(conn, run_id, None, None, None, "failed", str(exc))
            raise
    finally:
        if owns_conn:
            conn.close()


def _roster_matches(conn: sqlite3.Connection, roster: Roster) -> bool:
    """True when the database already reflects this exact roster. A YAML edit
    that adds or drops a model must force a rebuild even if upstream is
    unchanged."""
    stored = {r["id"] for r in conn.execute("SELECT id FROM models")}
    if stored != set(roster.ids):
        return False
    stored_families = {r["key"] for r in conn.execute("SELECT key FROM families")}
    if stored_families != {f.key for f in roster.families}:
        return False
    stored_forks = {
        (r["from_id"], r["to_id"]) for r in conn.execute("SELECT from_id, to_id FROM forks")
    }
    declared_forks = {(f.from_id, t) for f in roster.forks for t in f.to_ids}
    return stored_forks == declared_forks


def _write_models(conn: sqlite3.Connection, rows: list[parse.ModelRow]) -> int:
    points_written = 0
    for row in rows:
        conn.execute(
            """
            INSERT INTO models (id, name, vendor, release_date, first_seen, last_seen,
                                present_now, date_is_censored, context_length, modality,
                                is_reasoning, cache_read_per_m, cache_write_per_m,
                                web_search_per_call)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              name=excluded.name, vendor=excluded.vendor, release_date=excluded.release_date,
              first_seen=excluded.first_seen, last_seen=excluded.last_seen,
              present_now=excluded.present_now, date_is_censored=excluded.date_is_censored,
              context_length=excluded.context_length, modality=excluded.modality,
              is_reasoning=excluded.is_reasoning, cache_read_per_m=excluded.cache_read_per_m,
              cache_write_per_m=excluded.cache_write_per_m,
              web_search_per_call=excluded.web_search_per_call
            """,
            (
                row.id, row.name, row.vendor, row.release_date, row.first_seen, row.last_seen,
                int(row.present_now), int(row.date_is_censored), row.context_length, row.modality,
                None if row.is_reasoning is None else int(row.is_reasoning),
                row.cache_read_per_m, row.cache_write_per_m, row.web_search_per_call,
            ),
        )
        conn.execute("DELETE FROM price_points WHERE model_id = ?", (row.id,))
        conn.executemany(
            "INSERT INTO price_points (model_id, day, prompt_per_m, completion_per_m) "
            "VALUES (?,?,?,?)",
            [(row.id, day, prompt, completion) for day, prompt, completion in row.points],
        )
        points_written += len(row.points)

    # Drop models that fell out of the roster, so re-running after a YAML edit
    # leaves no orphans behind.
    keep = {row.id for row in rows}
    stale = [r["id"] for r in conn.execute("SELECT id FROM models") if r["id"] not in keep]
    conn.executemany("DELETE FROM models WHERE id = ?", [(mid,) for mid in stale])
    return points_written


def _write_families(conn: sqlite3.Connection, roster: Roster) -> None:
    conn.execute("DELETE FROM forks")
    conn.execute("DELETE FROM family_members")
    conn.execute("DELETE FROM families")
    for fork in roster.forks:
        conn.executemany(
            "INSERT INTO forks (from_id, to_id, ordinal) VALUES (?,?,?)",
            [(fork.from_id, to_id, i) for i, to_id in enumerate(fork.to_ids)],
        )
    for fam in roster.families:
        conn.execute(
            "INSERT INTO families (key, label, vendor, grp) VALUES (?,?,?,?)",
            (fam.key, fam.label, fam.vendor, fam.group),
        )
        for ordinal, model_id in enumerate(fam.members):
            conn.execute(
                "INSERT INTO family_members (family_key, model_id, ordinal, is_variant) "
                "VALUES (?,?,?,0)",
                (fam.key, model_id, ordinal),
            )
        # Variants sit outside the generational sequence; they share the family
        # but must never take part in handoff pairing.
        for offset, model_id in enumerate(fam.variants):
            conn.execute(
                "INSERT INTO family_members (family_key, model_id, ordinal, is_variant) "
                "VALUES (?,?,?,1)",
                (fam.key, model_id, len(fam.members) + offset),
            )


def _finish(conn, run_id, as_of, models, points, status, error=None) -> None:
    conn.execute(
        "UPDATE ingest_runs SET finished_at=?, ledger_as_of=?, models_seen=?, "
        "points_written=?, status=?, error=? WHERE id=?",
        (_now(), as_of, models, points, status, error, run_id),
    )
    conn.commit()
