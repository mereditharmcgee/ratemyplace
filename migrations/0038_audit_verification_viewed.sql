-- migrations/0038_audit_verification_viewed.sql
-- Add the audit action an admin's view of a proof-of-address document writes:
--   verification_viewed  (entity 'verification')  admin opened the document
-- GET /api/admin/verification/[id] writes it before serving the file and refuses to serve
-- the file if it cannot (fail closed), so until this runs no document can be opened.
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt (0014/0028/0030 pattern):
-- create audit_logs_v5, copy every row with its id, drop, rename, recreate the four indexes.
-- Every column, default, allowed action and allowed entity is 0030's; only the one action is
-- new. 'verification' was already an allowed entity type.
--
-- No PRAGMA: audit_logs has no foreign keys and nothing references it. The copy keeps every
-- id, and no code deletes audit rows, so the AUTOINCREMENT counter carries on from the
-- highest id as before.
--
-- Re-running after a full run is safe: it rebuilds the table again with the same CHECK. If a
-- run stops between the DROP and the RENAME, a re-run stops at the INSERT (no audit_logs to
-- copy from) and changes nothing; finish by hand with the RENAME and the four CREATE INDEX
-- statements below.
--
-- PRODUCTION NOTE: apply with `wrangler d1 execute --remote --file`, never
-- `migrations apply --remote`, BEFORE the code that writes verification_viewed deploys.
-- Back up audit_logs first and verify the row count after. See migrations/AGENTS.md.

CREATE TABLE IF NOT EXISTS audit_logs_v5 (
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
        'bug_report_updated',
        -- public records (migration 0030)
        'records_pulled', 'record_correction_resolved',
        -- proof-of-address document views (migration 0038)
        'verification_viewed'
    )),
    -- MAINTENANCE: this list must be extended in the same change that introduces a
    -- new action type. A missing value fails the INSERT, and createAuditLog is
    -- best-effort, so the failure is invisible unless you are reading logs.
    -- verification_viewed is the exception: its writer fails closed, so a missing value
    -- stops every document view instead.
    entity_type TEXT NOT NULL CHECK (entity_type IN (
        'review', 'dispute', 'landlord', 'building',
        'manager', 'verification', 'user', 'bug_report'
    )),
    entity_id TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    notes TEXT
);

INSERT INTO audit_logs_v5 (
    id, created_at, admin_user_id, admin_ip, action_type,
    entity_type, entity_id, old_value, new_value, notes
)
SELECT
    id, created_at, admin_user_id, admin_ip, action_type,
    entity_type, entity_id, old_value, new_value, notes
FROM audit_logs;

DROP TABLE audit_logs;

ALTER TABLE audit_logs_v5 RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
