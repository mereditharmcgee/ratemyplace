-- migrations/0031_boston_coverage.sql
-- Boston coverage, sub-project C (spec: docs/superpowers/specs/2026-09-08-boston-coverage-design.md)
--
-- PRODUCTION NOTE: the ALTER TABLE ... ADD COLUMN statements are not idempotent (SQLite
-- has no IF NOT EXISTS for columns). Apply once with `wrangler d1 execute --remote --file`,
-- never `migrations apply --remote`. See migrations/AGENTS.md.
--
-- Statement order is deliberate but not purely idempotent-first: idx_buildings_street sits
-- after three of the ALTERs because it indexes street_key, a column those ALTERs add.
-- Recovering a partial failure is therefore two steps, in this order: re-run only the ALTERs
-- that did not land, THEN re-run this file's CREATE INDEX IF NOT EXISTS statements, which are
-- idempotent and cost nothing when the index already exists. Do not reorder the statements to
-- make the recovery one step; the index cannot be created before its column. Before applying,
-- read the live schema and confirm buildings has none of source, street_key, st_num_lo,
-- st_num_hi and record_pulls has no trigger_reason.

-- One row per pending pull. A building has at most one pending row; finished rows are
-- kept (button rows forever, as the record that a reader asked; refresh/fill rows 90 days).
-- AUTOINCREMENT so a queue id is never reused after a delete (ids appear in admin and logs).
CREATE TABLE IF NOT EXISTS records_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('button','follower','refresh','fill')),
  priority INTEGER NOT NULL,
  requested_at INTEGER NOT NULL DEFAULT (unixepoch()),
  locked_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  done_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_queue_pending_building ON records_queue(building_id) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_records_queue_pending ON records_queue(priority, requested_at) WHERE done_at IS NULL;

-- Small operator switches. First key: records_fill_paused ('1' or '0').
-- updated_at defaults on insert but does not self-update: a writer that flips a value
-- must set it explicitly.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Which pipeline created the row. Seeded rows come from the assessor bulk download.
ALTER TABLE buildings ADD COLUMN source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','seed'));
-- Normalized street name plus abbreviated suffix, e.g. 'LANARK RD', and the house-number
-- range (equal for a single number). Populated by the seed for Boston rows and by the
-- building-creation endpoint for anything created afterwards. Reviewer dedupe and the
-- seed's existing-row matching both look up on (city, street_key) then range-contain.
ALTER TABLE buildings ADD COLUMN street_key TEXT;
ALTER TABLE buildings ADD COLUMN st_num_lo INTEGER;
ALTER TABLE buildings ADD COLUMN st_num_hi INTEGER;
CREATE INDEX IF NOT EXISTS idx_buildings_street ON buildings(city, street_key);

-- Why a pull ran, for pulls with no admin behind them. triggered_by stays a users(id)
-- foreign key (0029); a seed or queue pull leaves it NULL and says why here.
ALTER TABLE record_pulls ADD COLUMN trigger_reason TEXT;
