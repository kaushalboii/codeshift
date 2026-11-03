-- CodeShift Database Schema (Cloudflare D1 / SQLite)
-- For persistent room metadata, access permissions, and analytics

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  creator_user_id TEXT NOT NULL,
  password_hash TEXT,
  is_read_only INTEGER DEFAULT 0,
  language TEXT DEFAULT 'javascript',
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  code TEXT NOT NULL,
  lines INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rooms_last_activity ON rooms(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_room ON snapshots(room_id, created_at DESC);

