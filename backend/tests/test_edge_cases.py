"""Gotchas from §1.3 that the live roster cannot exercise on its own.

Every model in the seed roster is currently live, so a retired model has to be
constructed here to prove the right-clip actually stops the line.
"""

import json

import pytest

from atlas.ingest.families import FamilyConfigError, load_roster
from atlas.ingest.parse import collapse_to_days
from atlas.ingest.run import ingest
from atlas.releases import compute_handoffs
from atlas.series import series_for, snapshot_on

from .conftest import BLEND

SYNTHETIC_LEDGER = {
    "as_of": "2026-08-06",
    "model_count": 4,
    "models": {
        "acme/live-1": {
            "name": "Acme: Live 1",
            "first_seen": "2025-01-01",
            "last_seen": "2026-08-06",
            "present_now": True,
            "points": [["2025-01-01", 10.0, 30.0]],
        },
        "acme/retired-1": {
            "name": "Acme: Retired 1",
            "first_seen": "2025-01-01",
            "last_seen": "2025-06-30",
            "present_now": False,
            "points": [["2025-01-01", 4.0, 8.0], ["2025-03-01", 2.0, 6.0]],
        },
        "acme/unpriced-1": {
            "name": "Acme: Unpriced 1",
            "first_seen": "2025-02-01",
            "last_seen": "2026-08-06",
            "present_now": True,
            "points": [["2025-02-01", None, None], ["2025-04-01", 1.0, 2.0]],
        },
        "acme/censored-1": {
            "name": "Acme: Censored 1",
            "first_seen": "2024-09-21",
            "last_seen": "2026-08-06",
            "present_now": True,
            "points": [["2024-09-21", 5.0, 5.0]],
        },
    },
}

SYNTHETIC_YAML = """
meta:
  blend_ratio: {input: 3, output: 1}
families:
  - key: acme
    label: "Acme"
    vendor: Acme
    group: frontier-us
    members: [acme/retired-1, acme/live-1]
    variants: [acme/unpriced-1]
  - key: acme-censored
    label: "Acme Censored"
    vendor: Acme
    group: eu
    members: [acme/censored-1]
"""


@pytest.fixture
def synthetic(tmp_path, blank_db):
    ledger = tmp_path / "prices.json"
    ledger.write_text(json.dumps(SYNTHETIC_LEDGER))
    snapshot = tmp_path / "output.json"
    snapshot.write_text(json.dumps({"data": []}))
    config = tmp_path / "families.yaml"
    config.write_text(SYNTHETIC_YAML)

    ingest(
        blank_db,
        roster=load_roster(config),
        ledger_path=ledger,
        snapshot_path=snapshot,
    )
    return blank_db


def test_retired_model_line_stops_at_last_seen(synthetic):
    """§1.3(2) — a dead model must not run to today."""
    series = series_for(synthetic, ["acme/retired-1"], "prompt", BLEND)[0]
    assert series.last_day == "2025-06-30"

    rows = {r["model_id"]: r for r in snapshot_on(synthetic, "2025-12-01", BLEND)}
    assert rows["acme/retired-1"]["live"] is False
    assert rows["acme/retired-1"]["prompt"] is None

    # still priced on its final day
    on_last = {r["model_id"]: r for r in snapshot_on(synthetic, "2025-06-30", BLEND)}
    assert on_last["acme/retired-1"]["prompt"] == 2.0


def test_live_model_extends_to_ledger_as_of(synthetic):
    series = series_for(synthetic, ["acme/live-1"], "prompt", BLEND)[0]
    assert series.last_day == "2026-08-06"


def test_unpriced_slots_stay_none(synthetic):
    """§1.3 — null is 'unpriced', never 0."""
    series = series_for(synthetic, ["acme/unpriced-1"], "prompt", BLEND)[0]
    assert series.points[0] == ("2025-02-01", None)
    assert series.points[1] == ("2025-04-01", 1.0)


def test_censored_flag_set_on_ledger_epoch(synthetic):
    row = synthetic.execute(
        "SELECT date_is_censored, release_date FROM models WHERE id='acme/censored-1'"
    ).fetchone()
    assert row["date_is_censored"] == 1
    # no snapshot entry, so it falls back to first_seen
    assert row["release_date"] == "2024-09-21"


