import sqlite3

from fastapi import APIRouter, Query

from ..deps import Conn, blend_ratio
from ..models import Handoff, ReleasesResponse
from ..releases import compute_handoffs

router = APIRouter(prefix="/api", tags=["releases"])


@router.get("/releases", response_model=ReleasesResponse)
def releases(
    conn: sqlite3.Connection = Conn,
    family: str | None = Query(None, description="restrict to one family key"),
) -> ReleasesResponse:
    handoffs = compute_handoffs(conn, blend_ratio(), family)
    return ReleasesResponse(handoffs=[Handoff(**h.__dict__) for h in handoffs])
