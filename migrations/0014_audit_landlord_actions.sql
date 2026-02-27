-- Add landlord actions to audit log
-- SQLite doesn't support ALTER CHECK, so we recreate the table

-- Create new table with expanded constraints
CREATE TABLE IF NOT EXISTS audit_logs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    admin_user_id TEXT NOT NULL,
    admin_ip TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN (
        'review_approved', 'review_rejected', 'review_flagged', 'review_pending',
        'review_deleted',
        'dispute_resolved', 'dispute_dismissed', 'dispute_upheld', 'dispute_partially_valid',
        'landlord_deleted', 'landlord_updated',
        'building_deleted', 'building_updated'
    )),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('review', 'dispute', 'landlord', 'building')),
    entity_id TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    notes TEXT
);

-- Copy existing data
INSERT INTO audit_logs_new SELECT * FROM audit_logs;

-- Drop old table
DROP TABLE audit_logs;

-- Rename new table
ALTER TABLE audit_logs_new RENAME TO audit_logs;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
