CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'review_approved', 'review_rejected', 'review_disputed', 'dispute_resolved'
  )),
  review_id TEXT REFERENCES reviews(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;

ALTER TABLE users ADD COLUMN notification_opt_in INTEGER NOT NULL DEFAULT 1;