def test_variants_are_excluded_from_handoffs(synthetic):
    """A :thinking-style variant shares the family but is not a generation."""
    handoffs = compute_handoffs(synthetic, BLEND)
    assert len(handoffs) == 1
    assert (handoffs[0].prev_id, handoffs[0].next_id) == ("acme/retired-1", "acme/live-1")


def test_handoff_from_already_retired_predecessor(synthetic):
    """§4.4 — falls back to the predecessor's last known price."""
    h = compute_handoffs(synthetic, BLEND)[0]
    assert h.launch_date == "2025-01-01"
    assert h.prev_price["prompt"] == 4.0
    assert h.next_price["prompt"] == 10.0


def test_unknown_id_fails_loudly(tmp_path, blank_db):
    config = tmp_path / "families.yaml"
    config.write_text(
        SYNTHETIC_YAML.replace("acme/live-1", "acme/does-not-exist")
    )
    ledger = tmp_path / "prices.json"
    ledger.write_text(json.dumps(SYNTHETIC_LEDGER))
    snapshot = tmp_path / "output.json"
    snapshot.write_text(json.dumps({"data": []}))

    with pytest.raises(FamilyConfigError) as exc:
        ingest(
            blank_db,
            roster=load_roster(config),
            ledger_path=ledger,
            snapshot_path=snapshot,
        )
    assert "acme/does-not-exist" in str(exc.value)


def test_failed_ingest_is_recorded(tmp_path, blank_db):
    config = tmp_path / "families.yaml"
    config.write_text(SYNTHETIC_YAML.replace("acme/live-1", "acme/nope"))
    ledger = tmp_path / "prices.json"
    ledger.write_text(json.dumps(SYNTHETIC_LEDGER))
    snapshot = tmp_path / "output.json"
    snapshot.write_text(json.dumps({"data": []}))

    with pytest.raises(FamilyConfigError):
        ingest(blank_db, roster=load_roster(config), ledger_path=ledger, snapshot_path=snapshot)

    row = blank_db.execute(
        "SELECT status, error FROM ingest_runs ORDER BY id DESC LIMIT 1"
    ).fetchone()
    assert row["status"] == "failed"
    assert "acme/nope" in row["error"]


def test_duplicate_family_membership_rejected(tmp_path):
    config = tmp_path / "families.yaml"
    config.write_text(SYNTHETIC_YAML + "\n  - key: dup\n    label: Dup\n    vendor: Acme\n"
                      "    group: china\n    members: [acme/live-1]\n")
    with pytest.raises(FamilyConfigError, match="claimed by both"):
        load_roster(config)


def test_bad_group_rejected(tmp_path):
    config = tmp_path / "families.yaml"
    config.write_text(SYNTHETIC_YAML.replace("group: eu", "group: atlantis"))
    with pytest.raises(FamilyConfigError, match="atlantis"):
        load_roster(config)


class TestIntraDayCollapse:
    """The upstream Action runs at 00:00 and 12:00 UTC, so one day can carry two
    entries. The schema keys points by (model_id, day); the day's final state is
    the value a day-granular step chart can show."""

    def test_last_entry_of_a_day_wins(self):
        points = [
            ("2025-06-17", 0.017, 0.030),
            ("2025-06-17", 0.016, 0.030),
            ("2025-06-18", 0.015, 0.029),
        ]
        assert collapse_to_days(points) == [
            ("2025-06-17", 0.016, 0.030),
            ("2025-06-18", 0.015, 0.029),
        ]

    def test_already_unique_days_are_untouched(self):
        points = [("2025-01-01", 1.0, 2.0), ("2025-01-02", 1.0, 2.5)]
        assert collapse_to_days(points) == points

    def test_output_is_sorted(self):
        points = [("2025-02-01", 1.0, 2.0), ("2025-01-01", 3.0, 4.0)]
        assert [p[0] for p in collapse_to_days(points)] == ["2025-01-01", "2025-02-01"]


