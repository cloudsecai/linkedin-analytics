import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import { fetchAllFeeds, type RssItem } from "./rss-fetcher.js";
import { searchWithSonarPro, type SonarResult } from "./perplexity.js";
import { getRecentStoryHeadlines, type Story } from "../db/generate-queries.js";

export interface ResearchResult {
  stories: Story[];
  article_count: number;
  source_count: number;
  sources_metadata: Array<{ name: string; url?: string }>;
}

export interface RankedTopic {
  topic: string;
  source_headline: string;
  source_url: string;
}

// ── Pure functions ─────────────────────────────────────────

export function buildRankingPrompt(
  items: RssItem[],
  postType: string,
  recentHeadlines: string[]
): string {
  const TYPE_GUIDANCE: Record<string, string> = {
    news: "prioritize breaking developments, reactions from practitioners, and timely controversies",
    topic: "prioritize evergreen debates, skill gaps, and framework discussions practitioners care about",
    insight: "prioritize practitioner lessons, failure post-mortems, and surprising outcomes from real projects",
  };
  const guidance = TYPE_GUIDANCE[postType] ?? TYPE_GUIDANCE.topic;

  const itemList = items
    .map((item, i) => `${i + 1}. [${item.sourceName ?? "Unknown"}] ${item.title} — ${item.link}`)
    .join("\n");

  const avoidSection =
    recentHeadlines.length > 0
      ? `\n\nAvoid topics that overlap with these recently-covered headlines:\n${recentHeadlines.slice(0, 20).map((h) => `- ${h}`).join("\n")}`
      : "";

  return `You are ranking RSS feed items for a LinkedIn content researcher.

Post type: ${postType}
Guidance: ${guidance}

RSS items:
${itemList}${avoidSection}

Select the top 5 most compelling items for a LinkedIn practitioner audience. For each, write a crisp research topic string (not the headline verbatim — reframe it as a research question or angle).

Return a JSON array (no markdown fences, no extra text):
[
  {
    "topic": "string — research angle or question",
    "source_headline": "string — original headline from the list",
    "source_url": "string — URL from the list"
  }
]`;
}

export function parseRankedTopics(text: string): RankedTopic[] {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];
  try {
    return JSON.parse(arrayMatch[0]) as RankedTopic[];
  } catch {
    return [];
  }
}

export function buildSynthesisPrompt(
  topic: string,
  sonarContent: string,
  citations: string[],
  postType: string
): string {
  const TYPE_GUIDANCE: Record<string, string> = {
    news: "Frame each angle as a timely news story a practitioner would react to. Lead with what happened and why it matters for their work.",
    topic: "Frame each angle as a specific professional debate or skill the practitioner can engage with directly.",
    insight: "Frame each angle as a hard-won lesson or surprising outcome from real practitioner experience.",
  };
  const guidance = TYPE_GUIDANCE[postType] ?? TYPE_GUIDANCE.topic;

  const citationList =
    citations.length > 0
      ? `\n\nSources (cite 1-2 per story):\n${citations.map((c, i) => `[${i + 1}] ${c}`).join("\n")}`
      : "";

  return `You are synthesizing web research into LinkedIn story cards.

Topic: ${topic}
Post type: ${postType}
Framing guidance: ${guidance}

Research content:
${sonarContent}${citationList}

Create exactly 3 story card angles on this topic. Each angle should be distinct — different perspective, different audience, different hook. Think: contrarian take, operator perspective, future implication.

Return JSON (no markdown fences):
{
  "stories": [
    {
      "headline": "string — newsreader-style headline, max 12 words",
      "summary": "string — 2-3 sentences, practitioner-focused",
      "source": "string — publication or source name",
      "source_url": "string — URL if available, else empty string",
      "age": "string — e.g. 'This week', 'Emerging', 'Ongoing'",
      "tag": "string — topic category tag",
      "angles": ["string — angle 1", "string — angle 2"],
      "is_stretch": false
    }
  ]
}`;
}

export function parseSynthesizedStories(text: string): Story[] {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  // Try {stories: [...]} wrapper first
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as { stories?: Story[] } | Story;
      if ("stories" in parsed && Array.isArray((parsed as { stories: Story[] }).stories)) {
        return (parsed as { stories: Story[] }).stories;
      }
      // Single story object (no wrapper)
      if ("headline" in parsed) {
        return [parsed as Story];
      }
    } catch {
      // fall through to array attempt
    }
  }

  // Try bare array
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]) as Story[];
    } catch {
      return [];
    }
  }

  return [];
}

// ── Orchestration ──────────────────────────────────────────

