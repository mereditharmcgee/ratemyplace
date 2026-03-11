CREATE TABLE bug_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT,
  category TEXT NOT NULL DEFAULT 'bug',
  description TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  admin_notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_bug_reports_status ON bug_reports(status);
CREATE INDEX idx_bug_reports_created ON bug_reports(created_at DESC);
