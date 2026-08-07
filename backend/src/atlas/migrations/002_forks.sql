-- Tier fan-outs: one model splitting into multiple successors (§forks in
-- config/families.yaml). Rebuilt wholesale on every ingest, like families.
CREATE TABLE forks (
  from_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  to_id   TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,               -- position within the fork's `to` list
  PRIMARY KEY (from_id, to_id)
) WITHOUT ROWID;
