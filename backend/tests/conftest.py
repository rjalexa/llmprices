import json
from pathlib import Path

import pytest

from atlas.db import connect, migrate
from atlas.ingest.families import load_roster
from atlas.ingest.run import ingest

FIXTURES = Path(__file__).parent / "fixtures"
CONFIG = Path(__file__).parents[2] / "config" / "families.yaml"

BLEND = (3.0, 1.0)

# Read from the fixture rather than hardcoded: refreshing the fixture moves the
# ledger's as-of date, and every "runs to today" assertion keys off it.
LEDGER_AS_OF: str = json.loads((FIXTURES / "prices.json").read_text())["as_of"]


@pytest.fixture(scope="session")
def roster():
    return load_roster(CONFIG)


@pytest.fixture(scope="session")
def db(tmp_path_factory, roster):
    """Ingest the checked-in fixture once. Never touches the network."""
    path = tmp_path_factory.mktemp("atlas") / "atlas.db"
    conn = connect(path)
    ingest(
        conn,
        roster=roster,
        ledger_path=FIXTURES / "prices.json",
        snapshot_path=FIXTURES / "output.json",
    )
    yield conn
    conn.close()


@pytest.fixture
def blank_db(tmp_path):
    conn = connect(tmp_path / "blank.db")
    migrate(conn)
    yield conn
    conn.close()
