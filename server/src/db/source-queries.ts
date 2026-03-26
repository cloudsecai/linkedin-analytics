import type { DbClient } from "./client.js";

export interface ResearchSource {
  id: number;
  name: string;
  feed_url: string;
  source_type: string;
  enabled: number;
  created_at: string;
}

export function listSources(db: DbClient, personaId: number): ResearchSource[] {
  return db.all<ResearchSource>(
    "SELECT id, name, feed_url, source_type, enabled, created_at FROM research_sources WHERE persona_id = ? ORDER BY name",
    personaId
  );
}

export function sourceExists(db: DbClient, feedUrl: string, personaId: number): boolean {
  return !!db.get(
    "SELECT id FROM research_sources WHERE feed_url = ? AND persona_id = ?",
    feedUrl, personaId
  );
}

export function insertSource(db: DbClient, name: string, feedUrl: string, personaId: number): number {
  const result = db.run(
    "INSERT INTO research_sources (name, feed_url, persona_id) VALUES (?, ?, ?)",
    name, feedUrl, personaId
  );
  return result.lastInsertRowid;
}

export function getSource(db: DbClient, id: number, personaId: number): ResearchSource | undefined {
  return db.get<ResearchSource>(
    "SELECT id, name, feed_url, source_type, enabled, created_at FROM research_sources WHERE id = ? AND persona_id = ?",
    id, personaId
  );
}

export function updateSource(db: DbClient, id: number, personaId: number, updates: { enabled?: boolean; name?: string }): void {
  if (typeof updates.enabled === "boolean") {
    db.run("UPDATE research_sources SET enabled = ? WHERE id = ? AND persona_id = ?",
      updates.enabled ? 1 : 0, id, personaId);
  }
  if (typeof updates.name === "string" && updates.name.trim()) {
    db.run("UPDATE research_sources SET name = ? WHERE id = ? AND persona_id = ?",
      updates.name.trim(), id, personaId);
  }
}

export function deleteSource(db: DbClient, id: number, personaId: number): boolean {
  const result = db.run("DELETE FROM research_sources WHERE id = ? AND persona_id = ?", id, personaId);
  return result.changes > 0;
}

export function getTaxonomyNames(db: DbClient): string[] {
  return db.all<{ name: string }>("SELECT name FROM ai_taxonomy ORDER BY name").map(r => r.name);
}
