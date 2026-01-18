-- Add OAuth provider support to users table
-- Migration for v0.3.0-alpha

-- Allow null hashed_password for OAuth-only users
-- Add google_id for Google OAuth linking

ALTER TABLE users ADD COLUMN google_id TEXT;
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

CREATE UNIQUE INDEX idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

-- Make hashed_password nullable for OAuth users
-- SQLite doesn't support ALTER COLUMN, so this is just documentation
-- New OAuth users will be inserted with NULL hashed_password
