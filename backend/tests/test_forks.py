"""Tier fan-outs: one generation splitting into several tiers at once.

GPT-5.6 shipped as Sol / Terra / Luna on the same day, and Claude Fable opened a
tier above Opus. A plain succession chain can only express one successor, so
these are declared under `forks:` in families.yaml.
"""

import json

import pytest

from atlas.ingest.families import FamilyConfigError, load_roster
from atlas.ingest.run import ingest
from atlas.releases import compute_handoffs

from .conftest import BLEND

SYNTHETIC_LEDGER = {
    "as_of": "2026-08-07",
    "model_count": 4,
    "models": {
        "acme/base": {
            "name": "Acme: Base",
            "first_seen": "2025-01-01",
            "last_seen": "2026-08-07",
            "present_now": True,
            "points": [["2025-01-01", 10.0, 30.0]],
        },
        "acme/big": {
            "name": "Acme: Big",
            "first_seen": "2025-06-01",
            "last_seen": "2026-08-07",
            "present_now": True,
            "points": [["2025-06-01", 10.0, 30.0]],
        },
        "acme/mid": {
            "name": "Acme: Mid",
            "first_seen": "2025-06-01",
            "last_seen": "2026-08-07",
            "present_now": True,
            "points": [["2025-06-01", 5.0, 15.0]],
        },
        "acme/small": {
            "name": "Acme: Small",
            "first_seen": "2025-06-01",
            "last_seen": "2026-08-07",
            "present_now": True,
            "points": [["2025-06-01", 1.0, 3.0]],
        },
    },
}

YAML = """
meta:
  blend_ratio: {input: 3, output: 1}
forks:
  - from: acme/base
    to: [acme/big, acme/mid, acme/small]
families:
  - key: acme
    label: "Acme"
    vendor: Acme
    group: frontier-us
    members: [acme/base, acme/big]
  - key: acme-mid
    label: "Acme Mid"
    vendor: Acme
    group: frontier-us
    members: [acme/mid]
  - key: acme-small
    label: "Acme Small"
    vendor: Acme
    group: frontier-us
    members: [acme/small]
"""


@pytest.fixture
def forked(tmp_path, blank_db):
    ledger = tmp_path / "prices.json"
    ledger.write_text(json.dumps(SYNTHETIC_LEDGER))
    snapshot = tmp_path / "output.json"
    snapshot.write_text(json.dumps({"data": []}))
    config = tmp_path / "families.yaml"
    config.write_text(YAML)
    ingest(blank_db, roster=load_roster(config), ledger_path=ledger, snapshot_path=snapshot)
    return blank_db


def test_fork_branches_are_not_duplicated_as_successions(forked):
    """base -> big is already an in-family succession; the fork must not also
    emit it, or the chart draws the same edge twice."""
    handoffs = compute_handoffs(forked, BLEND)
    pairs = [(h.prev_id, h.next_id, h.kind) for h in handoffs]
    assert pairs.count(("acme/base", "acme/big", "succession")) == 1
    assert ("acme/base", "acme/big", "fork") not in pairs


def test_fork_emits_the_branches_that_leave_the_line(forked):
    forks = {h.next_id: h for h in compute_handoffs(forked, BLEND) if h.kind == "fork"}
    assert set(forks) == {"acme/mid", "acme/small"}
    # blended base = (3*10 + 30)/4 = 15; mid = (3*5 + 15)/4 = 7.5 -> -50%
    assert forks["acme/mid"].delta_pct["blended"] == pytest.approx(-50.0)
    assert forks["acme/small"].delta_pct["blended"] == pytest.approx(-90.0)
    assert forks["acme/mid"].direction["blended"] == "cheaper"


def test_fork_is_attributed_to_the_source_family(forked):
    """So `?family=` returns the fan alongside that family's successions."""
    forks = [h for h in compute_handoffs(forked, BLEND) if h.kind == "fork"]
    assert {h.family_key for h in forks} == {"acme"}

    scoped = compute_handoffs(forked, BLEND, "acme")
    assert {h.next_id for h in scoped if h.kind == "fork"} == {"acme/mid", "acme/small"}
    # a family that owns no fork source gets none of the branches
    assert [h for h in compute_handoffs(forked, BLEND, "acme-mid") if h.kind == "fork"] == []


