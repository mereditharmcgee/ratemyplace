-- migrations/0032_records_queue_indexes.sql
-- Indexes for the records queue planner and the fill circuit breaker (Boston coverage, sub-project C).
--
-- PRODUCTION NOTE: unlike 0029, 0030 and 0031, this file is FULLY IDEMPOTENT. Every
-- statement is a CREATE INDEX IF NOT EXISTS — no ALTER TABLE ADD COLUMN, no table rebuild —
-- so re-running it costs nothing and cannot half-apply. It is therefore safe either way:
-- `wrangler d1 execute --remote --file` (the pattern the earlier files force, since wrangler
-- does not know 0025-0031 ran) or `migrations apply`. It is the only file in this directory
-- since 0024 that carries no re-run hazard. Do not add a non-idempotent statement to it.

-- The planner asks "does this building have a pending row?" and "did anyone ever press the
-- button on it?" once per interest candidate. 0031 indexes records_queue(building_id) only
-- WHERE done_at IS NULL (the partial unique index that enforces one pending row), so the
-- finished-button lookup in the interest set had nothing to use and scanned the table. This
-- covers both, and enqueue's own pending-row SELECT as well.
CREATE INDEX IF NOT EXISTS idx_records_queue_building ON records_queue(building_id);

-- The interest set unions saved_buildings by building_id. 0023 indexes user_id and the
-- UNIQUE is (user_id, building_id), so building_id alone was a full scan.
CREATE INDEX IF NOT EXISTS idx_saved_buildings_building ON saved_buildings(building_id);

-- The breaker groups record_pulls by source over a trailing 24-hour window
-- (errorRateBySource: WHERE retrieved_at >= ? GROUP BY source_id). 0029's
-- idx_record_pulls_building leads with building_id, which that scan cannot use.
-- retrieved_at leads here so the window is a range seek; source_id and status follow so the
-- grouping and the error count are answered from the index. record_pulls only grows, so this
-- is the scan that gets slower every month the fill runs.
CREATE INDEX IF NOT EXISTS idx_record_pulls_retrieved ON record_pulls(retrieved_at, source_id, status);
