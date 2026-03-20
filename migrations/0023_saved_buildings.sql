CREATE TABLE IF NOT EXISTS saved_buildings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(user_id, building_id)
);
CREATE INDEX idx_saved_buildings_user ON saved_buildings(user_id);
