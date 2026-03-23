-- Store the user's final published text and the LLM's analysis of what changed
ALTER TABLE generations ADD COLUMN published_text TEXT;
ALTER TABLE generations ADD COLUMN retro_json TEXT;
ALTER TABLE generations ADD COLUMN retro_at TEXT;
