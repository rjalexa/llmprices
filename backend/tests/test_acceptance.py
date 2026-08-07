"""The §8 acceptance criteria, against the checked-in fixture."""

import pytest

from atlas.releases import compute_handoffs
from atlas.series import series_for, snapshot_on, value_on

from .conftest import BLEND

# §8.1 counts. The plan quotes 652 points and 62 for glm-5.2; those are raw
# ledger entries. The upstream Action snapshots twice a day, so a price that
# moves twice in one day yields two entries sharing a date, and the schema keys
# price_points by (model_id, day). Collapsing each day to its final state — the
# only value a day-granular step chart can render — gives the numbers below.
EXPECTED_MODELS = 96
EXPECTED_MEMBERS = 86
EXPECTED_VARIANTS = 10
EXPECTED_FAMILIES = 22
EXPECTED_POINTS = 614
EXPECTED_SUCCESSIONS = 64
EXPECTED_FORKS = 3
EXPECTED_HANDOFFS = EXPECTED_SUCCESSIONS + EXPECTED_FORKS
EXPECTED_GLM52_POINTS = 40


def test_roster_counts(db):
    counts = db.execute(
        "SELECT (SELECT COUNT(*) FROM models) m, (SELECT COUNT(*) FROM price_points) p, "
        "(SELECT COUNT(*) FROM families) f, "
        "(SELECT COUNT(*) FROM family_members WHERE is_variant=0) mem, "
        "(SELECT COUNT(*) FROM family_members WHERE is_variant=1) var"
    ).fetchone()
    assert counts["m"] == EXPECTED_MODELS
    assert counts["mem"] == EXPECTED_MEMBERS
    assert counts["var"] == EXPECTED_VARIANTS
    assert counts["f"] == EXPECTED_FAMILIES
    assert counts["p"] == EXPECTED_POINTS


def test_no_unknown_ids(db, roster):
    known = {r["id"] for r in db.execute("SELECT id FROM models")}
    assert set(roster.ids) == known


def test_handoff_count(db):
    handoffs = compute_handoffs(db, BLEND)
    assert len(handoffs) == EXPECTED_HANDOFFS
    assert sum(1 for h in handoffs if h.kind == "succession") == EXPECTED_SUCCESSIONS
    assert sum(1 for h in handoffs if h.kind == "fork") == EXPECTED_FORKS


@pytest.mark.parametrize(
    ("model_id", "expected"),
    [("z-ai/glm-5.2", EXPECTED_GLM52_POINTS), ("anthropic/claude-sonnet-5", 1)],
)
def test_change_point_counts(db, model_id, expected):
    n = db.execute(
        "SELECT COUNT(*) AS n FROM price_points WHERE model_id = ?", (model_id,)
    ).fetchone()["n"]
    assert n == expected


def test_forward_fill_between_change_points(db):
    """§8.3 — sonnet-4.5 has no point on 2026-01-01 but was priced that day."""
    rows = {r["model_id"]: r for r in snapshot_on(db, "2026-01-01", BLEND)}
    row = rows["anthropic/claude-sonnet-4.5"]
    assert row["live"] is True
    assert row["prompt"] == pytest.approx(3.0)
    assert row["completion"] == pytest.approx(15.0)


def test_blended_metric(db):
    """§8.8 — (3*2.0 + 10.0) / 4 = 4.00."""
    series = series_for(db, ["anthropic/claude-sonnet-5"], "blended", BLEND)[0]
    assert series.points[0][1] == pytest.approx(4.0)


def test_release_date_beats_censored_first_seen(db):
    """§8.7 — gpt-4o's real launch comes from output.json `created`."""
    row = db.execute(
        "SELECT release_date, first_seen, date_is_censored FROM models WHERE id='openai/gpt-4o'"
    ).fetchone()
    assert row["release_date"] == "2024-05-13"
    assert row["first_seen"] == "2024-09-21"
    assert row["date_is_censored"] == 1


def _handoff(db, prev_id, next_id):
    for h in compute_handoffs(db, BLEND):
        if h.prev_id == prev_id and h.next_id == next_id:
            return h
    raise AssertionError(f"no handoff {prev_id} -> {next_id}")


def test_sonnet_generation_is_a_third_cheaper(db):
    """§8.5"""
    h = _handoff(db, "anthropic/claude-sonnet-4.6", "anthropic/claude-sonnet-5")
    assert h.delta_pct["prompt"] == pytest.approx(-33.3, abs=0.1)
    assert h.delta_pct["completion"] == pytest.approx(-33.3, abs=0.1)
    assert h.direction["prompt"] == "cheaper"


def test_kimi_generation_is_pricier(db):
    """§8.6 — proves sign handling and the 'not always cheaper' path."""
    h = _handoff(db, "moonshotai/kimi-k2.6", "moonshotai/kimi-k3")
    assert h.delta_pct["prompt"] == pytest.approx(215.8, abs=0.1)
    assert h.delta_pct["completion"] == pytest.approx(275.0, abs=0.1)
    assert h.direction["prompt"] == "pricier"


@pytest.mark.parametrize(
    ("prev_id", "next_id", "date", "prompt_before", "prompt_after", "out_before", "out_after"),
    [
        ("anthropic/claude-sonnet-4.6", "anthropic/claude-sonnet-5", "2026-07-01", 3.0, 2.0, 15.0, 10.0),
        ("anthropic/claude-opus-4.1", "anthropic/claude-opus-4.5", "2025-11-25", 15.0, 5.0, 75.0, 25.0),
        ("openai/gpt-5.5", "openai/gpt-5.6-luna", "2026-07-10", 5.0, 1.0, 30.0, 6.0),
        ("deepseek/deepseek-v3.2", "deepseek/deepseek-v4-flash", "2026-04-24", 0.252, 0.14, 0.378, 0.28),
        ("z-ai/glm-5.1", "z-ai/glm-5.2", "2026-06-17", 0.98, 1.4, 3.08, 4.4),
        ("moonshotai/kimi-k2.6", "moonshotai/kimi-k3", "2026-07-17", 0.95, 3.0, 4.0, 15.0),
    ],
)
def test_fixture_table_from_plan(
    db, prev_id, next_id, date, prompt_before, prompt_after, out_before, out_after
):
    """§5.1 — the verified handoff table, used as fixture assertions."""
    h = _handoff(db, prev_id, next_id)
    assert h.launch_date == date
    assert h.prev_price["prompt"] == pytest.approx(prompt_before)
    assert h.next_price["prompt"] == pytest.approx(prompt_after)
    assert h.prev_price["completion"] == pytest.approx(out_before)
    assert h.next_price["completion"] == pytest.approx(out_after)


def test_value_on_returns_none_before_first_point():
    points = [("2025-01-10", 1.0, 2.0)]
    assert value_on(points, "2025-01-09", "prompt", BLEND) is None
    assert value_on(points, "2025-01-10", "prompt", BLEND) == 1.0
    assert value_on(points, "2026-01-10", "prompt", BLEND) == 1.0
