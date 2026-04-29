-- Phase 19: Performance indexes
-- Audit: .planning/audits/d1-indexes-2026-04-28.md
-- Added:
--   * reviews(building_id, status) — composite for search join (PERF-06, unconditional)
--     Column order: building_id first (join predicate, higher selectivity per building),
--     status second (ON-clause filter); satisfies both predicates in one lookup via
--     SQLite leftmost-prefix rule. Replaces current plan of idx_reviews_status alone.
-- Skipped (with reason):
--   * buildings(city) — no SELECT WHERE city = ? queries found in src/ (grep evidence in
--     audit doc Query 5; only UPDATE SET at api/admin/buildings/[id].ts:72)
--   * buildings(building_type) — no SELECT WHERE building_type = ? queries found in src/
--     (grep evidence in audit doc Query 5; only UPDATE SET at api/admin/buildings/[id].ts:92)
--   * rate_limits(rate_key, created_at) — existing idx_rate_limits_key already covers the
--     equality predicate; Query 4 EXPLAIN shows SEARCH USING INDEX idx_rate_limits_key;
--     created_at filter applies to at most ~60 in-memory rows per 60-second window

CREATE INDEX IF NOT EXISTS idx_reviews_building_status ON reviews(building_id, status);
