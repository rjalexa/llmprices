import sqlite3
from functools import lru_cache

from fastapi import Depends, Request

from .config import settings
from .ingest.families import load_roster


@lru_cache(maxsize=1)
def blend_ratio() -> tuple[float, float]:
    """meta.blend_ratio from families.yaml, with a 3:1 fallback if the file is
    unreadable at request time (ingest already validated it at write time)."""
    try:
        return load_roster(settings.families_file).blend_ratio
    except Exception:
        return (3.0, 1.0)


def get_conn(request: Request) -> sqlite3.Connection:
    return request.app.state.conn


Conn = Depends(get_conn)


def csv_ids(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    return [part.strip() for part in raw.split(",") if part.strip()]
