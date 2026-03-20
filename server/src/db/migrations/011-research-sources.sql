-- Migration 011: Research sources for RSS-powered research
CREATE TABLE IF NOT EXISTS research_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'rss',
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO research_sources (name, feed_url) VALUES
  ('no.security', 'https://no.security/rss.xml'),
  ('tl;dr sec', 'https://rss.beehiiv.com/feeds/xgTKUmMmUm.xml'),
  ('Import AI', 'https://importai.substack.com/feed'),
  ('AI News', 'https://news.smol.ai/rss.xml'),
  ('Axios', 'https://api.axios.com/feed/');
