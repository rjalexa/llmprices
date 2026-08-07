import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .config import settings

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else settings.db
    if str(path) != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # WAL is a persistent DB property; the rest are per-connection.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    else:
        conn.commit()


def migrate(conn: sqlite3.Connection) -> list[str]:
    """Apply any migration files not yet recorded in schema_migrations."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "  name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    conn.commit()
    applied = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations")}
    ran = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if path.name in applied:
            continue
        with transaction(conn):
            conn.executescript(path.read_text())
            conn.execute("INSERT INTO schema_migrations (name) VALUES (?)", (path.name,))
        ran.append(path.name)
    return ran


def is_empty(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='models'"
    ).fetchone()
    if row is None:
        return True
    return conn.execute("SELECT COUNT(*) AS n FROM models").fetchone()["n"] == 0
