-- Landlord disputes feature
-- Allows landlords to challenge reviews for their properties

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE,
  landlord_name TEXT NOT NULL,
  landlord_email TEXT NOT NULL,
  landlord_phone TEXT NOT NULL,
  dispute_reasons TEXT NOT NULL,  -- JSON array of selected reasons
  dispute_explanation TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  resolution_outcome TEXT CHECK (resolution_outcome IN ('uphold', 'dismiss', 'partially_valid')),
  resolution_notes TEXT,
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_review_id ON disputes(review_id);
CREATE INDEX IF NOT EXISTS idx_disputes_created_at ON disputes(created_at);
