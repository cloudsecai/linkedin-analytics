import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────

export interface AiTag {
  post_id: string;
  hook_type: string | null;
  tone: string | null;
  format_style: string | null;
  post_category: string | null;
  tagged_at: string;
  model: string | null;
}

export interface ImageTagInput {
  post_id: string;
  image_index: number;
  format: string;
  people: string;
  setting: string;
  text_density: string;
  energy: string;
  model: string;
}

export interface ImageTag {
  post_id: string;
  image_index: number;
  format: string;
  people: string;
  setting: string;
  text_density: string;
  energy: string;
  tagged_at: string;
  model: string;
}

// ── ai_tags ────────────────────────────────────────────────

export function upsertAiTag(
  db: Database.Database,
  tag: {
    post_id: string;
    hook_type: string;
    tone: string;
    format_style: string;
    post_category: string;
    model: string;
  }
): void {
  db.prepare(
    `INSERT INTO ai_tags (post_id, hook_type, tone, format_style, post_category, model)
     VALUES (@post_id, @hook_type, @tone, @format_style, @post_category, @model)
     ON CONFLICT(post_id) DO UPDATE SET
       hook_type = @hook_type,
       tone = @tone,
       format_style = @format_style,
       post_category = @post_category,
       model = @model,
       tagged_at = CURRENT_TIMESTAMP`
  ).run(tag);
}

export function getAiTags(
  db: Database.Database,
  postIds: string[]
): Record<string, AiTag> {
  if (postIds.length === 0) return {};
  const placeholders = postIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT post_id, hook_type, tone, format_style, post_category, tagged_at, model
       FROM ai_tags WHERE post_id IN (${placeholders})`
    )
    .all(...postIds) as AiTag[];
  const result: Record<string, AiTag> = {};
  for (const row of rows) {
    result[row.post_id] = row;
  }
  return result;
}

export function getUntaggedPostIds(db: Database.Database, personaId: number): string[] {
  const rows = db
    .prepare(
      `SELECT p.id FROM posts p
       LEFT JOIN ai_tags t ON t.post_id = p.id
       WHERE t.post_id IS NULL
         AND p.persona_id = ?
       ORDER BY p.id`
    )
    .all(personaId) as { id: string }[];
  return rows.map((r) => r.id);
}

// ── ai_image_tags ─────────────────────────────────────────

export function upsertImageTag(db: Database.Database, input: ImageTagInput): void {
  db.prepare(
    `INSERT INTO ai_image_tags (post_id, image_index, format, people, setting, text_density, energy, model)
     VALUES (@post_id, @image_index, @format, @people, @setting, @text_density, @energy, @model)
     ON CONFLICT(post_id, image_index) DO UPDATE SET
       format = @format, people = @people, setting = @setting,
       text_density = @text_density, energy = @energy,
       model = @model, tagged_at = CURRENT_TIMESTAMP`
  ).run(input);
}

export function getImageTags(
  db: Database.Database,
  postIds: string[]
): Record<string, ImageTag[]> {
  if (postIds.length === 0) return {};
  const placeholders = postIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM ai_image_tags WHERE post_id IN (${placeholders}) ORDER BY post_id, image_index`
    )
    .all(...postIds) as ImageTag[];
  const result: Record<string, ImageTag[]> = {};
  for (const row of rows) {
    if (!result[row.post_id]) result[row.post_id] = [];
    result[row.post_id].push(row);
  }
  return result;
}

export function getUnclassifiedImagePosts(
  db: Database.Database,
  personaId: number
): { id: string; image_local_paths: string; hook_text: string | null }[] {
  return db
    .prepare(
      `SELECT p.id, p.image_local_paths, p.hook_text
       FROM posts p
       WHERE p.image_local_paths IS NOT NULL
         AND p.persona_id = ?
         AND NOT EXISTS (SELECT 1 FROM ai_image_tags t WHERE t.post_id = p.id)
       ORDER BY p.published_at DESC`
    )
    .all(personaId) as { id: string; image_local_paths: string; hook_text: string | null }[];
}

// ── ai_taxonomy ────────────────────────────────────────────

export function upsertTaxonomy(
  db: Database.Database,
  items: { name: string; description: string }[]
): void {
  const stmt = db.prepare(
    `INSERT INTO ai_taxonomy (name, description)
     VALUES (@name, @description)
     ON CONFLICT(name) DO UPDATE SET description = @description`
  );
  const tx = db.transaction((rows: { name: string; description: string }[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  tx(items);
}

export function getTaxonomy(
  db: Database.Database
): { id: number; name: string; description: string }[] {
  return db
    .prepare("SELECT id, name, description FROM ai_taxonomy ORDER BY name")
    .all() as { id: number; name: string; description: string }[];
}

// ── ai_post_topics ─────────────────────────────────────────

export function setPostTopics(
  db: Database.Database,
  postId: string,
  taxonomyIds: number[]
): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM ai_post_topics WHERE post_id = ?").run(postId);
    const insert = db.prepare(
      "INSERT INTO ai_post_topics (post_id, taxonomy_id) VALUES (?, ?)"
    );
    for (const tid of taxonomyIds) {
      insert.run(postId, tid);
    }
  });
  tx();
}

export function getPostTopics(
  db: Database.Database,
  postId: string
): string[] {
  const rows = db
    .prepare(
      `SELECT t.name FROM ai_post_topics pt
       JOIN ai_taxonomy t ON t.id = pt.taxonomy_id
       WHERE pt.post_id = ?
       ORDER BY t.name`
    )
    .all(postId) as { name: string }[];
  return rows.map((r) => r.name);
}

// ── clear tags ─────────────────────────────────────────────

export function clearTagsForPersona(db: Database.Database, personaId: number): void {
  db.prepare("DELETE FROM ai_post_topics WHERE post_id IN (SELECT id FROM posts WHERE persona_id = ?)").run(personaId);
  db.prepare("DELETE FROM ai_tags WHERE post_id IN (SELECT id FROM posts WHERE persona_id = ?)").run(personaId);
}