export async function researchStories(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger,
  postType: string,
  options?: { topic?: string; avoid?: string[] }
): Promise<ResearchResult> {
  const recentHeadlines = getRecentStoryHeadlines(db, 30);
  const avoidList = [...recentHeadlines, ...(options?.avoid ?? [])];

  // ── Manual path: topic provided ───────────────────────────
  if (options?.topic) {
    const sonarResult = await searchWithSonarPro(options.topic, postType, logger);
    const stories = await synthesizeTopic(
      client,
      logger,
      options.topic,
      sonarResult,
      postType,
      avoidList
    );
    const finalStories = markStretch(stories.slice(0, 3));
    return {
      stories: finalStories,
      article_count: sonarResult.citations.length,
      source_count: sonarResult.citations.length,
      sources_metadata: sonarResult.citations.map((url) => ({ name: new URL(url).hostname, url })),
    };
  }

  // ── Auto path: RSS → rank → Sonar Pro → synthesize ───────
  const rssItems = await fetchAllFeeds(db);

  // Rank with Haiku
  const rankingPrompt = buildRankingPrompt(rssItems, postType, avoidList);
  const rankStart = Date.now();
  const rankResponse = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 1000,
    system: "You are a content researcher. Return only valid JSON.",
    messages: [{ role: "user", content: rankingPrompt }],
  });
  const rankDuration = Date.now() - rankStart;
  const rankText =
    rankResponse.content[0].type === "text" ? rankResponse.content[0].text : "";
  logger.log({
    step: "rss_ranking",
    model: MODELS.HAIKU,
    input_messages: JSON.stringify([{ role: "user", content: rankingPrompt }]),
    output_text: rankText,
    tool_calls: null,
    input_tokens: rankResponse.usage.input_tokens,
    output_tokens: rankResponse.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: rankDuration,
  });

  const rankedTopics = parseRankedTopics(rankText).slice(0, 3);
  if (rankedTopics.length === 0) {
    throw new Error("Ranking returned no topics");
  }

  // Sonar Pro deep dives in parallel
  const sonarResults = await Promise.all(
    rankedTopics.map(async (ranked) => {
      try {
        const result = await searchWithSonarPro(ranked.topic, postType, logger);
        return { ranked, result };
      } catch (err: any) {
        console.warn(`[researcher] Sonar Pro failed for "${ranked.topic}": ${err.message}`);
        return null;
      }
    })
  );

  const successful = sonarResults.filter(
    (r): r is { ranked: RankedTopic; result: SonarResult } => r !== null
  );

  // If ALL Sonar calls failed, fall back to degraded RSS-based cards
  if (successful.length === 0) {
    console.warn("[researcher] All Sonar Pro calls failed — using degraded RSS fallback");
    const fallbackStories: Story[] = rankedTopics.map((t, i) => ({
      headline: t.source_headline,
      summary: `Research into "${t.topic}" was unavailable. This story is based on the RSS headline.`,
      source: t.source_url ? new URL(t.source_url).hostname : "RSS",
      source_url: t.source_url,
      age: "This week",
      tag: t.topic,
      angles: [t.topic],
      is_stretch: i === rankedTopics.length - 1,
    }));
    const uniqueSources = [...new Set(rankedTopics.map((t) => t.source_url).filter(Boolean))];
    return {
      stories: fallbackStories,
      article_count: rssItems.length,
      source_count: uniqueSources.length,
      sources_metadata: uniqueSources.map((url) => ({ name: new URL(url!).hostname, url: url! })),
    };
  }

  // Synthesize each topic into a single story card (Haiku, one per topic)
  const synthesizedCards = await Promise.all(
    successful.map(async ({ ranked, result }) => {
      const stories = await synthesizeTopic(
        client,
        logger,
        ranked.topic,
        result,
        postType,
        avoidList
      );
      // Return just the first card per topic (each topic → 1 card in auto mode)
      return stories[0] ?? null;
    })
  );

  const validCards = synthesizedCards.filter((s): s is Story => s !== null);
  const finalStories = markStretch(validCards.slice(0, 3));

  // Collect source metadata from all Sonar results
  const allCitations = successful.flatMap((s) => s.result.citations);
  const uniqueUrls = [...new Set(allCitations)];
  const sourcesMeta = uniqueUrls.map((url) => {
    try {
      return { name: new URL(url).hostname, url };
    } catch {
      return { name: url, url };
    }
  });

  return {
    stories: finalStories,
    article_count: rssItems.length,
    source_count: uniqueUrls.length,
    sources_metadata: sourcesMeta,
  };
}

// ── Internal helpers ───────────────────────────────────────

async function synthesizeTopic(
  client: Anthropic,
  logger: AiLogger,
  topic: string,
  sonarResult: SonarResult,
  postType: string,
  _avoidList: string[]
): Promise<Story[]> {
  const synthPrompt = buildSynthesisPrompt(
    topic,
    sonarResult.content,
    sonarResult.citations,
    postType
  );
  const synthStart = Date.now();
  const synthResponse = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 2000,
    system: "You are a content researcher. Return only valid JSON.",
    messages: [{ role: "user", content: synthPrompt }],
  });
  const synthDuration = Date.now() - synthStart;
  const synthText =
    synthResponse.content[0].type === "text" ? synthResponse.content[0].text : "";
  logger.log({
    step: "synthesis",
    model: MODELS.HAIKU,
    input_messages: JSON.stringify([{ role: "user", content: synthPrompt }]),
    output_text: synthText,
    tool_calls: null,
    input_tokens: synthResponse.usage.input_tokens,
    output_tokens: synthResponse.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: synthDuration,
  });
  return parseSynthesizedStories(synthText);
}

function markStretch(stories: Story[]): Story[] {
  if (stories.length === 0) return stories;
  return stories.map((s, i) => ({ ...s, is_stretch: i === stories.length - 1 }));
}
