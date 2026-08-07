from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# repo root when running from source: backend/src/atlas/config.py -> ../../..
_REPO_ROOT = Path(__file__).resolve().parents[3]

LEDGER_URL = "https://raw.githubusercontent.com/jvrck/openrouterlist/main/data/history/prices.json"
SNAPSHOT_URL = "https://raw.githubusercontent.com/jvrck/openrouterlist/main/data/output.json"

# The ledger's epoch. Any model whose first_seen equals this is left-truncated:
# the date is when the snapshotter started, not when the model launched.
LEDGER_EPOCH = "2024-09-21"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ATLAS_", env_file=".env", extra="ignore")

    db: Path = _REPO_ROOT / "data" / "atlas.db"
    families_file: Path = _REPO_ROOT / "config" / "families.yaml"
    cache_dir: Path = _REPO_ROOT / "data" / ".cache"

    ledger_url: str = LEDGER_URL
    snapshot_url: str = SNAPSHOT_URL

    admin_token: str = ""
    cors_origins: str = "http://localhost:5173,http://localhost:4173"

    # Ingest on startup when the DB has no models yet.
    ingest_on_empty: bool = True


settings = Settings()
