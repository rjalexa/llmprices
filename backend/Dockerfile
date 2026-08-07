# syntax=docker/dockerfile:1

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Dependencies resolve from the lockfile alone, so this layer survives source edits.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev


FROM python:3.12-slim-bookworm AS runtime

RUN useradd --create-home --uid 10001 atlas
WORKDIR /app

COPY --from=builder --chown=atlas:atlas /app/.venv /app/.venv
COPY --from=builder --chown=atlas:atlas /app/src /app/src

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ATLAS_DB=/app/data/atlas.db \
    ATLAS_FAMILIES_FILE=/app/config/families.yaml \
    ATLAS_CACHE_DIR=/app/data/.cache

RUN mkdir -p /app/data && chown atlas:atlas /app/data
USER atlas
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "atlas.main:app", "--host", "0.0.0.0", "--port", "8000"]
