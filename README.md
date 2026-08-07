# LLM Price Atlas

Two years of OpenRouter per-token pricing for a curated roster of frontier, Chinese and Mistral
models — arranged so that **the price jump from one model generation to the next is the first thing
you see**.

**[→ Open the live atlas](https://rjalexa.github.io/llmprices/)**

[![Deploy to GitHub Pages](https://github.com/rjalexa/llmprices/actions/workflows/pages.yml/badge.svg)](https://github.com/rjalexa/llmprices/actions/workflows/pages.yml)

![The succession timeline: each vendor's flagship line, with the price delta at every
handoff and the GPT-5.6 tier fan-out](docs/screenshot.png)

The question it answers: *what was the best model from OpenAI over time, what did it cost, and what
superseded it?* — and the same for Anthropic, Google and Mistral.

Reading the shot above: OpenAI's flagship line runs GPT-4o → 4.1 (−20%) → 5 → 5.2 (+40%) → 5.4 →
5.5, then fans out at 5.6 into Sol (same price), Terra (−50%) and Luna (−80%). Claude Opus 4.1 →
4.5 halved twice over (−66.7%), and Fable opened a new tier at double Opus (+100%).

**Two ways to run it.** Self-hosted it is FastAPI + SQLite behind a React/TypeScript SVG chart, all
in Compose. For GitHub Pages there is no backend, so the whole atlas is baked into one 86 KB JSON
file and the browser does the forward-fill itself — same UI, same numbers.

---

## Quick start

```bash
cp .env.example .env          # optional; defaults work
docker compose up --build     # first boot ingests upstream automatically
# → http://localhost:5173
```

Refresh the data later (upstream publishes twice a day):

```bash
docker compose --profile ingest up ingest
```

Development, with backend reload and Vite HMR:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up
```

### Without Docker

```bash
# backend
uv sync --project backend
uv run --project backend atlas ingest
uv run --project backend uvicorn atlas.main:app --port 8000

# frontend (separate shell)
cd frontend && pnpm install && pnpm dev
```

### Building the static (backend-free) site

This is what CI deploys to Pages, and it runs anywhere that serves files:

```bash
uv run --project backend atlas ingest
uv run --project backend atlas export-static --out frontend/public/atlas.json
VITE_STATIC_DATA=1 VITE_BASE_PATH=/llmprices/ pnpm --dir frontend build
# → frontend/dist
```

`.github/workflows/pages.yml` does exactly that on every push to `main` and again each morning at
06:20 UTC, so the hosted copy tracks the ledger without anyone re-running it. `atlas.json` is
generated, never committed.

---

## What the numbers mean — read this before quoting any of them

These are the five things that most often lead people to misread this data.

1. **It is OpenRouter's advertised price for the default routed provider**, not the vendor's own
   list price. For open-weight models it moves constantly because OpenRouter re-routes between
   hosts: `z-ai/glm-5.2` logged 39 distinct daily prices in its first seven weeks. A closed model
   like `anthropic/claude-sonnet-5` has exactly **one** — its price is fixed for the model's life
   and all the movement is generational. **The chart has to make both readable at once**; that is
   its central design constraint.
2. **OpenRouter's ~5.5% credit-purchase fee is not included.** Neither are cached-token reads or
   web-search calls.
3. **The ledger starts 2024-09-21 and that is not a launch date.** 177 upstream models (including
   `openai/gpt-4o`, `anthropic/claude-3-haiku`, `mistralai/mistral-large`) carry that date as
   `first_seen` simply because it is when the snapshotting began. The backend takes the real launch
   date from OpenRouter's `created` field where it exists — `gpt-4o` correctly reports
   `2024-05-13` — and flags the rest with `date_is_censored`, which the chart renders as a faded
   left edge so the wall never reads as a synchronised launch event.
4. **Generations are not always cheaper.** `kimi-k2.6 → kimi-k3` is **+216% input / +275% output**;
   `glm-5.1 → glm-5.2` is **+43%**. Nothing in the styling or copy assumes prices fall.
5. **Cached-token prices are present-day only.** Upstream carries no history for them, so they are
   stored as current attributes on `models` and there is deliberately no cache-price time series.

Source: [`jvrck/openrouterlist`](https://github.com/jvrck/openrouterlist) (MIT), which snapshots
`https://openrouter.ai/api/v1/models` every 12 hours.

---

## The chart

**Hero timeline** — x = time, y = USD per 1M tokens on a log scale (the roster spans `$0.03` to
`$75`; linear is unreadable). It has two line modes:

- **Succession** (default) — one line per family: at every date, the price of whichever model was
  the family's *current* one. Each member "reigns" from its own launch until its successor's, the
  line darkens at each generation, reign names sit on their segments, and the dashed connector at
  each handoff carries the signed delta. This is the view that answers "what was the best model
  from X at time T, what did it cost, and what superseded it" — the full-history view can't,
  because superseded models keep being served (and priced) long after they stop being current.
- **All models** — every member's full price history at once, for watching superseded models'
  routed prices continue to move after their reign ends.

**Tier fan-outs.** A generation does not always have one successor. GPT-5.6 shipped as **Sol /
Terra / Luna** on the same day, and Claude added **Fable** as a tier *above* Opus. A succession
chain can only express one successor, so splits are declared separately under `forks:` and drawn as
a bracket rather than three connectors stacked on one date:

```
GPT-5.5 ─────●┐
              ├─── Sol     $11.25    0%   (inherits the flagship line)
              ├─── Terra    $5.63  −50%
              └─── Luna     $2.25  −80%
```

Each branch is coloured by direction and labelled with its delta. The tier that inherits the
predecessor's line stays a normal succession — Sol continues *OpenAI flagship* at exactly GPT-5.5's
price, Luna continues *OpenAI mini*, and only Terra needed a family of its own. The bracket mirrors
to the left of the fork date when it would otherwise collide with the end-of-line labels.

Layers, back to front:

- **Step lines** (`curveStepAfter`). Prices change discretely; a smooth line would imply a gradual
  drift that does not exist. Each line is clipped to its model's own live window, so a retired
  model stops at `last_seen` instead of running to today.
- **Generational colour ramp.** One hue per family, lightness stepping by generation via
  `interpolateHcl`, so reading a family left to right you watch it darken as generations advance.
- **Release markers** at each member's first priced day, labels separated by a force simulation.
- **Handoff connectors** — the key element. A dashed elbow at the launch date spanning exactly the
  generational price gap, arrowhead on the new price, labelled with the signed delta. Green when
  cheaper, amber when pricier, grey when flat. This is what turns "two lines on a chart" into
  "the generation got 33% cheaper".
- **Censored-start fade** on left-truncated series.

**Ladder** — small multiples, one panel per family, x = generation, y = launch price. Answers "is
each generation cheaper than the last" across every family at once.

**Snapshot** — every selected model forward-filled to a scrubbed date, sortable, with sparklines.
This is also the table-view twin that keeps every value readable as text, not colour alone.

**Decay** — x = days since that model's own launch, y = price indexed to 100 at launch. Puts the
open-weight collapse directly beside the closed models' dead-flat lines.

Selection, metric, scale, range and theme all persist in the query string, so any view is a
shareable URL.

### Picking what to show

The roster picker is a **region → vendor → lineage** tree. Every level is clickable: the vendor row
selects or deselects that whole vendor at once, because people think in vendors ("show me OpenAI"),
not in lineages. Vendor rows carry a tri-state box — empty, dash for partial, tick for all.

### On colour

Families draw from **eight** validated categorical hues (worst adjacent CVD ΔE 9.1 light / 8.4
dark, verified with the palette validator rather than by eye). Eight is a hard cap: a ninth family
would need a generated hue that is not reliably distinguishable.

Two rules follow from that, and both are pinned by tests in `src/state/useAtlasStore.test.ts`:

- **Slots are held for as long as a family stays selected**, so toggling one lineage never repaints
  the others. A reader who learned "Opus is blue" keeps seeing blue. A freed slot is reused by the
  *next* family selected, never taken from a survivor.
- **The cap refuses out loud.** Hitting it shows a message naming what didn't fit; it never
  silently ignores a click. The live `n/8` budget beside "clear" keeps the limit from being a
  surprise, and selecting a vendor that doesn't fit adds what it can and says what it left.

---

## Layout

```
config/families.yaml     the curated roster — lineages and forks, declared not inferred
backend/src/atlas/
  ingest/                fetch (ETag-cached) → parse → validate → SQLite
  series.py              change points → stepped series; forward-fill, clip, blend
  releases.py            generational deltas
  routers/               catalog · series · releases · admin
frontend/src/
  api/                   live client + the static (baked-JSON) client
  components/            SuccessionTimeline, ForkConnectors, PriceTimeline, …
  lib/                   scales, colors, succession, labelPlacement, format
  state/                 zustand store + URL persistence (+ its tests)
docs/original-plan.md    the handoff spec this was built from
.github/workflows/       ingest → bake → build → deploy to Pages
```

### Adding a model

Edit `config/families.yaml` — list order is generational order — then re-run ingest. Lineages are
declared rather than parsed from ids on purpose: auto-parsing misgroups `gpt-5.6-luna`,
`kimi-k2.7-code`, `claude-opus-4.7-fast` and every `:thinking` variant. `variants:` members share
the family's hue but sit outside the generational sequence and never form handoffs.

When a generation fans out into tiers, add a `forks:` entry naming the model that was current and
every tier that came out of it. Fork targets must already be family members (a fork only draws the
*edge*; the line itself comes from the membership), and a pair that is already an in-family
succession is not duplicated as a branch.

**Ingest fails loudly** if a rostered id is absent upstream, printing the unknown ids and exiting
non-zero — that is how you find out a model was renamed or retired.

---

## API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | `{status, ledger_as_of, last_ingest, model_count}` |
| `GET` | `/api/families` | families + ordered members + release dates + censored flags |
| `GET` | `/api/models` | `?family=&group=&vendor=` |
| `GET` | `/api/series` | `?ids=a,b&metric=&from=&to=` → change points + window bounds |
| `GET` | `/api/releases` | `?family=` → generational deltas |
| `GET` | `/api/snapshot` | `?date=` → forward-filled prices for that day |
| `GET` | `/api/export.csv` | `?ids=&metric=&dense=` → long-format CSV |
| `POST` | `/api/admin/refresh` | requires `X-Atlas-Token`; 503 when `ATLAS_ADMIN_TOKEN` is unset |

`metric` is `prompt | completion | blended`; blended is `(3·input + 1·output) / 4`, configurable
via `meta.blend_ratio`.

`/api/series` returns **vertices only** with `"encoding": "step-after"`, not one row per day —
draw with `curveStepAfter` and hold the last value through `last_day`. `/api/export.csv?dense=true`
is the one place that expands to daily rows, for spreadsheet users.

OpenAPI lives at `/openapi.json`; `pnpm gen:api` turns it into TypeScript.

---

## Tests

```bash
uv run --project backend python -m pytest backend/tests -q   # backend
pnpm --dir frontend test                                     # selection-state store
```

56 tests, no network: they run against a trimmed fixture copy of the upstream ledger checked in at
`backend/tests/fixtures/`. They pin the §5.1 handoff table (Sonnet −33.3%, Opus −66.7%, Luna −80%,
Kimi +215.8%/+275.0%, …), the tier fan-outs (Terra −50%, Luna −80%, Fable +100%, Sol flat),
forward-fill, dead-model clipping, censored dates, blending and the CSV round-trip.

Assertions that depend on "runs to today" read the as-of date out of the fixture rather than
hardcoding it, so refreshing the fixture doesn't break the suite.

### Where the implementation departs from the original spec

The spec this was built from is kept verbatim at [`docs/original-plan.md`](docs/original-plan.md).
Everything below is a place the data disagreed with it.

- **Point counts.** The spec quotes 652 price points and 62 for `glm-5.2`. Those are raw ledger
  entries; because the upstream Action snapshots at 00:00 *and* 12:00 UTC, a price that moves twice
  in a day produces two entries sharing a date, and the schema keys `price_points` by
  `(model_id, day)`. Collapsing each day to its final state — the only value a day-granular step
  chart can render — is what the counts below reflect.
- **Roster size.** The spec's seed roster was 93 models / 20 families, with `gpt-5.6-luna` as the
  flagship line's successor. That missed the 5.6 tier split (Sol / Terra / Luna all shipped
  2026-07-10) and Claude Fable. Adding them makes it **96 models / 22 families**, of which 86 are
  lineage members and 10 are variants, giving **64 successions + 3 fork branches**.
- **`web_search` units.** The spec's ingest step converts it per-million alongside the cache fields;
  it is billed **per call** (`0.01` = 1¢), so it is stored unconverted in `web_search_per_call`.

A handful of ledger points are a genuine `$0.00` (a host briefly serving a model free). They are
real data, but they cannot be placed on a log or ratio axis, so the log timeline breaks the line
there and the decay view drops them rather than letting them collapse the domain.
