import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { analyzeRetro } from "./retro.js";
import {
  getUnmatchedGenerations,
  updateGeneration,
  getRules,
} from "../db/generate-queries.js";

function firstNLines(text: string, n: number): string {
  return text.split("\n").slice(0, n).join("\n");
}

/**
 * Ask Haiku whether a published post matches any of the candidate drafts.
 * Returns the generation ID of the best match, or null.
 */
async function findMatch(
  client: Anthropic,
  postExcerpt: string,
  candidates: Array<{ id: number; excerpt: string }>
): Promise<number | null> {
  if (candidates.length === 0) return null;

  const candidateList = candidates
    .map((c) => `DRAFT (id=${c.id}):\n${c.excerpt}`)
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 100,
    system:
      "You match published LinkedIn posts to their original AI-generated drafts. The published version may be heavily edited but will share the same core topic and key ideas. Return ONLY a JSON object.",
    messages: [
      {
        role: "user",
        content: `PUBLISHED POST (excerpt):\n${postExcerpt}\n\n---\n\nCANDIDATE DRAFTS:\n${candidateList}\n\nWhich draft, if any, is this post based on? The post may have been significantly rewritten but will share the same core topic/argument.\n\nReturn JSON only: { "match_id": <draft id or null>, "confidence": "high"|"medium"|"none" }\nReturn null if none are a clear match.`,
      },
    ],
  }, { timeout: 30_000, maxRetries: 2 });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  try {
    const cleaned = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.match_id && parsed.confidence !== "none") {
      return parsed.match_id;
    }
  } catch {
    // Parse failure — no match
  }
  return null;
}

/**
 * Main auto-retro pipeline. Called fire-and-forget from ingest.
 * For each new post with full_text, check if it matches an unmatched generation.
 * If so, run the full retro analysis and store results.
 */
export async function runAutoRetro(
  client: Anthropic,
  db: Database.Database,
  personaId: number,
  postIds: string[]
): Promise<void> {
  const generations = getUnmatchedGenerations(db, personaId, 90);
  if (generations.length === 0) return;

  const rules = getRules(db, personaId)
    .filter((r) => r.enabled)
    .map((r) => r.rule_text);
  const writingPrompt = (
    db
      .prepare("SELECT value FROM settings WHERE key = 'writing_prompt'")
      .get() as { value: string } | undefined
  )?.value;

  for (const postId of postIds) {
    const post = db
      .prepare(
        "SELECT id, full_text, published_at FROM posts WHERE id = ? AND full_text IS NOT NULL"
      )
      .get(postId) as
      | { id: string; full_text: string; published_at: string }
      | undefined;
    if (!post) continue;

    // Check if this post is already matched to a generation
    const alreadyMatched = db
      .prepare("SELECT id FROM generations WHERE matched_post_id = ?")
      .get(post.id);
    if (alreadyMatched) continue;

    const postExcerpt = firstNLines(post.full_text, 10);
    const candidates = generations.map((g) => ({
      id: g.id,
      excerpt: firstNLines(g.final_draft, 10),
    }));

    const matchId = await findMatch(client, postExcerpt, candidates);
    if (!matchId) continue;

    // Verify the generation exists in our candidates
    const gen = generations.find((g) => g.id === matchId);
    if (!gen) continue;

    // Store the match
    updateGeneration(db, matchId, {
      matched_post_id: post.id,
      status: "published",
    });
    db.prepare(
      "UPDATE generations SET published_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(post.full_text, matchId);

    // Run full retro analysis
    try {
      const { analysis } = await analyzeRetro(
        client,
        gen.final_draft,
        post.full_text,
        rules,
        writingPrompt,
        { timeout: 120_000, maxRetries: 2 }
      );
      db.prepare(
        "UPDATE generations SET retro_json = ?, retro_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(JSON.stringify(analysis), matchId);
      console.log(
        `[Auto-Retro] Matched post ${post.id} → generation ${matchId}, retro complete`
      );
    } catch (err: any) {
      console.error(
        `[Auto-Retro] Retro analysis failed for generation ${matchId}:`,
        err.message
      );
    }
  }
}
