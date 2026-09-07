-- migrations/0029_building_records.sql
-- Public building records (spec: docs/superpowers/specs/2026-09-06-building-records-design.md)
--
-- parcel_id is the join key across City of Boston datasets. Stored in the 10-digit
-- form with the leading zero; adapters that need the numeric form strip it.
-- sam_id is Boston's address id, used by the violations and enforcement feeds.
--
-- PRODUCTION NOTE: the two ALTER TABLE ... ADD COLUMN statements are not idempotent
-- (SQLite has no IF NOT EXISTS for columns). Re-running this file fails with
-- "duplicate column name". Apply once with `wrangler d1 execute --remote --file`,
-- never `migrations apply --remote`. See migrations/AGENTS.md.
ALTER TABLE buildings ADD COLUMN parcel_id TEXT;
ALTER TABLE buildings ADD COLUMN sam_id TEXT;
CREATE INDEX IF NOT EXISTS idx_buildings_parcel_id ON buildings(parcel_id);

-- One row per source run. Insert-only. This is the provenance for every record.
CREATE TABLE IF NOT EXISTS record_pulls (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  jurisdiction TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_label TEXT NOT NULL,
  query TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','empty','error')),
  row_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  triggered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  correction_id TEXT,
  retrieved_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_record_pulls_building ON record_pulls(building_id, source_id, retrieved_at);

-- One row per record. payload is JSON validated on read against the kind's type.
CREATE TABLE IF NOT EXISTS building_records (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  pull_id TEXT NOT NULL REFERENCES record_pulls(id),
  -- MAINTENANCE: a new record kind (e.g. sub-project B's entity record) must be added
  -- here in a rebuild migration AND to RECORD_KINDS in src/lib/records/types.ts.
  kind TEXT NOT NULL CHECK (kind IN ('assessment','permit','violation','enforcement_ticket','service_request','rentsmart')),
  source_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  source_url TEXT,
  -- Reset on every re-pull: rows a source owns are deleted and re-inserted. Not a first-seen date.
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (building_id, kind, source_key)
);
CREATE INDEX IF NOT EXISTS idx_building_records_building_kind ON building_records(building_id, kind);

-- Public "report a record error" submissions. The only resolution is a re-pull.
CREATE TABLE IF NOT EXISTS record_corrections (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  record_kind TEXT,
  claim TEXT NOT NULL,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  resolution TEXT CHECK (resolution IN ('repulled_unchanged','repulled_updated','source_mismatch_noted')),
  resolution_notes TEXT,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_record_corrections_status ON record_corrections(status, created_at);
