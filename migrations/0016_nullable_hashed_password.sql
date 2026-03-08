-- Make hashed_password nullable for OAuth-only users
-- D1/SQLite doesn't support ALTER COLUMN, so we recreate the table

PRAGMA foreign_keys = OFF;

-- Step 1: Create new table with nullable hashed_password
CREATE TABLE users_new (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    hashed_password TEXT,
    google_id TEXT,
    name TEXT,
    avatar_url TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Step 2: Copy all existing data
INSERT INTO users_new SELECT id, email, email_verified, hashed_password, google_id, name, avatar_url, is_admin, created_at, updated_at FROM users;

-- Step 3: Drop old table
DROP TABLE users;

-- Step 4: Rename new table
ALTER TABLE users_new RENAME TO users;

-- Step 5: Recreate indexes
CREATE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

PRAGMA foreign_keys = ON;
