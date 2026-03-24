-- Migration 015: Multi-persona support

-- Create personas table
CREATE TABLE IF NOT EXISTS personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  linkedin_url TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('personal', 'company_page')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default persona from existing data (or placeholder)
-- Use INSERT OR IGNORE for idempotency if migration runs twice
INSERT OR IGNORE INTO personas (id, name, linkedin_url, type)
VALUES (1, 'Default', 'https://www.linkedin.com/', 'personal');

-- Add persona_id to posts
ALTER TABLE posts ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_posts_persona ON posts(persona_id);

-- Recreate follower_snapshots with composite primary key (date, persona_id)
-- Current schema: date DATE PRIMARY KEY — would conflict with multiple personas on same day
CREATE TABLE follower_snapshots_new (
  date DATE NOT NULL,
  persona_id INTEGER NOT NULL DEFAULT 1,
  total_followers INTEGER NOT NULL,
  PRIMARY KEY (date, persona_id)
);
INSERT INTO follower_snapshots_new (date, persona_id, total_followers)
SELECT date, 1, total_followers FROM follower_snapshots;
DROP TABLE IF EXISTS follower_snapshots;
ALTER TABLE follower_snapshots_new RENAME TO follower_snapshots;

-- Recreate profile_snapshots with composite primary key (date, persona_id)
-- Same issue: date DATE PRIMARY KEY conflicts with multi-persona
CREATE TABLE profile_snapshots_new (
  date DATE NOT NULL,
  persona_id INTEGER NOT NULL DEFAULT 1,
  profile_views INTEGER,
  search_appearances INTEGER,
  all_appearances INTEGER,
  PRIMARY KEY (date, persona_id)
);
INSERT INTO profile_snapshots_new (date, persona_id, profile_views, search_appearances, all_appearances)
SELECT date, 1, profile_views, search_appearances, all_appearances FROM profile_snapshots;
DROP TABLE IF EXISTS profile_snapshots;
ALTER TABLE profile_snapshots_new RENAME TO profile_snapshots;

-- Add persona_id to generation_rules
ALTER TABLE generation_rules ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Add persona_id to coaching_insights
ALTER TABLE coaching_insights ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Add persona_id to generation_research
ALTER TABLE generation_research ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Add persona_id to generations
ALTER TABLE generations ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Add persona_id to research_sources
ALTER TABLE research_sources ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Add persona_id to ai_runs
ALTER TABLE ai_runs ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Add persona_id to scrape_log
ALTER TABLE scrape_log ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Add persona_id to golden_posts
ALTER TABLE golden_posts ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Add persona_id to coaching_syncs
ALTER TABLE coaching_syncs ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Add company-page-specific analytics columns to post_metrics
ALTER TABLE post_metrics ADD COLUMN clicks INTEGER;
ALTER TABLE post_metrics ADD COLUMN click_through_rate REAL;
ALTER TABLE post_metrics ADD COLUMN follows INTEGER;
ALTER TABLE post_metrics ADD COLUMN engagement_rate REAL;

-- Recreate author_profile without CHECK (id = 1) constraint
-- SQLite doesn't support DROP CONSTRAINT, so we recreate the table
CREATE TABLE author_profile_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL DEFAULT 1 UNIQUE,
  profile_text TEXT NOT NULL DEFAULT '',
  profile_json TEXT NOT NULL DEFAULT '{}',
  interview_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO author_profile_new (id, persona_id, profile_text, profile_json, interview_count, created_at, updated_at)
SELECT id, 1, profile_text, profile_json, interview_count, created_at, updated_at
FROM author_profile;

DROP TABLE IF EXISTS author_profile;
ALTER TABLE author_profile_new RENAME TO author_profile;

-- Add persona_id to profile_interviews
ALTER TABLE profile_interviews ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Add persona_id to writing_prompt_history
ALTER TABLE writing_prompt_history ADD COLUMN persona_id INTEGER NOT NULL DEFAULT 1;

-- Per-persona sync state: each persona tracks its own last sync timestamp
-- Convert existing last_sync_at setting to persona-scoped key
UPDATE settings SET key = 'last_sync_at:1' WHERE key = 'last_sync_at';
