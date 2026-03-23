import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import { fetchAllFeeds, type RssItem } from "./rss-fetcher.js";

export interface DiscoveryTopic {
  label: string;
  source_headline: string;
  source_url: string;
}

export interface DiscoveryCategory {
  name: string;
  topics: DiscoveryTopic[];
}

export interface DiscoveryResult {
  categories: DiscoveryCategory[];
}

export function buildClusteringPrompt(items: RssItem[], authorContext?: string, previousLabels?: string[]): string {
  const itemList = items
    .map((item, i) => `${i + 1}. ${item.title} — ${item.summary?.substring(0, 200) || ""} [${item.link}]`)
    .join("\n");

  const contextBlock = authorContext
    ? `\nAUTHOR CONTEXT — only surface topics relevant to this creator's expertise:\n${authorContext}\n`
    : "";

  const avoidBlock = previousLabels && previousLabels.length > 0
    ? `\nAVOID THESE TOPICS — they were already suggested. Find DIFFERENT angles and topics:\n${previousLabels.map(l => `- ${l}`).join("\n")}\n`
    : "";

  return `You are organizing RSS feed items into topic clusters for a LinkedIn content creator.
${contextBlock}${avoidBlock}
RSS items from the past week:
${itemList}

Filter to only items relevant to the author's expertise and interests described above. Discard general news, politics, and anything outside their domain.

Organize the relevant items into 3-5 thematic categories. For each category:
- Give it a short, descriptive name (e.g., "AI & Automation", "Cloud Security", "Developer Tools")
- List 4-6 topics, each a 3-5 word label that captures an interesting angle or debate
- Each topic should reference a source headline and URL from the list

Return JSON only (no markdown fences):
{
  "categories": [
    {
      "name": "Category Name",
      "topics": [
        { "label": "3-5 word topic label", "source_headline": "original headline", "source_url": "https://..." }
      ]
    }
  ]
}

Aim for ~20 topics total across all categories. Make labels provocative and specific — not generic summaries.`;
}

export function parseClusteringResponse(text: string): DiscoveryResult {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { categories: [] };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.categories)) {
      return { categories: [] };
    }
    return { categories: parsed.categories };
  } catch {
    return { categories: [] };
  }
}

export async function discoverTopics(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger,
  previousLabels?: string[]
): Promise<DiscoveryResult> {
  const rssItems = await fetchAllFeeds(db);

  // Build author context from taxonomy (what they've written about) + writing prompt
  const topics = db
    .prepare("SELECT name FROM ai_taxonomy ORDER BY name")
    .all() as { name: string }[];
  const writingPrompt = db
    .prepare("SELECT value FROM settings WHERE key = 'writing_prompt'")
    .get() as { value: string } | undefined;

  const contextParts: string[] = [];
  if (topics.length > 0) {
    contextParts.push(`This creator writes about: ${topics.map((t) => t.name).join(", ")}`);
  }
  if (writingPrompt?.value) {
    contextParts.push(writingPrompt.value);
  }
  const authorContext = contextParts.length > 0 ? contextParts.join("\n\n") : undefined;

  const prompt = buildClusteringPrompt(rssItems, authorContext, previousLabels);

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 2000,
    system: "You are a content researcher. Return only valid JSON.",
    messages: [{ role: "user", content: prompt }],
  });

  const duration = Date.now() - start;
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.log({
    step: "topic_discovery",
    model: MODELS.HAIKU,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  const result = parseClusteringResponse(text);
  if (result.categories.length === 0) {
    throw new Error("Topic clustering returned no categories");
  }
  return result;
}
