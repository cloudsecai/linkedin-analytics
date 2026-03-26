CREATE TABLE IF NOT EXISTS scrape_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL,
  error_type TEXT NOT NULL,       -- 'dom_change', 'timeout', 'auth', 'network'
  page_type TEXT NOT NULL,        -- 'analytics', 'post_detail', 'audience', 'feed'
  selector TEXT,                  -- which CSS selector failed
  message TEXT NOT NULL,
  consecutive_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  UNIQUE(persona_id, error_type, page_type)
);
