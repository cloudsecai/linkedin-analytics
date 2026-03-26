-- User identity for API authentication
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Default User',
  api_token TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Link personas to users
ALTER TABLE personas ADD COLUMN user_id INTEGER REFERENCES users(id);