def test_reingest_is_idempotent(tmp_path, blank_db):
    ledger = tmp_path / "prices.json"
    ledger.write_text(json.dumps(SYNTHETIC_LEDGER))
    snapshot = tmp_path / "output.json"
    snapshot.write_text(json.dumps({"data": []}))
    config = tmp_path / "families.yaml"
    config.write_text(SYNTHETIC_YAML)
    roster = load_roster(config)

    first = ingest(blank_db, roster=roster, ledger_path=ledger, snapshot_path=snapshot)
    second = ingest(blank_db, roster=roster, ledger_path=ledger, snapshot_path=snapshot)

    assert (first.models_seen, first.points_written) == (second.models_seen, second.points_written)
    counts = blank_db.execute(
        "SELECT (SELECT COUNT(*) FROM models) m, (SELECT COUNT(*) FROM price_points) p"
    ).fetchone()
    assert counts["m"] == 4
    assert counts["p"] == 6


def test_roster_edit_rebuilds_even_when_upstream_is_unchanged(tmp_path, blank_db, monkeypatch):
    """A families.yaml edit must not be swallowed by the 304 short-circuit —
    the config changes independently of upstream."""
    from atlas.ingest import fetch, run

    ledger = tmp_path / "prices.json"
    ledger.write_text(json.dumps(SYNTHETIC_LEDGER))
    snapshot = tmp_path / "output.json"
    snapshot.write_text(json.dumps({"data": []}))

    full = tmp_path / "full.yaml"
    full.write_text(SYNTHETIC_YAML)
    ingest(blank_db, roster=load_roster(full), ledger_path=ledger, snapshot_path=snapshot)

    # Simulate both sources answering 304 on the next run.
    def cached(path):
        return fetch.Fetched(payload=json.loads(path.read_text()), from_cache=True)

    monkeypatch.setattr(run.fetch, "load_local", cached)

    unchanged = ingest(blank_db, roster=load_roster(full), ledger_path=ledger, snapshot_path=snapshot)
    assert unchanged.skipped is True

    trimmed = tmp_path / "trimmed.yaml"
    trimmed.write_text(SYNTHETIC_YAML.replace("    variants: [acme/unpriced-1]\n", ""))
    edited = ingest(blank_db, roster=load_roster(trimmed), ledger_path=ledger, snapshot_path=snapshot)
    assert edited.skipped is False
    assert edited.models_seen == 3


def test_unknown_id_fails_even_when_upstream_is_unchanged(tmp_path, blank_db, monkeypatch):
    from atlas.ingest import fetch, run

    ledger = tmp_path / "prices.json"
    ledger.write_text(json.dumps(SYNTHETIC_LEDGER))
    snapshot = tmp_path / "output.json"
    snapshot.write_text(json.dumps({"data": []}))
    full = tmp_path / "full.yaml"
    full.write_text(SYNTHETIC_YAML)
    ingest(blank_db, roster=load_roster(full), ledger_path=ledger, snapshot_path=snapshot)

    monkeypatch.setattr(
        run.fetch,
        "load_local",
        lambda path: fetch.Fetched(payload=json.loads(path.read_text()), from_cache=True),
    )

    bad = tmp_path / "bad.yaml"
    bad.write_text(SYNTHETIC_YAML.replace("acme/live-1", "acme/renamed-upstream"))
    with pytest.raises(FamilyConfigError, match="acme/renamed-upstream"):
        ingest(blank_db, roster=load_roster(bad), ledger_path=ledger, snapshot_path=snapshot)


def test_dropped_roster_member_is_removed_on_reingest(tmp_path, blank_db):
    ledger = tmp_path / "prices.json"
    ledger.write_text(json.dumps(SYNTHETIC_LEDGER))
    snapshot = tmp_path / "output.json"
    snapshot.write_text(json.dumps({"data": []}))

    full = tmp_path / "full.yaml"
    full.write_text(SYNTHETIC_YAML)
    ingest(blank_db, roster=load_roster(full), ledger_path=ledger, snapshot_path=snapshot)

    trimmed = tmp_path / "trimmed.yaml"
    trimmed.write_text(SYNTHETIC_YAML.replace("    variants: [acme/unpriced-1]\n", ""))
    ingest(blank_db, roster=load_roster(trimmed), ledger_path=ledger, snapshot_path=snapshot)

    remaining = {r["id"] for r in blank_db.execute("SELECT id FROM models")}
    assert "acme/unpriced-1" not in remaining
    orphans = blank_db.execute(
        "SELECT COUNT(*) AS n FROM price_points WHERE model_id = 'acme/unpriced-1'"
    ).fetchone()["n"]
    assert orphans == 0
