"""Change points -> stepped series. The one piece of real logic.

Nothing dense is ever stored: the ledger keeps only change points, and the
frontend draws `curveStepAfter`, so it only needs the vertices plus the window
bounds to know where each line starts and stops.
"""

import sqlite3
from dataclasses import dataclass
from typing import Literal

Metric = Literal["prompt", "completion", "blended"]
METRICS: tuple[Metric, ...] = ("prompt", "completion", "blended")

Point = tuple[str, float | None, float | None]  # (day, prompt_per_m, completion_per_m)


@dataclass(frozen=True)
class ModelMeta:
    id: str
    name: str
    vendor: str
    release_date: str | None
    first_seen: str
    last_seen: str
    present_now: bool
    date_is_censored: bool


def blend(prompt: float | None, completion: float | None, ratio: tuple[float, float]) -> float | None:
    """Blended $/1M = (w_in * prompt + w_out * completion) / (w_in + w_out)."""
    if prompt is None or completion is None:
        return None
    w_in, w_out = ratio
    return (w_in * prompt + w_out * completion) / (w_in + w_out)


def pick(point: Point, metric: Metric, ratio: tuple[float, float]) -> float | None:
    _, prompt, completion = point
    if metric == "prompt":
        return prompt
    if metric == "completion":
        return completion
    return blend(prompt, completion, ratio)


def value_on(points: list[Point], day: str, metric: Metric, ratio: tuple[float, float]) -> float | None:
    """Forward-fill: the value in force on `day` is the last change point at or
    before it. None before the first point."""
    chosen: Point | None = None
    for point in points:
        if point[0] > day:
            break
        chosen = point
    return None if chosen is None else pick(chosen, metric, ratio)


def load_meta(conn: sqlite3.Connection, ids: list[str] | None = None) -> dict[str, ModelMeta]:
    sql = (
        "SELECT id, name, vendor, release_date, first_seen, last_seen, present_now, "
        "date_is_censored FROM models"
    )
    params: tuple = ()
    if ids is not None:
        if not ids:
            return {}
        sql += f" WHERE id IN ({','.join('?' * len(ids))})"
        params = tuple(ids)
    return {
        r["id"]: ModelMeta(
            id=r["id"],
            name=r["name"],
            vendor=r["vendor"],
            release_date=r["release_date"],
            first_seen=r["first_seen"],
            last_seen=r["last_seen"],
            present_now=bool(r["present_now"]),
            date_is_censored=bool(r["date_is_censored"]),
        )
        for r in conn.execute(sql, params)
    }


def load_points(conn: sqlite3.Connection, ids: list[str] | None = None) -> dict[str, list[Point]]:
    sql = "SELECT model_id, day, prompt_per_m, completion_per_m FROM price_points"
    params: tuple = ()
    if ids is not None:
        if not ids:
            return {}
        sql += f" WHERE model_id IN ({','.join('?' * len(ids))})"
        params = tuple(ids)
    sql += " ORDER BY model_id, day"

    out: dict[str, list[Point]] = {mid: [] for mid in (ids or [])}
    for r in conn.execute(sql, params):
        out.setdefault(r["model_id"], []).append(
            (r["day"], r["prompt_per_m"], r["completion_per_m"])
        )
    return out


@dataclass
class Series:
    model_id: str
    points: list[tuple[str, float | None]]
    first_day: str | None
    last_day: str | None
    encoding: str = "step-after"


def build_series(
    meta: ModelMeta,
    points: list[Point],
    metric: Metric,
    ratio: tuple[float, float],
    from_day: str | None = None,
    to_day: str | None = None,
) -> Series:
    """Clip to the model's live window, intersected with the requested window.

    The right clip is what stops a retired model's step line from running to
    today: `last_seen` is the final day the model was observed, and for a live
    model it is simply the ledger's as-of date.
    """
    start = max(x for x in (meta.first_seen, from_day) if x)
    end = min(x for x in (meta.last_seen, to_day) if x)

    if start > end:
        return Series(meta.id, [], None, None)

    inside = [p for p in points if start <= p[0] <= end]

    out: list[tuple[str, float | None]] = []
    # The value carried into the window from before it: without this vertex the
    # line would start late, or not at all for a model whose price never moved.
    if not inside or inside[0][0] > start:
        carried = value_on(points, start, metric, ratio)
        out.append((start, carried))

    out.extend((p[0], pick(p, metric, ratio)) for p in inside)

    return Series(meta.id, out, start, end)


def series_for(
    conn: sqlite3.Connection,
    ids: list[str],
    metric: Metric,
    ratio: tuple[float, float],
    from_day: str | None = None,
    to_day: str | None = None,
) -> list[Series]:
    metas = load_meta(conn, ids)
    points = load_points(conn, ids)
    return [
        build_series(metas[mid], points.get(mid, []), metric, ratio, from_day, to_day)
        for mid in ids
        if mid in metas
    ]


def snapshot_on(
    conn: sqlite3.Connection,
    day: str,
    ratio: tuple[float, float],
    ids: list[str] | None = None,
) -> list[dict]:
    """Forward-filled price for every roster model on one day. Models not yet
    launched, or already retired, report `live = False` and null prices."""
    metas = load_meta(conn, ids)
    points = load_points(conn, ids)
    rows = []
    for mid, meta in metas.items():
        pts = points.get(mid, [])
        live = meta.first_seen <= day <= meta.last_seen
        current = None
        if live:
            for p in pts:
                if p[0] > day:
                    break
                current = p
        rows.append(
            {
                "model_id": mid,
                "name": meta.name,
                "vendor": meta.vendor,
                "live": live and current is not None,
                "prompt": current[1] if current else None,
                "completion": current[2] if current else None,
                "blended": blend(current[1], current[2], ratio) if current else None,
            }
        )
    rows.sort(key=lambda r: r["model_id"])
    return rows
