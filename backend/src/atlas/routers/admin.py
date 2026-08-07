import secrets
import sqlite3

from fastapi import APIRouter, Header, HTTPException

from ..config import settings
from ..deps import Conn
from ..ingest.families import FamilyConfigError
from ..ingest.run import ingest
from ..models import RefreshResponse

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/refresh", response_model=RefreshResponse)
def refresh(
    conn: sqlite3.Connection = Conn,
    x_atlas_token: str = Header(default="", alias="X-Atlas-Token"),
) -> RefreshResponse:
    """Lets the UI's "Refresh data" button work without shelling into the container."""
    if not settings.admin_token:
        raise HTTPException(503, "refresh is disabled: ATLAS_ADMIN_TOKEN is not set")
    if not secrets.compare_digest(x_atlas_token, settings.admin_token):
        raise HTTPException(401, "invalid admin token")

    try:
        result = ingest(conn)
    except FamilyConfigError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - surface upstream failures to the UI
        raise HTTPException(502, f"ingest failed: {exc}") from exc

    return RefreshResponse(
        status="skipped" if result.skipped else "ok",
        detail=result.summary(),
        models_seen=result.models_seen,
        points_written=result.points_written,
    )
