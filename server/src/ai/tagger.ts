import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import type { AiLogger } from "./logger.js";
import { MODELS } from "./client.js";
import { taggingPrompt } from "./prompts.js";
import {
  getTaxonomy,
  upsertAiTag,
  setPostTopics,
} from "../db/ai-queries.js";

// ── Types ──────────────────────────────────────────────────

export interface TagResult {
  post_id: string;
  topics: string[];
  hook_type: string;
  tone: string;
  format_style: string;
}

// ── Pure functions ─────────────────────────────────────────

/**
 * Parse the LLM tagging response. Strips markdown code fences if present,
 * then parses JSON into an array of TagResult.
 */
export function parseTaggingResponse(text: string): TagResult[] {
  let cleaned = text.trim();
  // Strip ```json ... ``` wrappers
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned) as TagResult[];
}

/**
 * Split an array into batches of a given size.
 */
export function batchPosts<T>(posts: T[], batchSize: number): T[][] {
  if (posts.length === 0) return [];
  const batches: T[][] = [];
  for (let i = 0; i < posts.length; i += batchSize) {
    batches.push(posts.slice(i, i + batchSize));
  }
  return batches;
}

// ── Async LLM function ────────────────────────────────────

export async function tagPosts(
  client: Anthropic,
  db: Database.Database,
  posts: { id: string; content_preview: string | null }[],
  logger: AiLogger
): Promise<void> {
  const taxonomy = getTaxonomy(db);
  if (taxonomy.length === 0) {
    throw new Error("No taxonomy found. Run taxonomy discovery first.");
  }

  const taxonomyMap = new Map(taxonomy.map((t) => [t.name, t.id]));
  const systemPrompt = taggingPrompt(taxonomy);
  const batches = batchPosts(posts, 20);

  for (const batch of batches) {
    const userContent = batch
      .map(
        (p) =>
          `Post ID: ${p.id}\nContent: ${p.content_preview ?? "(no content)"}`
      )
      .join("\n\n---\n\n");

    const start = Date.now();
    const response = await client.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    const duration = Date.now() - start;

    const outputText =
      response.content[0].type === "text" ? response.content[0].text : "";

    logger.log({
      step: "tagging",
      model: MODELS.HAIKU,
      input_messages: JSON.stringify([{ role: "user", content: userContent }]),
      output_text: outputText,
      tool_calls: null,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      thinking_tokens: 0,
      duration_ms: duration,
    });

    const tags = parseTaggingResponse(outputText);

    for (const tag of tags) {
      upsertAiTag(db, {
        post_id: tag.post_id,
        hook_type: tag.hook_type,
        tone: tag.tone,
        format_style: tag.format_style,
        model: MODELS.HAIKU,
      });

      const topicIds = tag.topics
        .map((name) => taxonomyMap.get(name))
        .filter((id): id is number => id !== undefined);

      if (topicIds.length > 0) {
        setPostTopics(db, tag.post_id, topicIds);
      }
    }
  }
}
