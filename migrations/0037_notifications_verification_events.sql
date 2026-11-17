-- migrations/0037_notifications_verification_events.sql
-- Add the two notification events a proof-of-address decision writes:
--   verification_approved  the review's author gets the Verified badge
--   verification_rejected  the document was not accepted (the reason is on the profile)
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt the way 0028 and 0030
-- rebuilt audit_logs: create notifications_v2, copy every row with its id, drop, rename,
-- recreate the two indexes. Everything except the CHECK list is 0021's definition, column for
-- column, default for default, foreign key for foreign key, index for index.
--
-- No PRAGMA, unlike 0016. Nothing references notifications, so the DROP cascades nothing,
-- and the copy keeps every row's user_id and review_id, which already satisfy the same two
-- foreign keys. D1 also ignores `PRAGMA foreign_keys = OFF` inside its transaction.
--
-- AUTOINCREMENT: the copy keeps every id, and the next id is one above the highest kept id.
-- An id freed by a deleted notification (a review or user deleted) above that can be issued
-- again. Nothing refers to a notification's id, so that is harmless.
--
-- A re-run is harmless only while this is the newest rebuild of the table. Once a later
-- migration rebuilds it, re-running this file would put this CHECK list back, so after
-- applying it, do not re-run it.
--
-- If a run stops after the INSERT and before the DROP, the original table is untouched and a
-- re-run fails at the INSERT on a duplicate id. Drop the copy table
-- (DROP TABLE notifications_v2) and run the file again. If a run stops between the DROP and
-- the RENAME, a re-run stops at the INSERT (no notifications table to copy from) and changes
-- nothing; finish by hand with the RENAME and the two CREATE INDEX statements below.
--
-- PRODUCTION NOTE: apply with `wrangler d1 execute --remote --file`, never
-- `migrations apply --remote`, and before the branch that writes the two new events is pushed
-- or its preview is used. Previews share the production D1 binding, so a preview runs this
-- code against production. In any case apply it before merging to main, which auto-deploys.
-- See migrations/AGENTS.md for the confirm-first count.

CREATE TABLE IF NOT EXISTS notifications_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'review_approved', 'review_rejected', 'review_disputed', 'dispute_resolved',
    -- proof-of-address decisions (migration 0037)
    'verification_approved', 'verification_rejected'
  )),
  -- MAINTENANCE: extend this list in the same change that adds a NotificationEventType in
  -- src/lib/notifications.ts. A missing value fails the INSERT, and createNotification is
  -- best-effort, so the notice is lost with only a `notification_write_failed` log line.
  review_id TEXT REFERENCES reviews(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO notifications_v2 (id, user_id, event_type, review_id, message, read_at, created_at)
SELECT id, user_id, event_type, review_id, message, read_at, created_at
FROM notifications;

DROP TABLE notifications;

ALTER TABLE notifications_v2 RENAME TO notifications;

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
