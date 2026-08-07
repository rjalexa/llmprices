"""Generational deltas: for each family, each consecutive pair by ordinal.

Returned as first-class objects so the frontend can draw the handoff connectors
and their labels without re-deriving anything.
"""

import sqlite3
from dataclasses import asdict, dataclass

from .series import METRICS, Metric, ModelMeta, Point, load_meta, load_points, pick, value_on

FLAT_THRESHOLD_PCT = 1.0  # |delta| below this reads as "no change"


@dataclass
class Handoff:
    family_key: str
    prev_id: str
    next_id: str
    prev_name: str
    next_name: str
    launch_date: str
    prev_price: dict[str, float | None]
    next_price: dict[str, float | None]
    delta_pct: dict[str, float | None]
    direction: dict[str, str]  # cheaper | pricier | flat | unknown
    # succession = consecutive generations within one family;
    # fork = a tier branching off a declared fan-out (§forks in families.yaml)
    kind: str = "succession"


def _direction(delta: float | None) -> str:
    if delta is None:
        return "unknown"
    if abs(delta) < FLAT_THRESHOLD_PCT:
        return "flat"
    return "cheaper" if delta < 0 else "pricier"


def _price_at_launch(
    points: list[Point], meta: ModelMeta, launch_date: str, metric: Metric, ratio
) -> float | None:
    """Predecessor's price on the successor's launch date. If the predecessor was
    already retired by then, fall back to its last known price — the connector
    still needs an anchor to draw from."""
    if not points:
        return None
    anchor = min(launch_date, meta.last_seen)
    value = value_on(points, anchor, metric, ratio)
    if value is None:
        # Launch predates the predecessor's first point; nothing sensible to show.
        return None
    return value


def _launch_price(points: list[Point], metric: Metric, ratio) -> float | None:
    return pick(points[0], metric, ratio) if points else None


def _pair_handoff(
    fam_key: str,
    prev_id: str,
    next_id: str,
    metas: dict[str, ModelMeta],
    points: dict[str, list[Point]],
    ratio: tuple[float, float],
    kind: str,
) -> Handoff | None:
    prev_meta, next_meta = metas.get(prev_id), metas.get(next_id)
    if not prev_meta or not next_meta:
        return None

    prev_points, next_points = points.get(prev_id, []), points.get(next_id, [])
    # `release_date` is output.json's `created` where available; for the
    # successor's price we want the first day it was actually priced, which is
    # where its step line begins.
    launch_date = (
        next_points[0][0] if next_points else (next_meta.release_date or next_meta.first_seen)
    )

    prev_price: dict[str, float | None] = {}
    next_price: dict[str, float | None] = {}
    delta_pct: dict[str, float | None] = {}
    direction: dict[str, str] = {}

    for metric in METRICS:
        before = _price_at_launch(prev_points, prev_meta, launch_date, metric, ratio)
        after = _launch_price(next_points, metric, ratio)
        prev_price[metric] = before
        next_price[metric] = after
        delta = (
            (after - before) / before * 100.0
            if before not in (None, 0) and after is not None
            else None
        )
        delta_pct[metric] = delta
        direction[metric] = _direction(delta)

    return Handoff(
        family_key=fam_key,
        prev_id=prev_id,
        next_id=next_id,
        prev_name=prev_meta.name,
        next_name=next_meta.name,
        launch_date=launch_date,
        prev_price=prev_price,
        next_price=next_price,
        delta_pct=delta_pct,
        direction=direction,
        kind=kind,
    )


def compute_handoffs(
    conn: sqlite3.Connection, ratio: tuple[float, float], family_key: str | None = None
) -> list[Handoff]:
    sql = (
        "SELECT fm.family_key, fm.model_id, fm.ordinal FROM family_members fm "
        "WHERE fm.is_variant = 0"
    )
    params: tuple = ()
    if family_key:
        sql += " AND fm.family_key = ?"
        params = (family_key,)
    sql += " ORDER BY fm.family_key, fm.ordinal"

    by_family: dict[str, list[str]] = {}
    for r in conn.execute(sql, params):
        by_family.setdefault(r["family_key"], []).append(r["model_id"])

    fork_rows = conn.execute(
        "SELECT from_id, to_id FROM forks ORDER BY from_id, ordinal"
    ).fetchall()

    all_ids = list(
        {
            mid
            for ids in by_family.values()
            for mid in ids
        }
        | {r["from_id"] for r in fork_rows}
        | {r["to_id"] for r in fork_rows}
    )
    metas = load_meta(conn, all_ids)
    points = load_points(conn, all_ids)

    handoffs: list[Handoff] = []
    succession_pairs: set[tuple[str, str]] = set()
    family_of: dict[str, str] = {}

    for fam_key, ids in by_family.items():
        for mid in ids:
            family_of[mid] = fam_key
        for prev_id, next_id in zip(ids, ids[1:], strict=False):
            h = _pair_handoff(fam_key, prev_id, next_id, metas, points, ratio, "succession")
            if h:
                succession_pairs.add((prev_id, next_id))
                handoffs.append(h)

    # Fork branches. A pair that is already an in-family succession (Sol after
    # 5.5) is not duplicated — the fork only contributes the branches that leave
    # the line. Attributed to the *source* model's family so `?family=` returns
    # the fan alongside that family's successions.
    for r in fork_rows:
        pair = (r["from_id"], r["to_id"])
        if pair in succession_pairs:
            continue
        source_family = family_of.get(pair[0])
        if source_family is None or (family_key and source_family != family_key):
            continue
        h = _pair_handoff(source_family, pair[0], pair[1], metas, points, ratio, "fork")
        if h:
            handoffs.append(h)

    handoffs.sort(key=lambda h: (h.launch_date, h.family_key))
    return handoffs


def as_dicts(handoffs: list[Handoff]) -> list[dict]:
    return [asdict(h) for h in handoffs]
