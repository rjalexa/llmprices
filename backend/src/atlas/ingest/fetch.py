import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import httpx


@dataclass
class Fetched:
    payload: dict
    from_cache: bool  # True when upstream answered 304 and we replayed the cached body


def _slot(cache_dir: Path, url: str) -> tuple[Path, Path]:
    stem = hashlib.sha256(url.encode()).hexdigest()[:16]
    return cache_dir / f"{stem}.json", cache_dir / f"{stem}.etag"


def fetch_json(url: str, cache_dir: Path, timeout: float = 60.0) -> Fetched:
    """GET with If-None-Match. Both the ETag and the body are cached, so a 304
    replays the stored body rather than leaving the caller with nothing."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    body_path, etag_path = _slot(cache_dir, url)

    headers = {}
    if etag_path.exists() and body_path.exists():
        headers["If-None-Match"] = etag_path.read_text().strip()

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(url, headers=headers)

    if resp.status_code == 304 and body_path.exists():
        return Fetched(payload=json.loads(body_path.read_text()), from_cache=True)

    resp.raise_for_status()
    payload = resp.json()
    body_path.write_text(json.dumps(payload))
    if etag := resp.headers.get("ETag"):
        etag_path.write_text(etag)
    return Fetched(payload=payload, from_cache=False)


def load_local(path: Path) -> Fetched:
    """Bypass the network — used by tests and by --ledger/--snapshot overrides."""
    return Fetched(payload=json.loads(Path(path).read_text()), from_cache=False)
