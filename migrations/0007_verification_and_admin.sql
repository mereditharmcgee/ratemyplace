-- Add admin flag to users
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- Add verification columns to reviews
ALTER TABLE reviews ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reviews ADD COLUMN verified_at INTEGER;
ALTER TABLE reviews ADD COLUMN verified_by TEXT REFERENCES users(id);

-- Verification images table
CREATE TABLE IF NOT EXISTS verification_images (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_at INTEGER NOT NULL DEFAULT (unixepoch()),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_at INTEGER,
    reviewed_by TEXT REFERENCES users(id),
    rejection_reason TEXT
);

CREATE INDEX idx_verification_images_review ON verification_images(review_id);
CREATE INDEX idx_verification_images_status ON verification_images(status);
CREATE INDEX idx_verification_images_user ON verification_images(user_id);
