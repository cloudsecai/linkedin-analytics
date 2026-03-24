import type Database from "better-sqlite3";

export interface Persona {
  id: number;
  name: string;
  linkedin_url: string;
  type: "personal" | "company_page";
  created_at: string;
}

export function listPersonas(db: Database.Database): Persona[] {
  return db.prepare("SELECT * FROM personas ORDER BY id").all() as Persona[];
}

export function getPersona(db: Database.Database, id: number): Persona | undefined {
  return db.prepare("SELECT * FROM personas WHERE id = ?").get(id) as Persona | undefined;
}

export function createPersona(
  db: Database.Database,
  data: { name: string; linkedin_url: string; type: "personal" | "company_page" }
): Persona {
  const result = db.prepare(
    "INSERT INTO personas (name, linkedin_url, type) VALUES (?, ?, ?)"
  ).run(data.name, data.linkedin_url, data.type);
  const personaId = result.lastInsertRowid as number;

  // Seed new persona with an empty author_profile row so profile queries don't fail
  db.prepare(
    "INSERT OR IGNORE INTO author_profile (persona_id) VALUES (?)"
  ).run(personaId);

  // Copy default RSS sources from persona 1 so the research pipeline works immediately
  // Actual columns: name, feed_url, source_type, enabled (from 011-research-sources.sql)
  db.prepare(`
    INSERT INTO research_sources (name, feed_url, source_type, enabled, persona_id)
    SELECT name, feed_url, source_type, enabled, ?
    FROM research_sources WHERE persona_id = 1
  `).run(personaId);

  // Copy generation rules from persona 1
  // Actual columns: category, rule_text, example_text, sort_order, enabled (from 009-generation.sql)
  db.prepare(`
    INSERT INTO generation_rules (category, rule_text, example_text, sort_order, enabled, persona_id)
    SELECT category, rule_text, example_text, sort_order, enabled, ?
    FROM generation_rules WHERE persona_id = 1
  `).run(personaId);

  return getPersona(db, personaId)!;
}

export function updatePersona(
  db: Database.Database,
  id: number,
  data: { name?: string; linkedin_url?: string }
): void {
  if (data.name != null) {
    db.prepare("UPDATE personas SET name = ? WHERE id = ?").run(data.name, id);
  }
  if (data.linkedin_url != null) {
    db.prepare("UPDATE personas SET linkedin_url = ? WHERE id = ?").run(data.linkedin_url, id);
  }
}
