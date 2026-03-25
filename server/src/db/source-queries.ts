import type Database from "better-sqlite3";

export interface ResearchSource {
  id: number;
  name: string;
  feed_url: string;
  source_type: string;
  enabled: number;
  created_at: string;
}

export function listSources(db: Database.Database, personaId: number): ResearchSource[] {
  return db.prepare(
    "SELECT id, name, feed_url, source_type, enabled, created_at FROM research_sources WHERE persona_id = ? ORDER BY name"
  ).all(personaId) as ResearchSource[];
}

export function sourceExists(db: Database.Database, feedUrl: string, personaId: number): boolean {
  return !!db.prepare(
    "SELECT id FROM research_sources WHERE feed_url = ? AND persona_id = ?"
  ).get(feedUrl, personaId);
}

export function insertSource(db: Database.Database, name: string, feedUrl: string, personaId: number): number {
  const result = db.prepare(
    "INSERT INTO research_sources (name, feed_url, persona_id) VALUES (?, ?, ?)"
  ).run(name, feedUrl, personaId);
  return Number(result.lastInsertRowid);
}

export function getSource(db: Database.Database, id: number, personaId: number): ResearchSource | undefined {
  return db.prepare(
    "SELECT id, name, feed_url, source_type, enabled, created_at FROM research_sources WHERE id = ? AND persona_id = ?"
  ).get(id, personaId) as ResearchSource | undefined;
}

export function updateSource(db: Database.Database, id: number, personaId: number, updates: { enabled?: boolean; name?: string }): void {
  if (typeof updates.enabled === "boolean") {
    db.prepare("UPDATE research_sources SET enabled = ? WHERE id = ? AND persona_id = ?")
      .run(updates.enabled ? 1 : 0, id, personaId);
  }
  if (typeof updates.name === "string" && updates.name.trim()) {
    db.prepare("UPDATE research_sources SET name = ? WHERE id = ? AND persona_id = ?")
      .run(updates.name.trim(), id, personaId);
  }
}

export function deleteSource(db: Database.Database, id: number, personaId: number): boolean {
  const result = db.prepare("DELETE FROM research_sources WHERE id = ? AND persona_id = ?").run(id, personaId);
  return result.changes > 0;
}

export function getTaxonomyNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM ai_taxonomy ORDER BY name").all() as { name: string }[]).map(r => r.name);
}
