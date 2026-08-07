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
