import sqlite3

from fastapi import APIRouter, Query

from ..deps import Conn, blend_ratio
from ..models import (
    FamiliesResponse,
    Family,
    FamilyMember,
    Health,
    ModelRow,
)

router = APIRouter(prefix="/api", tags=["catalog"])

_MEMBER_FIELDS = (
    "m.id, m.name, m.release_date, m.first_seen, m.last_seen, m.present_now, "
    "m.date_is_censored, fm.ordinal, fm.is_variant"
)


@router.get("/health", response_model=Health)
def health(conn: sqlite3.Connection = Conn) -> Health:
    run = conn.execute(
        "SELECT ledger_as_of, finished_at FROM ingest_runs "
        "WHERE status = 'ok' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    count = conn.execute("SELECT COUNT(*) AS n FROM models").fetchone()["n"]
    return Health(
        status="ok",
        ledger_as_of=run["ledger_as_of"] if run else None,
        last_ingest=run["finished_at"] if run else None,
        model_count=count,
    )


@router.get("/families", response_model=FamiliesResponse)
def families(conn: sqlite3.Connection = Conn) -> FamiliesResponse:
    rows = conn.execute(
        f"SELECT fm.family_key, {_MEMBER_FIELDS} "
        "FROM family_members fm JOIN models m ON m.id = fm.model_id "
        "ORDER BY fm.family_key, fm.is_variant, fm.ordinal"
    ).fetchall()

    grouped: dict[str, list] = {}
    for r in rows:
        grouped.setdefault(r["family_key"], []).append(r)

    out = []
    for f in conn.execute("SELECT key, label, vendor, grp FROM families ORDER BY grp, key"):
        entries = [
            FamilyMember(
                model_id=r["id"],
                name=r["name"],
                ordinal=r["ordinal"],
                is_variant=bool(r["is_variant"]),
                release_date=r["release_date"],
                first_seen=r["first_seen"],
                last_seen=r["last_seen"],
                present_now=bool(r["present_now"]),
                date_is_censored=bool(r["date_is_censored"]),
            )
            for r in grouped.get(f["key"], [])
        ]
        out.append(
            Family(
                key=f["key"],
                label=f["label"],
                vendor=f["vendor"],
                group=f["grp"],
                members=[e for e in entries if not e.is_variant],
                variants=[e for e in entries if e.is_variant],
            )
        )

    bounds = conn.execute(
        "SELECT MIN(day) AS lo, MAX(day) AS hi FROM price_points"
    ).fetchone()
    w_in, w_out = blend_ratio()
    return FamiliesResponse(
        families=out,
        blend_ratio={"input": w_in, "output": w_out},
        window={"from": bounds["lo"], "to": bounds["hi"]},
    )


@router.get("/models", response_model=list[ModelRow])
def models(
    conn: sqlite3.Connection = Conn,
    family: str | None = Query(None),
    group: str | None = Query(None),
    vendor: str | None = Query(None),
) -> list[ModelRow]:
    sql = (
        "SELECT m.*, fm.family_key, fm.ordinal, fm.is_variant "
        "FROM models m "
        "LEFT JOIN family_members fm ON fm.model_id = m.id "
        "LEFT JOIN families f ON f.key = fm.family_key WHERE 1=1"
    )
    params: list = []
    if family:
        sql += " AND fm.family_key = ?"
        params.append(family)
    if group:
        sql += " AND f.grp = ?"
        params.append(group)
    if vendor:
        sql += " AND m.vendor = ?"
        params.append(vendor)
    sql += " ORDER BY fm.family_key, fm.is_variant, fm.ordinal, m.id"

    return [
        ModelRow(
            id=r["id"],
            name=r["name"],
            vendor=r["vendor"],
            release_date=r["release_date"],
            first_seen=r["first_seen"],
            last_seen=r["last_seen"],
            present_now=bool(r["present_now"]),
            date_is_censored=bool(r["date_is_censored"]),
            context_length=r["context_length"],
            modality=r["modality"],
            is_reasoning=None if r["is_reasoning"] is None else bool(r["is_reasoning"]),
            cache_read_per_m=r["cache_read_per_m"],
            cache_write_per_m=r["cache_write_per_m"],
            web_search_per_call=r["web_search_per_call"],
            family_key=r["family_key"],
            ordinal=r["ordinal"],
            is_variant=bool(r["is_variant"]) if r["is_variant"] is not None else False,
        )
        for r in conn.execute(sql, params)
    ]
