import csv
import io
from datetime import date

import pytest
from fastapi.testclient import TestClient

from atlas.config import settings
from atlas.db import connect
from atlas.ingest.run import ingest
from atlas.main import create_app

from .conftest import CONFIG, FIXTURES, LEDGER_AS_OF


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    """Runs the real app against a fixture-ingested database, no network."""
    db_path = tmp_path_factory.mktemp("api") / "atlas.db"
    conn = connect(db_path)
    ingest(
        conn,
        ledger_path=FIXTURES / "prices.json",
        snapshot_path=FIXTURES / "output.json",
    )
    conn.close()

    original = (settings.db, settings.ingest_on_empty, settings.families_file)
    settings.db, settings.ingest_on_empty, settings.families_file = db_path, False, CONFIG
    try:
        with TestClient(create_app()) as c:
            yield c
    finally:
        settings.db, settings.ingest_on_empty, settings.families_file = original


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["ledger_as_of"] == LEDGER_AS_OF
    assert body["model_count"] == 96


def test_families_shape(client):
    body = client.get("/api/families").json()
    assert len(body["families"]) == 22
    assert body["blend_ratio"] == {"input": 3.0, "output": 1.0}
    assert body["window"] == {"from": "2024-09-21", "to": LEDGER_AS_OF}

    glm = next(f for f in body["families"] if f["key"] == "glm")
    assert [m["ordinal"] for m in glm["members"]] == [0, 1, 2, 3, 4, 5]
    assert len(glm["variants"]) == 3


def test_models_filter_by_group(client):
    rows = client.get("/api/models", params={"group": "eu"}).json()
    assert rows
    assert {r["vendor"] for r in rows} == {"mistralai"}


def test_series_encoding_and_window(client):
    body = client.get(
        "/api/series",
        params={"ids": "anthropic/claude-sonnet-5", "metric": "prompt"},
    ).json()
    series = body["series"][0]
    assert series["encoding"] == "step-after"
    assert series["points"] == [["2026-07-01", 2.0]]
    assert series["first_day"] == "2026-07-01"
    assert series["last_day"] == LEDGER_AS_OF


def test_series_clips_to_requested_window(client):
    body = client.get(
        "/api/series",
        params={
            "ids": "anthropic/claude-sonnet-4.5",
            "metric": "prompt",
            "from": "2026-01-01",
            "to": "2026-02-01",
        },
    ).json()
    series = body["series"][0]
    assert series["first_day"] == "2026-01-01"
    assert series["last_day"] == "2026-02-01"
    # carried in from before the window rather than starting late
    assert series["points"][0] == ["2026-01-01", 3.0]


def test_series_rejects_missing_ids(client):
    assert client.get("/api/series").status_code == 422


def test_releases_filtered_by_family(client):
    body = client.get("/api/releases", params={"family": "anthropic-sonnet"}).json()
    assert {h["family_key"] for h in body["handoffs"]} == {"anthropic-sonnet"}
    assert len(body["handoffs"]) == 3


def test_snapshot_marks_unlaunched_models_not_live(client):
    body = client.get("/api/snapshot", params={"date": "2024-10-01"}).json()
    rows = {r["model_id"]: r for r in body["rows"]}
    assert rows["anthropic/claude-sonnet-5"]["live"] is False
    assert rows["anthropic/claude-sonnet-5"]["blended"] is None


def test_export_csv_round_trips_with_no_null_ids(client):
    """§8.9"""
    res = client.get("/api/export.csv", params={"metric": "blended"})
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]

    rows = list(csv.DictReader(io.StringIO(res.text)))
    assert rows
    assert all(r["model_id"] for r in rows)
    assert all(r["day"] for r in rows)
    assert {"model_id", "name", "vendor", "day", "blended"} == set(rows[0])


def test_export_csv_dense_fills_every_day(client):
    res = client.get(
        "/api/export.csv",
        params={"ids": "anthropic/claude-sonnet-5", "metric": "prompt", "dense": "true"},
    )
    rows = list(csv.DictReader(io.StringIO(res.text)))
    expected_days = (date.fromisoformat(LEDGER_AS_OF) - date(2026, 7, 1)).days + 1
    assert len(rows) == expected_days
    assert {r["prompt"] for r in rows} == {"2.0"}


def test_admin_refresh_disabled_without_token(client):
    assert client.post("/api/admin/refresh").status_code == 503


def test_admin_refresh_rejects_bad_token(client):
    settings.admin_token = "secret"
    try:
        assert client.post("/api/admin/refresh").status_code == 401
        res = client.post("/api/admin/refresh", headers={"X-Atlas-Token": "wrong"})
        assert res.status_code == 401
    finally:
        settings.admin_token = ""
