"""Bake the whole atlas into one JSON file.

GitHub Pages is static hosting, so there is no FastAPI process there. The
dataset is small enough (~600 change points) that the entire thing fits in a
single payload the browser can do the forward-fill and windowing on — the same
work `series.py` does server-side.
"""

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from .releases import compute_handoffs
from .routers.catalog import _MEMBER_FIELDS


def build_payload(conn: sqlite3.Connection, ratio: tuple[float, float]) -> dict:
    run = conn.execute(
        "SELECT ledger_as_of, finished_at FROM ingest_runs "
        "WHERE status = 'ok' ORDER BY id DESC LIMIT 1"
    ).fetchone()

    rows = conn.execute(
        f"SELECT fm.family_key, {_MEMBER_FIELDS} "
        "FROM family_members fm JOIN models m ON m.id = fm.model_id "
        "ORDER BY fm.family_key, fm.is_variant, fm.ordinal"
    ).fetchall()
    grouped: dict[str, list] = {}
    for r in rows:
        grouped.setdefault(r["family_key"], []).append(r)

    def member(r) -> dict:
        return {
            "model_id": r["id"],
            "name": r["name"],
            "ordinal": r["ordinal"],
            "is_variant": bool(r["is_variant"]),
            "release_date": r["release_date"],
            "first_seen": r["first_seen"],
            "last_seen": r["last_seen"],
            "present_now": bool(r["present_now"]),
            "date_is_censored": bool(r["date_is_censored"]),
        }

    families = []
    for f in conn.execute("SELECT key, label, vendor, grp FROM families ORDER BY grp, key"):
        entries = [member(r) for r in grouped.get(f["key"], [])]
        families.append(
            {
                "key": f["key"],
                "label": f["label"],
                "vendor": f["vendor"],
                "group": f["grp"],
                "members": [e for e in entries if not e["is_variant"]],
                "variants": [e for e in entries if e["is_variant"]],
            }
        )

    # Raw change points, not per-metric series: the client picks the metric,
    # blends and clips, exactly as the API does.
    models: dict[str, dict] = {}
    for r in conn.execute(
        "SELECT id, name, vendor, first_seen, last_seen, present_now FROM models ORDER BY id"
    ):
        models[r["id"]] = {
            "name": r["name"],
            "vendor": r["vendor"],
            "first_day": r["first_seen"],
            "last_day": r["last_seen"],
            "present_now": bool(r["present_now"]),
            "points": [],
        }
    for r in conn.execute(
        "SELECT model_id, day, prompt_per_m, completion_per_m FROM price_points "
        "ORDER BY model_id, day"
    ):
        if r["model_id"] in models:
            models[r["model_id"]]["points"].append(
                [r["day"], r["prompt_per_m"], r["completion_per_m"]]
            )

    bounds = conn.execute("SELECT MIN(day) AS lo, MAX(day) AS hi FROM price_points").fetchone()
    w_in, w_out = ratio

    return {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ledger_as_of": run["ledger_as_of"] if run else None,
        "last_ingest": run["finished_at"] if run else None,
        "model_count": len(models),
        "blend_ratio": {"input": w_in, "output": w_out},
        "window": {"from": bounds["lo"], "to": bounds["hi"]},
        "families": families,
        "handoffs": [
            {
                "family_key": h.family_key,
                "prev_id": h.prev_id,
                "next_id": h.next_id,
                "prev_name": h.prev_name,
                "next_name": h.next_name,
                "launch_date": h.launch_date,
                "prev_price": h.prev_price,
                "next_price": h.next_price,
                "delta_pct": h.delta_pct,
                "direction": h.direction,
                "kind": h.kind,
            }
            for h in compute_handoffs(conn, ratio)
        ],
        "models": models,
    }


def write_payload(conn: sqlite3.Connection, ratio: tuple[float, float], out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = build_payload(conn, ratio)
    out.write_text(json.dumps(payload, separators=(",", ":")))
    return out
