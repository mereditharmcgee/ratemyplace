-- Expand audit_logs action_type / entity_type constraints to cover every action
-- the application actually writes.
--
-- WHY: migration 0014 froze the CHECK lists at 13 action types and 4 entity types.
-- Since then the app grew nine action types and four entity types that violate one
-- or both constraints. createAuditLog() is best-effort (try/catch + console.error),
-- so every one of those inserts has been failing SILENTLY — the admin action
-- succeeds, no audit row is written, and nothing surfaces.
--
-- Actions that were being dropped on the floor:
--   admin_granted / admin_revoked   (entity 'user')        <- the Aug 2026 sweep
--                                                             added these believing
--                                                             admin grant/revoke was
--                                                             now tracked. It was not.
--   verification_approved / _rejected (entity 'verification')
--   manager_created / manager_updated (entity 'manager')
--   bug_report_updated                (entity 'bug_report')
--   landlord_created
--   buildings_bulk_deleted
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt (same approach
-- as 0014). Existing rows are preserved.
--
-- PRODUCTION NOTE: migrations 0025-0027 were applied via the Cloudflare dashboard
-- console, so wrangler's migration tracking is not authoritative for this database.
--
-- APPLIED TO PRODUCTION 2026-08-26 via `wrangler d1 execute --remote --file`, NOT
-- `migrations apply --remote` (which would have attempted to re-run the
-- dashboard-applied 0025-0027, including the non-idempotent DROP COLUMN batch).
-- 55 rows backed up beforehand; verified 55 rows and ids 1-55 intact afterward.

CREATE TABLE IF NOT EXISTS audit_logs_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    admin_user_id TEXT NOT NULL,
    admin_ip TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN (
        -- reviews
        'review_approved', 'review_rejected', 'review_flagged', 'review_pending',
        'review_deleted',
        -- disputes
        'dispute_resolved', 'dispute_dismissed', 'dispute_upheld', 'dispute_partially_valid',
        -- landlords
        'landlord_created', 'landlord_updated', 'landlord_deleted',
        -- buildings
        'building_updated', 'building_deleted', 'buildings_bulk_deleted',
        -- property managers
        'manager_created', 'manager_updated',
        -- verification
        'verification_approved', 'verification_rejected',
        -- users / admin privilege
        'admin_granted', 'admin_revoked',
        -- bug reports
        'bug_report_updated'
    )),
    -- MAINTENANCE: this list must be extended in the same change that introduces a
    -- new action type. A missing value fails the INSERT, and createAuditLog is
    -- best-effort, so the failure is invisible unless you are reading logs.
    entity_type TEXT NOT NULL CHECK (entity_type IN (
        'review', 'dispute', 'landlord', 'building',
        'manager', 'verification', 'user', 'bug_report'
    )),
    entity_id TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    notes TEXT
);

INSERT INTO audit_logs_v3 (
    id, created_at, admin_user_id, admin_ip, action_type,
    entity_type, entity_id, old_value, new_value, notes
)
SELECT
    id, created_at, admin_user_id, admin_ip, action_type,
    entity_type, entity_id, old_value, new_value, notes
FROM audit_logs;

DROP TABLE audit_logs;

ALTER TABLE audit_logs_v3 RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
