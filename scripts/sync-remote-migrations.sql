-- Sync d1_migrations tracking table for remote/production D1
-- Run this ONCE to mark all 15 existing migrations as applied.
-- The tables already exist in production; this just updates the tracking.
--
-- Usage:
--   npx wrangler d1 execute ratemyplace-db --remote --file=scripts/sync-remote-migrations.sql

INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_initial.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0002_add_place_id.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0003_add_oauth.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0004_survey_scores.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0005_missing_columns.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0006_property_managers.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0007_verification_and_admin.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0008_laundry_utilities.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0009_admin_notes.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0010_rate_limits.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0011_verification_tokens.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0012_disputes.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0013_audit_logs.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0014_audit_landlord_actions.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0015_password_reset_tokens.sql');
