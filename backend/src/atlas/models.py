"""Pydantic response schemas. These drive /openapi.json, which the frontend
turns into TypeScript via `pnpm gen:api`."""

from pydantic import BaseModel, Field


class Health(BaseModel):
    status: str
    ledger_as_of: str | None = None
    last_ingest: str | None = None
    model_count: int = 0


class ModelRow(BaseModel):
    id: str
    name: str
    vendor: str
    release_date: str | None = None
    first_seen: str
    last_seen: str
    present_now: bool
    date_is_censored: bool = Field(
        description="first_seen is the ledger epoch, not a real launch date"
    )
    context_length: int | None = None
    modality: str | None = None
    is_reasoning: bool | None = None
    cache_read_per_m: float | None = None
    cache_write_per_m: float | None = None
    web_search_per_call: float | None = Field(
        default=None, description="billed per call, not per token"
    )
    family_key: str | None = None
    ordinal: int | None = None
    is_variant: bool = False


class FamilyMember(BaseModel):
    model_id: str
    name: str
    ordinal: int
    is_variant: bool
    release_date: str | None = None
    first_seen: str
    last_seen: str
    present_now: bool
    date_is_censored: bool


class Family(BaseModel):
    key: str
    label: str
    vendor: str
    group: str
    members: list[FamilyMember]
    variants: list[FamilyMember]


class FamiliesResponse(BaseModel):
    families: list[Family]
    blend_ratio: dict[str, float]
    window: dict[str, str | None]


class Series(BaseModel):
    model_id: str
    points: list[tuple[str, float | None]]
    first_day: str | None
    last_day: str | None
    encoding: str = Field(
        default="step-after",
        description="Vertices only; draw with curveStepAfter and hold the last "
        "value through last_day.",
    )


class SeriesResponse(BaseModel):
    metric: str
    series: list[Series]


class Handoff(BaseModel):
    family_key: str
    prev_id: str
    next_id: str
    prev_name: str
    next_name: str
    launch_date: str
    prev_price: dict[str, float | None]
    next_price: dict[str, float | None]
    delta_pct: dict[str, float | None]
    direction: dict[str, str]
    kind: str = Field(
        default="succession",
        description="succession = consecutive generations in one family; "
        "fork = a tier branching off a declared fan-out",
    )


class ReleasesResponse(BaseModel):
    handoffs: list[Handoff]


class SnapshotRow(BaseModel):
    model_id: str
    name: str
    vendor: str
    live: bool
    prompt: float | None
    completion: float | None
    blended: float | None


class SnapshotResponse(BaseModel):
    date: str
    rows: list[SnapshotRow]


class RefreshResponse(BaseModel):
    status: str
    detail: str
    models_seen: int
    points_written: int
