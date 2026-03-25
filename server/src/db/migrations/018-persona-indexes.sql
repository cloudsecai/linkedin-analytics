-- Add missing persona_id indexes for tables that filter by persona_id
-- (posts already has idx_posts_persona from migration 015)
CREATE INDEX IF NOT EXISTS idx_generation_rules_persona ON generation_rules(persona_id);
CREATE INDEX IF NOT EXISTS idx_generations_persona ON generations(persona_id);
CREATE INDEX IF NOT EXISTS idx_generation_research_persona ON generation_research(persona_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_persona ON ai_runs(persona_id);
CREATE INDEX IF NOT EXISTS idx_research_sources_persona ON research_sources(persona_id);
CREATE INDEX IF NOT EXISTS idx_scrape_log_persona ON scrape_log(persona_id);
CREATE INDEX IF NOT EXISTS idx_coaching_insights_persona ON coaching_insights(persona_id);
CREATE INDEX IF NOT EXISTS idx_coaching_syncs_persona ON coaching_syncs(persona_id);
CREATE INDEX IF NOT EXISTS idx_writing_prompt_history_persona ON writing_prompt_history(persona_id);
CREATE INDEX IF NOT EXISTS idx_profile_interviews_persona ON profile_interviews(persona_id);
CREATE INDEX IF NOT EXISTS idx_golden_posts_persona ON golden_posts(persona_id);