def test_fork_launch_date_is_the_branch_launch(forked):
    forks = {h.next_id: h for h in compute_handoffs(forked, BLEND) if h.kind == "fork"}
    assert forks["acme/mid"].launch_date == "2025-06-01"
    assert forks["acme/mid"].prev_price["blended"] == pytest.approx(15.0)


def test_fork_targets_must_be_rostered(tmp_path):
    config = tmp_path / "families.yaml"
    config.write_text(YAML.replace("acme/mid, acme/small]", "acme/mid, acme/ghost]"))
    with pytest.raises(FamilyConfigError, match="acme/ghost"):
        load_roster(config)


def test_fork_source_must_be_rostered(tmp_path):
    config = tmp_path / "families.yaml"
    config.write_text(YAML.replace("from: acme/base", "from: acme/nowhere"))
    with pytest.raises(FamilyConfigError, match="acme/nowhere"):
        load_roster(config)


def test_fork_cannot_target_itself(tmp_path):
    config = tmp_path / "families.yaml"
    config.write_text(YAML.replace("to: [acme/big", "to: [acme/base, acme/big"))
    with pytest.raises(FamilyConfigError, match="cannot fork into itself"):
        load_roster(config)


def test_fork_edit_rebuilds_even_when_upstream_is_unchanged(tmp_path, blank_db, monkeypatch):
    from atlas.ingest import fetch, run

    ledger = tmp_path / "prices.json"
    ledger.write_text(json.dumps(SYNTHETIC_LEDGER))
    snapshot = tmp_path / "output.json"
    snapshot.write_text(json.dumps({"data": []}))
    full = tmp_path / "full.yaml"
    full.write_text(YAML)
    ingest(blank_db, roster=load_roster(full), ledger_path=ledger, snapshot_path=snapshot)

    monkeypatch.setattr(
        run.fetch,
        "load_local",
        lambda path: fetch.Fetched(payload=json.loads(path.read_text()), from_cache=True),
    )
    assert ingest(
        blank_db, roster=load_roster(full), ledger_path=ledger, snapshot_path=snapshot
    ).skipped

    # dropping a fork branch is a roster change, not an upstream one
    trimmed = tmp_path / "trimmed.yaml"
    trimmed.write_text(YAML.replace("to: [acme/big, acme/mid, acme/small]", "to: [acme/big, acme/mid]"))
    assert not ingest(
        blank_db, roster=load_roster(trimmed), ledger_path=ledger, snapshot_path=snapshot
    ).skipped
    assert blank_db.execute("SELECT COUNT(*) n FROM forks").fetchone()["n"] == 2


def test_real_roster_declares_the_known_fans(db):
    """The seed roster's own fan-outs, against the checked-in fixture."""
    forks = {
        (h.prev_id, h.next_id): h for h in compute_handoffs(db, BLEND) if h.kind == "fork"
    }
    assert set(forks) == {
        ("openai/gpt-5.5", "openai/gpt-5.6-terra"),
        ("openai/gpt-5.5", "openai/gpt-5.6-luna"),
        ("anthropic/claude-opus-4.8", "anthropic/claude-fable-5"),
    }

    terra = forks[("openai/gpt-5.5", "openai/gpt-5.6-terra")]
    assert terra.launch_date == "2026-07-10"
    assert terra.delta_pct["blended"] == pytest.approx(-50.0)

    luna = forks[("openai/gpt-5.5", "openai/gpt-5.6-luna")]
    assert luna.delta_pct["blended"] == pytest.approx(-80.0)

    fable = forks[("anthropic/claude-opus-4.8", "anthropic/claude-fable-5")]
    assert fable.launch_date == "2026-06-10"
    assert fable.delta_pct["blended"] == pytest.approx(100.0)
    assert fable.direction["blended"] == "pricier"


def test_sol_continues_the_flagship_line_at_the_same_price(db):
    """Sol is the tier that inherited GPT-5.5's price, so it is a succession,
    not a branch — and its delta is flat, not a drop."""
    h = next(
        h
        for h in compute_handoffs(db, BLEND)
        if h.next_id == "openai/gpt-5.6-sol"
    )
    assert h.kind == "succession"
    assert h.family_key == "openai-flagship"
    assert h.delta_pct["blended"] == pytest.approx(0.0)
    assert h.direction["blended"] == "flat"
