# LLM Price Atlas — Implementation Plan

**Handoff spec for a coding assistant.** Everything below marked *(verified)* was checked against
the live data source on 2026-08-06; treat those facts as ground truth rather than re-deriving them.

**Goal.** A small self-hosted app that ingests ~2 years of OpenRouter per-token pricing for a curated
roster of frontier / Chinese / Mistral models, stores it in SQLite, and serves an interactive chart
where **the price jump from one model generation to the next is the visually dominant feature**.

**Stack (fixed).** `uv` + Python + FastAPI + SQLite backend · TypeScript + React + Vite + `pnpm`
frontend · Dockerfiles + Compose for lifecycle.

---

## 1. Data source

### 1.1 What we pull

Upstream repo: **[`jvrck/openrouterlist`](https://github.com/jvrck/openrouterlist)** (MIT). A GitHub Action
snapshots `https://openrouter.ai/api/v1/models` every 12h (00:00 and 12:00 UTC) and commits the result.
Two files matter:

| File | Raw URL | Role |
| --- | --- | --- |
| `data/history/prices.json` | `https://raw.githubusercontent.com/jvrck/openrouterlist/main/data/history/prices.json` | **The time series.** Pre-built change-point ledger. |
| `data/output.json` | `https://raw.githubusercontent.com/jvrck/openrouterlist/main/data/output.json` | **Current metadata.** Full OpenRouter model objects as of today. |

We do **not** clone the repo or walk git history. One HTTP GET each, ~200 KB + ~535 KB. *(verified)*

### 1.2 `prices.json` schema *(verified)*

```jsonc
{
  "as_of": "2026-08-06",
  "model_count": 920,
  "models": {
    "z-ai/glm-5.2": {
      "name": "Z.ai: GLM 5.2",
      "first_seen": "2026-06-17",
      "last_seen":  "2026-08-06",
      "present_now": true,
      "points": [                      // CHANGE POINTS ONLY, ascending by date
        ["2026-06-17", 1.4, 4.4],      // [date, prompt USD/1M, completion USD/1M]
        ["2026-06-19", 1.2, 4.1],
        ["2026-06-22", 1.0, 4.0]
        // ... 62 points total for this model
      ]
    }
  }
}
```

Confirmed properties:

- Prices are already **USD per 1,000,000 tokens** (display units). No conversion needed.
  (`output.json` by contrast is per-token — `"0.00000125"` = `$1.25/M`. Don't mix them up.)
- `points` records **only changes**. A model whose price never moved has exactly **one** point.
  Building a dense series therefore requires **forward-fill** (last-value-carried-forward).
- `null` in a price slot = unpriced / `-1` sentinel. Skip, don't coerce to 0.
- `openrouter/auto` is excluded upstream.
- Coverage: **2024-09-21 → 2026-08-06**, 920 models, 339 currently live. *(verified)*

### 1.3 Known gotchas — handle these explicitly

1. **Left truncation.** 177 models carry `first_seen == "2024-09-21"`, which is the ledger's epoch, not
   their launch date. *(verified)* e.g. `openai/gpt-4o` shows `first_seen=2024-09-21` but its real
   `created` is `2024-05-13`; `anthropic/claude-3-haiku` → `2024-03-13`; `mistralai/mistral-large` →
   `2024-02-26`. **Fix:** take the release date from `output.json`'s `created` (unix ts), fall back to
   `first_seen` only when `created` is absent. Set a `date_is_censored` flag when
   `first_seen == '2024-09-21'` and render those series with a left-edge fade + tooltip note.
2. **Dead models.** `present_now: false` → the step line must **stop at `last_seen`**, not run to today.
3. **What the number actually means.** This is OpenRouter's advertised price for the default routed
   provider of that model, not the vendor's own list price. For open-weight models it moves constantly
   because OpenRouter re-routes between hosts — `z-ai/glm-5.2` has **62** change points in seven weeks
   *(verified)*. OpenRouter's ~5.5% credit-purchase fee is **not** included in these per-token figures.
   Put this caveat in the UI footer, not just the README.
4. **Flat vs. decaying, by construction.** Closed frontier models (Anthropic, OpenAI, Google) almost
   always have exactly 1 change point — their price is fixed for the model's life, and all the movement
   is *generational*. Open/Chinese models have 10–60 points of *within-model* decay. **The chart must
   make both readable at once.** This is the single most important design constraint.
5. **Variant suffixes.** `:thinking`, `-fast`, `-pro`, `-max`, `-image`, `:free` are separate model IDs.
   The curated roster (§2) decides which are lineage members and which are side variants.
6. **Cached-token prices are current-only.** `output.json` exposes `input_cache_read`,
   `input_cache_write`, `input_cache_write_1h`, `web_search` *(verified)*, but the ledger does not carry
   their history. Store them as present-day attributes on `models`; do **not** promise a cache-price
   time series.

---

## 2. Curated roster — `config/families.yaml`

Lineages are **declared, not inferred**. Auto-parsing model IDs misgroups `gpt-5.6-luna`,
`kimi-k2.7-code`, `claude-opus-4.7-fast`, and every `:thinking` variant, so we keep an explicit file
that a human edits when a new model ships.

**All 93 IDs below were verified to exist in the ledger with real dates and prices** *(verified
2026-08-06)*: 20 families, **83 lineage members** (582 change points) plus **10 side variants**
(70 points) — **652 points total**, and **63 generational handoffs**. Ship this as the seed file.

```yaml
# config/families.yaml
# ordinal is implicit: list order == generational order.
# release_date is optional; when omitted the backend uses output.json `created`, then first_seen.
meta:
  blend_ratio: {input: 3, output: 1}   # blended $/1M = (3*prompt + 1*completion) / 4

families:
  - key: anthropic-opus
    label: "Claude Opus"
    vendor: Anthropic
    group: frontier-us
    members: [anthropic/claude-opus-4, anthropic/claude-opus-4.1, anthropic/claude-opus-4.5,
              anthropic/claude-opus-4.6, anthropic/claude-opus-4.7, anthropic/claude-opus-4.8,
              anthropic/claude-opus-5]
    variants: [anthropic/claude-opus-4.7-fast, anthropic/claude-opus-4.8-fast, anthropic/claude-opus-5-fast]

  - key: anthropic-sonnet
    label: "Claude Sonnet"
    vendor: Anthropic
    group: frontier-us
    members: [anthropic/claude-sonnet-4, anthropic/claude-sonnet-4.5,
              anthropic/claude-sonnet-4.6, anthropic/claude-sonnet-5]

  - key: anthropic-haiku
    label: "Claude Haiku"
    vendor: Anthropic
    group: frontier-us
    members: [anthropic/claude-3-haiku, anthropic/claude-haiku-4.5]

  - key: openai-flagship
    label: "OpenAI flagship"
    vendor: OpenAI
    group: frontier-us
    members: [openai/gpt-4o, openai/gpt-4.1, openai/gpt-5, openai/gpt-5.1, openai/gpt-5.2,
              openai/gpt-5.4, openai/gpt-5.5, openai/gpt-5.6-luna]

  - key: openai-mini
    label: "OpenAI mini"
    vendor: OpenAI
    group: frontier-us
    members: [openai/gpt-4o-mini, openai/gpt-4.1-mini, openai/gpt-5-mini, openai/gpt-5.4-mini]

  - key: openai-codex
    label: "OpenAI Codex"
    vendor: OpenAI
    group: frontier-us
    members: [openai/gpt-5.1-codex, openai/gpt-5.1-codex-max, openai/gpt-5.2-codex, openai/gpt-5.3-codex]

  - key: google-pro
    label: "Gemini Pro"
    vendor: Google
    group: frontier-us
    members: [google/gemini-2.5-pro, google/gemini-3.1-pro-preview]

  - key: google-flash
    label: "Gemini Flash"
    vendor: Google
    group: frontier-us
    members: [google/gemini-2.5-flash, google/gemini-3-flash-preview,
              google/gemini-3.5-flash, google/gemini-3.6-flash]

  - key: xai-grok
    label: "Grok"
    vendor: xAI
    group: frontier-us
    members: [x-ai/grok-4.20, x-ai/grok-4.3, x-ai/grok-4.5]

  - key: deepseek-v
    label: "DeepSeek V"
    vendor: DeepSeek
    group: china
    members: [deepseek/deepseek-chat, deepseek/deepseek-chat-v3-0324, deepseek/deepseek-chat-v3.1,
              deepseek/deepseek-v3.1-terminus, deepseek/deepseek-v3.2,
              deepseek/deepseek-v4-flash, deepseek/deepseek-v4-flash-0731, deepseek/deepseek-v4-pro]

  - key: deepseek-r
    label: "DeepSeek R"
    vendor: DeepSeek
    group: china
    members: [deepseek/deepseek-r1, deepseek/deepseek-r1-0528]

  - key: qwen-flagship
    label: "Qwen flagship"
    vendor: Alibaba
    group: china
    members: [qwen/qwen3-235b-a22b, qwen/qwen3-235b-a22b-2507, qwen/qwen3-max,
              qwen/qwen3.5-397b-a17b]
    variants: [qwen/qwen3-max-thinking, qwen/qwen3-235b-a22b-thinking-2507]

  - key: qwen-coder
    label: "Qwen Coder"
    vendor: Alibaba
    group: china
    members: [qwen/qwen3-coder, qwen/qwen3-coder-plus, qwen/qwen3-coder-next]

  - key: kimi
    label: "Kimi"
    vendor: Moonshot AI
    group: china
    members: [moonshotai/kimi-k2, moonshotai/kimi-k2-0905, moonshotai/kimi-k2.5,
              moonshotai/kimi-k2.6, moonshotai/kimi-k3]
    variants: [moonshotai/kimi-k2-thinking, moonshotai/kimi-k2.7-code]

  - key: glm
    label: "GLM"
    vendor: Z.ai
    group: china
    members: [z-ai/glm-4.5, z-ai/glm-4.6, z-ai/glm-4.7, z-ai/glm-5, z-ai/glm-5.1, z-ai/glm-5.2]
    variants: [z-ai/glm-4.5-air, z-ai/glm-4.7-flash, z-ai/glm-5-turbo]

  - key: minimax
    label: "MiniMax"
    vendor: MiniMax
    group: china
    members: [minimax/minimax-m1, minimax/minimax-m2, minimax/minimax-m2.1,
              minimax/minimax-m2.5, minimax/minimax-m2.7, minimax/minimax-m3]

  - key: tencent
    label: "Hunyuan"
    vendor: Tencent
    group: china
    members: [tencent/hunyuan-a13b-instruct, tencent/hy3]

  - key: mistral-large
    label: "Mistral Large"
    vendor: Mistral
    group: eu
    members: [mistralai/mistral-large-2407, mistralai/mistral-large-2512]

  - key: mistral-medium
    label: "Mistral Medium"
    vendor: Mistral
    group: eu
    members: [mistralai/mistral-medium-3, mistralai/mistral-medium-3.1, mistralai/mistral-medium-3-5]

  - key: mistral-small
    label: "Mistral Small"
    vendor: Mistral
    group: eu
    members: [mistralai/mistral-small-24b-instruct-2501, mistralai/mistral-small-3.1-24b-instruct,
              mistralai/mistral-small-3.2-24b-instruct, mistralai/mistral-small-2603]
```

**Validation rule:** ingest must fail loudly if a YAML id is absent from the ledger — that's how we
learn a model was renamed or retired. Emit the list of unknown ids and exit non-zero.

---

## 3. Repository layout

```
llm-price-atlas/
├── compose.yaml
├── compose.dev.yaml
├── .env.example
├── README.md
├── config/
│   └── families.yaml
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml            # uv-managed
│   ├── uv.lock
│   └── src/atlas/
│       ├── __init__.py
│       ├── main.py               # FastAPI app factory
│       ├── config.py             # pydantic-settings
│       ├── db.py                 # sqlite3 connection, PRAGMAs, migrations runner
│       ├── migrations/
│       │   └── 001_init.sql
│       ├── models.py             # pydantic response schemas
│       ├── ingest/
│       │   ├── fetch.py          # HTTP GET + ETag caching
│       │   ├── parse.py          # ledger + snapshot -> normalized rows
│       │   ├── families.py       # YAML load + validation
│       │   └── run.py            # `atlas ingest` CLI entrypoint
│       ├── series.py             # forward-fill, resample, blend
│       ├── releases.py           # generational delta computation
│       └── routers/
│           ├── catalog.py
│           ├── series.py
│           └── releases.py
├── frontend/
│   ├── Dockerfile
│   ├── package.json              # pnpm
│   ├── vite.config.ts
│   ├── nginx.conf
│   └── src/
│       ├── main.tsx
│       ├── api/client.ts         # generated types from OpenAPI (optional)
│       ├── components/
│       │   ├── PriceTimeline.tsx      # the hero chart
│       │   ├── ReleaseMarkers.tsx
│       │   ├── HandoffConnectors.tsx
│       │   ├── FamilyPicker.tsx
│       │   ├── Controls.tsx
│       │   └── Tooltip.tsx
│       ├── lib/scales.ts, colors.ts, format.ts
│       └── state/useAtlasStore.ts     # zustand
└── data/                          # sqlite volume mount (gitignored)
    └── atlas.db
```

---

## 4. Backend

### 4.1 SQLite schema — `migrations/001_init.sql`

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys  = ON;

CREATE TABLE models (
  id                 TEXT PRIMARY KEY,          -- 'anthropic/claude-sonnet-5'
  name               TEXT NOT NULL,
  vendor             TEXT NOT NULL,             -- id prefix before '/'
  release_date       TEXT,                      -- from output.json `created`, else first_seen
  first_seen         TEXT NOT NULL,
  last_seen          TEXT NOT NULL,
  present_now        INTEGER NOT NULL,
  date_is_censored   INTEGER NOT NULL DEFAULT 0,-- first_seen == ledger epoch
  context_length     INTEGER,
  modality           TEXT,
  is_reasoning       INTEGER,
  cache_read_per_m   REAL,                      -- present-day only
  cache_write_per_m  REAL,
  web_search_per_call REAL
);

-- change points only; dense series is computed, never stored
CREATE TABLE price_points (
  model_id      TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,                  -- YYYY-MM-DD
  prompt_per_m  REAL,
  completion_per_m REAL,
  PRIMARY KEY (model_id, day)
) WITHOUT ROWID;
CREATE INDEX idx_pp_day ON price_points(day);

CREATE TABLE families (
  key    TEXT PRIMARY KEY,
  label  TEXT NOT NULL,
  vendor TEXT NOT NULL,
  grp    TEXT NOT NULL                          -- frontier-us | china | eu
);

CREATE TABLE family_members (
  family_key TEXT NOT NULL REFERENCES families(key) ON DELETE CASCADE,
  model_id   TEXT NOT NULL REFERENCES models(id)   ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL,                  -- generation index within family
  is_variant INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (family_key, model_id)
);

CREATE TABLE ingest_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  ledger_as_of  TEXT,
  models_seen   INTEGER,
  points_written INTEGER,
  status        TEXT NOT NULL,                  -- ok | failed
  error         TEXT
);
```

### 4.2 Ingest — `atlas ingest`

Idempotent, safe to re-run. Steps:

1. Load + validate `config/families.yaml`. Collect the roster id set.
2. `GET` both raw URLs with `If-None-Match`; cache ETags in a small `.cache/` file. `304` on both →
   log "no change", exit 0.
3. Parse ledger → for each roster id, upsert `models` row and replace its `price_points`
   (delete-then-insert inside one transaction; the ledger is authoritative).
4. Enrich from `output.json`: `created` → `release_date` (unix ts → `YYYY-MM-DD`), `context_length`,
   `architecture.modality`, `reasoning` presence, and per-token → per-million conversion (`* 1e6`) for
   `input_cache_read` / `input_cache_write` / `web_search`.
5. Rebuild `families` + `family_members` from YAML (ordinal = list index).
6. Write `ingest_runs` row.

Also expose it as `POST /api/admin/refresh` guarded by an `ATLAS_ADMIN_TOKEN` header, so the UI's
"Refresh data" button works without shelling into the container. Run on container start if the DB is
empty; otherwise let a Compose-level cron/manual call handle it (upstream only updates twice a day).

### 4.3 Series computation — `series.py`

The one piece of real logic. Given a set of model ids and a date window:

```python
def dense_series(points, first_day, last_day, granularity="day"):
    """Change points -> dense stepped series.
    - forward-fill (last value carried forward)
    - clip left at max(first_day, model.first_seen)
    - clip right at min(last_day, model.last_seen)   <-- dead models must not extend
    - leave None where the model was unpriced
    """
```

Blended price: `(3 * prompt + 1 * completion) / 4` (input:output = 3:1, from `meta.blend_ratio`).
Expose `metric = prompt | completion | blended` on every series endpoint.

Keep the payload small: return **change points plus explicit window bounds**, not 700 daily rows per
model. The frontend draws `curveStepAfter`, so it only needs the vertices. Document this in the
response schema (`"encoding": "step-after"`).

### 4.4 Release deltas — `releases.py`

For each family, for each consecutive pair `(prev, next)` by `ordinal`:

- `launch_date` = `next.release_date`
- `prev_price_at_launch` = forward-filled `prev` price on `launch_date` (fall back to `prev`'s last
  known price if `prev` was already retired)
- `delta_pct` per metric
- `direction` ∈ `{cheaper, pricier, flat}` (flat when `|delta| < 1%`)

This is precomputed per request (it's tiny — 85 models, 593 points) and returned as first-class objects
so the frontend can draw connectors and labels without re-deriving anything.

### 4.5 API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | `{status, ledger_as_of, last_ingest}` |
| `GET` | `/api/families` | families + ordered members + release dates + censored flags |
| `GET` | `/api/models` | `?family=&group=&vendor=` — catalog rows |
| `GET` | `/api/series` | `?ids=a,b&metric=blended&from=&to=` → `[{model_id, points:[[day,val]], first_day, last_day, encoding}]` |
| `GET` | `/api/releases` | `?family=` → generational deltas (§4.4) |
| `GET` | `/api/snapshot` | `?date=YYYY-MM-DD` → forward-filled price for every roster model on that day (powers the scrubber) |
| `GET` | `/api/export.csv` | `?ids=&metric=` → long-format CSV, for pasting into a sheet |
| `POST` | `/api/admin/refresh` | token-guarded ingest trigger |

FastAPI serves OpenAPI at `/openapi.json`; generate frontend types from it with
`openapi-typescript` in a `pnpm gen:api` script.

---

## 5. Frontend — making the generational jump obvious

### 5.1 Hero: stepped price timeline with release handoffs

Single full-width chart, x = time (2024-09 → today), y = USD/1M tokens on a **log scale** (the roster
spans `$0.03` to `$75` — linear is unreadable). Layers, back to front:

1. **Step lines.** One `curveStepAfter` path per model, clipped to its live window. Steps are correct
   here and matter: prices change discretely, and a smooth line would imply gradual drift that doesn't
   exist.
2. **Generational color ramp.** Each family gets one hue; each member gets a lightness step along that
   hue by `ordinal` (oldest = lightest, newest = darkest/saturated). Reading a family left-to-right,
   you literally watch it darken as generations advance. Use `d3.interpolateHcl` between a family's
   light and dark anchors so lightness steps stay perceptually even regardless of member count.
3. **Release markers.** At each member's `release_date`: a short vertical tick from the axis plus a
   small dot on the new model's first price point. Labels are collision-resolved with a simple
   force-based y-nudge (`d3.forceSimulation` with `forceY` + `forceCollide`), rendered only for the
   focused family to avoid soup.
4. **Handoff connectors — the key element.** A dashed elbow from *(launch_date, predecessor's price on
   that date)* to *(launch_date, successor's launch price)*. It's a vertical segment at the launch date
   spanning exactly the generational price gap, capped with an arrowhead pointing at the new price and
   labelled with the signed delta:

   ```
   Sonnet 4.6  ────────────────┐
                               │ −33%
   Sonnet 5                    └──────────────
   ```

   Green when cheaper, amber when pricier, grey when flat. **This is what turns "two lines on a chart"
   into "the generation got 33% cheaper."** Verified examples the connector should produce:

   | Handoff | Date | Input | Output | Label |
   | --- | --- | --- | --- | --- |
   | Sonnet 4.6 → Sonnet 5 | 2026-07-01 | $3.00 → $2.00 | $15.00 → $10.00 | **−33%** |
   | Opus 4.1 → Opus 4.5 | 2025-11-25 | $15.00 → $5.00 | $75.00 → $25.00 | **−67%** |
   | GPT-5.5 → GPT-5.6 Luna | 2026-07-10 | $5.00 → $1.00 | $30.00 → $6.00 | **−80%** |
   | DeepSeek V3.2 → V4 Flash | 2026-04-24 | $0.252 → $0.14 | $0.378 → $0.28 | **−44% / −26%** |
   | GLM 5.1 → GLM 5.2 | 2026-06-17 | $0.98 → $1.40 | $3.08 → $4.40 | **+43%** |
   | Kimi K2.6 → K3 | 2026-07-17 | $0.95 → $3.00 | $4.00 → $15.00 | **+216% / +275%** |

   *(all verified against the ledger — use them as fixture assertions)*

   Note the last two: **generations are not always cheaper.** Don't hard-code a "prices fall" narrative
   in the styling or copy.
5. **Censored-start fade.** Models with `date_is_censored` get a left-edge gradient-to-transparent so
   the 2024-09-21 wall doesn't read as a synchronized launch event.

### 5.2 Secondary views (tabs, same store)

- **Generational ladder** — small multiples, one panel per family, x = ordinal, y = launch price.
  Answers "is each generation cheaper than the last" at a glance, across all 20 families at once.
- **Snapshot table** — all roster models priced on a scrubbed date, sortable, with sparklines.
- **Decay view** — x = days since that model's launch, y = price indexed to 100 at launch. Overlays
  every model on a common origin and shows the open-weight price collapse (GLM 5.2 −46% in 7 weeks)
  next to the closed models' dead-flat lines.

### 5.3 Controls

Family multi-select grouped by `frontier-us` / `china` / `eu` (with "select group" shortcuts) ·
metric toggle (input / output / blended) · log-linear toggle · date brush · "cheaper-only" filter on
handoffs · CSV export · dark mode. Persist selection in the URL query string so views are shareable.

### 5.4 Libraries

`d3` (scales, shapes, force — not for DOM), React for rendering SVG, `zustand` for state,
`@tanstack/react-query` for fetching, `tailwind` for layout. Chart is hand-rolled SVG: the handoff
connectors and per-family color ramps are past what a chart library gives you cheaply.

---

## 6. Docker & lifecycle

**`backend/Dockerfile`** — multi-stage on `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`:
`uv sync --frozen --no-dev` into `/app/.venv`, copy `src/`, non-root user, `CMD ["uvicorn",
"atlas.main:app", "--host", "0.0.0.0", "--port", "8000"]`. Healthcheck hits `/api/health`.

**`frontend/Dockerfile`** — `node:22-alpine` + `corepack enable pnpm`, `pnpm install --frozen-lockfile`,
`pnpm build`, then `nginx:alpine` serving `dist/` with `/api` proxied to `backend:8000`.

**`compose.yaml`** — `backend` (volume `./data:/app/data`, `ATLAS_DB=/app/data/atlas.db`,
`./config:/app/config:ro`) + `frontend` (port `5173:80`, `depends_on: backend healthy`). Add an
`ingest` profile service that runs `uv run atlas ingest` and exits, so `docker compose --profile ingest
up ingest` is the refresh command.

**`compose.dev.yaml`** — override with bind-mounted source, `uvicorn --reload`, and Vite dev server on
5173 with HMR proxying to the backend.

---

## 7. Milestones

| # | Deliverable | Done when |
| --- | --- | --- |
| M0 | Scaffold: repo layout, uv + pnpm projects, both Dockerfiles, compose up serves a stub | `docker compose up` → frontend renders, `/api/health` returns 200 |
| M1 | Ingest + schema | `atlas ingest` populates 93 models / 652 price points; re-run is a no-op; unknown YAML id fails loudly |
| M2 | Series + releases API | `/api/series` and `/api/releases` return correct values for the §5.1 fixture table |
| M3 | Hero chart | Step lines + ramp + markers + handoff connectors, log scale, family picker |
| M4 | Secondary views, export, URL state, dark mode | Ladder + snapshot + decay tabs work off the same store |
| M5 | Polish | Caveat footer, censored-start fade, empty/error states, README with the §1.3 gotchas |

## 8. Acceptance criteria

Write these as tests against a **checked-in fixture** copy of `prices.json` (don't hit the network in
CI):

1. Ingest of the seed roster yields exactly **93 models** (83 members + 10 variants) across **20
   families**, **652 price points**, and **63 handoff pairs**; zero unknown ids.
2. `z-ai/glm-5.2` has **62** change points; `anthropic/claude-sonnet-5` has **1**.
3. Forward-fill: `anthropic/claude-sonnet-4.5` priced on `2026-01-01` returns `$3.00 / $15.00`,
   despite having no point on that date.
4. Dead-model clipping: a model with `present_now: false` returns no value after its `last_seen`.
5. Release delta `anthropic/claude-sonnet-4.6 → anthropic/claude-sonnet-5` = **−33.3%** on both metrics.
6. Release delta `moonshotai/kimi-k2.6 → moonshotai/kimi-k3` = **+215.8% input / +275.0% output**
   (proves the sign handling and the "not always cheaper" path).
7. `openai/gpt-4o` reports `release_date = 2024-05-13` (from `created`), **not** `2024-09-21`, and
   `date_is_censored = true`.
8. Blended metric: `anthropic/claude-sonnet-5` = `(3*2.0 + 10.0)/4` = **$4.00/M**.
9. `/api/export.csv` round-trips into a DataFrame with no null model ids.

---

### Appendix: quick sanity command

```bash
curl -s https://raw.githubusercontent.com/jvrck/openrouterlist/main/data/history/prices.json \
| python3 -c "import json,sys; d=json.load(sys.stdin); \
print(d['as_of'], d['model_count'], d['models']['anthropic/claude-sonnet-5']['points'])"
# -> 2026-08-06 920 [['2026-07-01', 2.0, 10.0]]
```
