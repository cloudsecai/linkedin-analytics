-- Migration 010: Author profile for personal context in generation
CREATE TABLE IF NOT EXISTS author_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  profile_text TEXT NOT NULL DEFAULT '',
  profile_json TEXT NOT NULL DEFAULT '{}',
  interview_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profile_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript_json TEXT NOT NULL,
  extracted_profile TEXT,
  duration_seconds INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE generations ADD COLUMN personal_connection TEXT;
