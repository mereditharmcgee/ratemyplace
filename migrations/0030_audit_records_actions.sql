-- migrations/0030_audit_records_actions.sql
-- Add the two audit action types the public-records feature writes:
--   records_pulled              (entity 'building')  admin ran a record pull
--   record_correction_resolved  (entity 'building')  admin closed a correction
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt (0014/0028 pattern).
--
-- PRODUCTION NOTE: apply with `wrangler d1 execute --remote --file`, never
-- `migrations apply --remote`. Back up audit_logs first and verify row count after.

CREATE TABLE IF NOT EXISTS audit_logs_v4 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    admin_user_id TEXT NOT NULL,
    admin_ip TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN (
        'review_approved', 'review_rejected', 'review_flagged', 'review_pending',
        'review_deleted',
        'dispute_resolved', 'dispute_dismissed', 'dispute_upheld', 'dispute_partially_valid',
        'landlord_created', 'landlord_updated', 'landlord_deleted',
        'building_updated', 'building_deleted', 'buildings_bulk_deleted',
        'manager_created', 'manager_updated',
        'verification_approved', 'verification_rejected',
        'admin_granted', 'admin_revoked',
        'bug_report_updated',
        -- public records (migration 0030)
        'records_pulled', 'record_correction_resolved'
    )),
    entity_type TEXT NOT NULL CHECK (entity_type IN (
        'review', 'dispute', 'landlord', 'building',
        'manager', 'verification', 'user', 'bug_report'
    )),
    entity_id TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    notes TEXT
);

INSERT INTO audit_logs_v4 (
    id, created_at, admin_user_id, admin_ip, action_type,
    entity_type, entity_id, old_value, new_value, notes
)
SELECT
    id, created_at, admin_user_id, admin_ip, action_type,
    entity_type, entity_id, old_value, new_value, notes
FROM audit_logs;

DROP TABLE audit_logs;

ALTER TABLE audit_logs_v4 RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
