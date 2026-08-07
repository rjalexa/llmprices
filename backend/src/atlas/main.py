import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import connect, is_empty, migrate
from .routers import admin, catalog, releases, series

log = logging.getLogger("atlas")

# uvicorn configures only its own loggers, so without this the first-boot
# ingest — a ~30s network fetch — would run with no output at all in
# `docker compose logs`.
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = connect()
    migrate(conn)
    app.state.conn = conn

    if settings.ingest_on_empty and is_empty(conn):
        # First boot: pull upstream so the container comes up with a usable DB.
        # Failure here must not stop the app — /api/health still answers, and the
        # UI can show an empty state and offer a retry.
        from .ingest.run import ingest

        try:
            log.info("empty database; running initial ingest")
            log.info(ingest(conn).summary())
        except Exception:
            log.exception("initial ingest failed; starting with an empty database")

    try:
        yield
    finally:
        conn.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="LLM Price Atlas",
        version="0.1.0",
        description=(
            "Per-token pricing history for a curated roster of frontier, Chinese "
            "and Mistral models, sourced from OpenRouter via jvrck/openrouterlist."
        ),
        lifespan=lifespan,
    )

    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    for module in (catalog, series, releases, admin):
        app.include_router(module.router)

    return app


app = create_app()
