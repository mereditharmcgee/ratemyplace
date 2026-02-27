-- Audit log table for tracking admin actions
-- Immutable: INSERT-only, no UPDATE/DELETE
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    admin_user_id TEXT NOT NULL,
    admin_ip TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN (
        'review_approved', 'review_rejected', 'review_flagged', 'review_pending',
        'review_deleted',
        'dispute_resolved', 'dispute_dismissed', 'dispute_upheld', 'dispute_partially_valid'
    )),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('review', 'dispute')),
    entity_id TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    notes TEXT
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
