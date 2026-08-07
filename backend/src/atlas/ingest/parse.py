"""Ledger + snapshot -> normalized rows."""

from dataclasses import dataclass, field
from datetime import UTC, datetime

from ..config import LEDGER_EPOCH


@dataclass
class ModelRow:
    id: str
    name: str
    vendor: str
    release_date: str | None
    first_seen: str
    last_seen: str
    present_now: bool
    date_is_censored: bool
    context_length: int | None = None
    modality: str | None = None
    is_reasoning: bool | None = None
    cache_read_per_m: float | None = None
    cache_write_per_m: float | None = None
    web_search_per_call: float | None = None
    points: list[tuple[str, float | None, float | None]] = field(default_factory=list)
    raw_point_count: int = 0  # before intra-day collapse; see collapse_to_days


def _vendor_of(model_id: str) -> str:
    return model_id.split("/", 1)[0]


def _to_float(value) -> float | None:
    """Prices arrive as strings in output.json. `-1` is OpenRouter's
    'not applicable' sentinel and must not be coerced to 0."""
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if out < 0 else out


def _clean_point(raw) -> tuple[str, float | None, float | None] | None:
    if not raw or len(raw) < 3:
        return None
    day, prompt, completion = raw[0], _to_float(raw[1]), _to_float(raw[2])
    if not day:
        return None
    return (day, prompt, completion)


def collapse_to_days(
    points: list[tuple[str, float | None, float | None]],
) -> list[tuple[str, float | None, float | None]]:
    """Keep one point per day — the last one.

    The upstream Action snapshots twice a day (00:00 and 12:00 UTC), so a price
    that moves twice within a day produces two entries sharing a date. The series
    is stepped at day granularity, so the day's final state is the meaningful
    value; the earlier reading is not representable on the chart. Points arrive
    in chronological order and the sort below is stable, so the last entry for a
    day is the later snapshot.
    """
    by_day: dict[str, tuple[str, float | None, float | None]] = {}
    for point in points:
        by_day[point[0]] = point
    return sorted(by_day.values(), key=lambda p: p[0])


def index_snapshot(snapshot: dict | list) -> dict[str, dict]:
    """output.json is {data: [...]}; tolerate a bare list too."""
    rows = snapshot.get("data", []) if isinstance(snapshot, dict) else snapshot
    return {r["id"]: r for r in rows if isinstance(r, dict) and r.get("id")}


def build_rows(ledger: dict, snapshot_by_id: dict[str, dict], roster_ids: list[str]) -> list[ModelRow]:
    ledger_models = ledger.get("models", {})
    rows: list[ModelRow] = []

    for model_id in roster_ids:
        entry = ledger_models[model_id]  # presence guaranteed by validate_against_ledger
        first_seen = entry["first_seen"]
        censored = first_seen == LEDGER_EPOCH

        points = [p for p in (_clean_point(raw) for raw in entry.get("points", [])) if p]
        points.sort(key=lambda p: p[0])
        raw_count = len(points)
        points = collapse_to_days(points)

        row = ModelRow(
            id=model_id,
            name=entry.get("name") or model_id,
            vendor=_vendor_of(model_id),
            release_date=first_seen,
            first_seen=first_seen,
            last_seen=entry["last_seen"],
            present_now=bool(entry.get("present_now")),
            date_is_censored=censored,
            points=points,
            raw_point_count=raw_count,
        )
        _enrich(row, snapshot_by_id.get(model_id))
        rows.append(row)

    return rows


def _enrich(row: ModelRow, snap: dict | None) -> None:
    """Overlay present-day metadata from output.json. Retired models are absent
    from the snapshot, so every field here stays optional."""
    if not snap:
        return

    # `created` is the real launch date and beats first_seen, which for 177 models
    # is just the ledger epoch.
    if created := snap.get("created"):
        try:
            row.release_date = datetime.fromtimestamp(int(created), UTC).strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            pass

    if name := snap.get("name"):
        row.name = name
    row.context_length = snap.get("context_length") or None
    row.modality = (snap.get("architecture") or {}).get("modality")
    row.is_reasoning = snap.get("reasoning") is not None

    pricing = snap.get("pricing") or {}
    # These are per-token in output.json; the ledger's own figures are already per-1M.
    cache_read = _to_float(pricing.get("input_cache_read"))
    cache_write = _to_float(pricing.get("input_cache_write"))
    row.cache_read_per_m = cache_read * 1e6 if cache_read is not None else None
    row.cache_write_per_m = cache_write * 1e6 if cache_write is not None else None
    # web_search is billed per call, not per token — no conversion.
    row.web_search_per_call = _to_float(pricing.get("web_search"))
