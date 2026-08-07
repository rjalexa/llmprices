import csv
import io
import sqlite3
from datetime import date

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..deps import Conn, blend_ratio, csv_ids
from ..models import Series, SeriesResponse, SnapshotResponse, SnapshotRow
from ..series import load_meta, load_points, series_for, snapshot_on, value_on

router = APIRouter(prefix="/api", tags=["series"])

MetricQ = Query("blended", pattern="^(prompt|completion|blended)$")
DateQ = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


def _require_ids(raw: str | None) -> list[str]:
    ids = csv_ids(raw)
    if not ids:
        raise HTTPException(400, "ids is required: a comma-separated list of model ids")
    if len(ids) > 400:
        raise HTTPException(400, "too many ids (max 400)")
    return ids


@router.get("/series", response_model=SeriesResponse)
def series(
    conn: sqlite3.Connection = Conn,
    ids: str = Query(..., description="comma-separated model ids"),
    metric: str = MetricQ,
    from_: str | None = Query(None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    to: str | None = DateQ,
) -> SeriesResponse:
    wanted = _require_ids(ids)
    built = series_for(conn, wanted, metric, blend_ratio(), from_, to)  # type: ignore[arg-type]
    return SeriesResponse(
        metric=metric,
        series=[
            Series(
                model_id=s.model_id,
                points=s.points,
                first_day=s.first_day,
                last_day=s.last_day,
                encoding=s.encoding,
            )
            for s in built
        ],
    )


@router.get("/snapshot", response_model=SnapshotResponse)
def snapshot(
    conn: sqlite3.Connection = Conn,
    date_: str | None = Query(None, alias="date", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    ids: str | None = Query(None),
) -> SnapshotResponse:
    day = date_ or date.today().isoformat()
    rows = snapshot_on(conn, day, blend_ratio(), csv_ids(ids))
    return SnapshotResponse(date=day, rows=[SnapshotRow(**r) for r in rows])


@router.get("/export.csv", response_class=StreamingResponse)
def export_csv(
    conn: sqlite3.Connection = Conn,
    ids: str | None = Query(None, description="omit for the whole roster"),
    metric: str = MetricQ,
    from_: str | None = Query(None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    to: str | None = DateQ,
    dense: bool = Query(False, description="emit one row per day instead of change points only"),
) -> StreamingResponse:
    """Long format: model_id,name,vendor,day,<metric>.

    By default only change points are emitted, which is what the chart consumes.
    `dense=true` forward-fills to one row per day for spreadsheet users who want
    to chart it without understanding step semantics.
    """
    wanted = csv_ids(ids) or [r["id"] for r in conn.execute("SELECT id FROM models ORDER BY id")]
    metas = load_meta(conn, wanted)
    points = load_points(conn, wanted)
    ratio = blend_ratio()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["model_id", "name", "vendor", "day", metric])

    def flush() -> str:
        chunk = buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        return chunk

    def rows():
        yield flush()
        for mid in wanted:
            meta = metas.get(mid)
            if not meta:
                continue
            built = series_for(conn, [mid], metric, ratio, from_, to)  # type: ignore[arg-type]
            if not built or not built[0].points:
                continue
            s = built[0]
            if dense:
                emit = [
                    (d.isoformat(), value_on(points.get(mid, []), d.isoformat(), metric, ratio))  # type: ignore[arg-type]
                    for d in _day_range(s.first_day, s.last_day)
                ]
            else:
                emit = s.points
            for day, value in emit:
                writer.writerow([mid, meta.name, meta.vendor, day, "" if value is None else value])
            yield flush()

    filename = f"llm-price-atlas-{metric}.csv"
    return StreamingResponse(
        rows(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _day_range(first: str | None, last: str | None) -> list[date]:
    if not first or not last:
        return []
    start, end = date.fromisoformat(first), date.fromisoformat(last)
    return [
        date.fromordinal(o) for o in range(start.toordinal(), end.toordinal() + 1)
    ]
