-- The public records button's daily cap counts button rows in a rolling 24 h window:
--   SELECT COUNT(*), MIN(requested_at) FROM records_queue WHERE reason = 'button' AND requested_at >= ?
-- Neither 0031 nor 0032 indexes (reason, requested_at); button rows are never purged, so
-- that count scanned a growing table on every unauthenticated request. Applied by hand
-- (see migrations/AGENTS.md); safe to re-run.
CREATE INDEX IF NOT EXISTS idx_records_queue_reason_requested ON records_queue(reason, requested_at);
