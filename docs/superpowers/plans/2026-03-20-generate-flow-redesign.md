# Generate Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the LLM-fabricated research pipeline with real web research (RSS feeds + Perplexity Sonar Pro), add manual topic input, and fix tab caching.

**Architecture:** Two-stage research pipeline: (1) RSS discovery across 5 curated feeds → Claude Haiku ranks top stories, (2) Perplexity Sonar Pro deep-dives top 3 stories in parallel → Claude Haiku synthesizes into story cards. Manual topic input skips stage 1 and goes straight to Sonar Pro. Frontend caches results per post type so tab switching is instant.

**Tech Stack:** TypeScript, Fastify, SQLite (better-sqlite3), Anthropic SDK (via OpenRouter), Perplexity Sonar Pro API (raw fetch), RSS parsing (rss-parser npm package), Vitest, React

**Spec:** `docs/superpowers/specs/2026-03-20-generate-flow-redesign-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `server/src/db/migrations/011-research-sources.sql` | **Create** — research_sources table + seed data |
| `server/src/ai/rss-fetcher.ts` | **Create** — Fetch + parse RSS feeds from DB, filter to this week, 5s timeout per feed |
| `server/src/ai/perplexity.ts` | **Create** — Sonar Pro API wrapper: search prompt → rich summary + citations |
| `server/src/ai/researcher.ts` | **Rewrite** — Orchestrate: RSS → rank → Sonar Pro → synthesize |
| `server/src/db/generate-queries.ts` | **Modify** — Add `source_url` to Story interface, add `getRecentStoryHeadlines()` |
| `server/src/routes/generate.ts` | **Modify** — Accept optional `topic` and `avoid` params in research endpoint |
| `dashboard/src/api/client.ts` | **Modify** — Add `source_url` to GenStory, update `generateResearch` signature |
| `dashboard/src/pages/Generate.tsx` | **Modify** — Change GenerationState to per-type cache structure |
| `dashboard/src/pages/generate/StorySelection.tsx` | **Modify** — Add manual topic input, cache-aware tab switching, progressive loading |
| `dashboard/src/pages/generate/components/StoryCard.tsx` | **Modify** — Make source a clickable link when source_url present |
| `server/src/__tests__/rss-fetcher.test.ts` | **Create** — Tests for RSS fetching, filtering, timeout handling |
| `server/src/__tests__/perplexity.test.ts` | **Create** — Tests for Sonar Pro wrapper |
| `server/src/__tests__/researcher.test.ts` | **Create** — Tests for the orchestration pipeline |

---

## Chunk 1: Database + Data Layer

### Task 1: Migration — research_sources table

**Files:**
- Create: `server/src/db/migrations/011-research-sources.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Migration 011: Research sources for RSS-powered research
CREATE TABLE IF NOT EXISTS research_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'rss',
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO research_sources (name, feed_url) VALUES
  ('no.security', 'https://no.security/rss.xml'),
  ('tl;dr sec', 'https://rss.beehiiv.com/feeds/xgTKUmMmUm.xml'),
  ('Import AI', 'https://importai.substack.com/feed'),
  ('AI News', 'https://news.smol.ai/rss.xml'),
  ('Axios', 'https://api.axios.com/feed/');
```

- [ ] **Step 2: Verify migration loads**

Run: `cd server && npx tsx -e "import { buildApp } from './src/app.js'; const app = buildApp(); await app.ready(); const db = (app as any).db; const rows = db.prepare('SELECT * FROM research_sources').all(); console.log(rows); await app.close();"`

Expected: 5 rows printed with the seeded sources.

- [ ] **Step 3: Commit**

```bash
git add server/src/db/migrations/011-research-sources.sql
git -c commit.gpgsign=false commit -m "feat: add research_sources migration for RSS feeds"
```

---

### Task 2: Update Story interface + add getRecentStoryHeadlines

**Files:**
- Modify: `server/src/db/generate-queries.ts` (lines 32-40 for Story interface, add new function after line 437)
- Test: `server/src/__tests__/generate-queries.test.ts`

- [ ] **Step 1: Write failing test for getRecentStoryHeadlines**

Add to `server/src/__tests__/generate-queries.test.ts`:

```typescript
import { getRecentStoryHeadlines, insertResearch } from "../db/generate-queries.js";

describe("getRecentStoryHeadlines", () => {
  it("returns headlines from recent research sessions", () => {
    // Insert two research sessions with stories
    insertResearch(db, {
      post_type: "news",
      stories_json: JSON.stringify([
        { headline: "Story A", summary: "s", source: "src", age: "today", tag: "t", angles: [], is_stretch: false },
        { headline: "Story B", summary: "s", source: "src", age: "today", tag: "t", angles: [], is_stretch: false },
      ]),
      article_count: 2,
      source_count: 1,
    });
    insertResearch(db, {
      post_type: "topic",
      stories_json: JSON.stringify([
        { headline: "Story C", summary: "s", source: "src", age: "today", tag: "t", angles: [], is_stretch: false },
      ]),
      article_count: 1,
      source_count: 1,
    });

    const headlines = getRecentStoryHeadlines(db, 30);
    expect(headlines).toContain("Story A");
    expect(headlines).toContain("Story B");
    expect(headlines).toContain("Story C");
  });

  it("respects the limit parameter", () => {
    // With limit=1, only get headlines from the most recent research session
    const headlines = getRecentStoryHeadlines(db, 1);
    // Should only contain Story C (from the second/most recent insert)
    expect(headlines).toContain("Story C");
    expect(headlines).not.toContain("Story A");
  });
});
```

Note: This test file already exists and has a `db` variable set up in `beforeAll`. Add the import for `getRecentStoryHeadlines` at the top and add these tests at the bottom of the file. Check the existing test file first to understand the setup pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/generate-queries.test.ts`
Expected: FAIL — `getRecentStoryHeadlines` is not exported

- [ ] **Step 3: Add source_url to Story interface and implement getRecentStoryHeadlines**

In `server/src/db/generate-queries.ts`, update the `Story` interface (around line 32):

```typescript
export interface Story {
  headline: string;
  summary: string;
  source: string;
  source_url?: string;   // Real URL from Sonar Pro citations
  age: string;
  tag: string;
  angles: string[];
  is_stretch: boolean;
}
```

Add the new function after `getRecentTopics` (after line 438):

```typescript
export function getRecentStoryHeadlines(db: Database.Database, limit: number): string[] {
  const rows = db
    .prepare("SELECT stories_json FROM generation_research ORDER BY created_at DESC LIMIT ?")
    .all(limit) as { stories_json: string }[];
  const headlines: string[] = [];
  for (const row of rows) {
    const stories = JSON.parse(row.stories_json) as Story[];
    headlines.push(...stories.map((s) => s.headline));
  }
  return headlines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/generate-queries.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check nothing broke**

Run: `cd server && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add server/src/db/generate-queries.ts server/src/__tests__/generate-queries.test.ts
git -c commit.gpgsign=false commit -m "feat: add source_url to Story, add getRecentStoryHeadlines query"
```

---

## Chunk 2: RSS Fetcher

### Task 3: Install rss-parser dependency

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install rss-parser**

Run: `cd server && npm install rss-parser`

- [ ] **Step 2: Commit**

```bash
git add server/package.json server/package-lock.json
git -c commit.gpgsign=false commit -m "chore: add rss-parser dependency"
```

Note: `package-lock.json` is at the repo root. Check whether `npm install` inside `server/` updates the root lockfile or a server-local one. Adjust the git add accordingly.

---

### Task 4: RSS Fetcher module

**Files:**
- Create: `server/src/ai/rss-fetcher.ts`
- Create: `server/src/__tests__/rss-fetcher.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/src/__tests__/rss-fetcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseRssItems, filterToThisWeek, type RssItem } from "../ai/rss-fetcher.js";

describe("filterToThisWeek", () => {
  it("keeps items from the past 7 days", () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    const items: RssItem[] = [
      { title: "Recent", link: "https://example.com/1", summary: "s", pubDate: threeDaysAgo },
      { title: "Old", link: "https://example.com/2", summary: "s", pubDate: tenDaysAgo },
    ];

    const filtered = filterToThisWeek(items);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("Recent");
  });

  it("returns empty array when no items are recent", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const items: RssItem[] = [
      { title: "Old", link: "https://example.com/1", summary: "s", pubDate: tenDaysAgo },
    ];
    expect(filterToThisWeek(items)).toHaveLength(0);
  });
});

describe("parseRssItems", () => {
  it("extracts title, link, summary from RSS XML", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <item>
          <title>Test Article</title>
          <link>https://example.com/article</link>
          <description>This is a test article about security.</description>
          <pubDate>${new Date().toUTCString()}</pubDate>
        </item>
      </channel>
    </rss>`;

    const items = await parseRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Test Article");
    expect(items[0].link).toBe("https://example.com/article");
    expect(items[0].summary).toBe("This is a test article about security.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/rss-fetcher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement rss-fetcher.ts**

Create `server/src/ai/rss-fetcher.ts`:

```typescript
import type Database from "better-sqlite3";
import Parser from "rss-parser";

export interface RssItem {
  title: string;
  link: string;
  summary: string;
  pubDate: Date;
  sourceName?: string;
}

export interface RssSource {
  id: number;
  name: string;
  feed_url: string;
  source_type: string;
  enabled: number;
}

const FEED_TIMEOUT_MS = 5000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Parse raw RSS XML into RssItem[].
 */
export async function parseRssItems(xml: string): Promise<RssItem[]> {
  const parser = new Parser();
  const feed = await parser.parseString(xml);
  return (feed.items ?? []).map((item) => ({
    title: item.title ?? "",
    link: item.link ?? "",
    summary: (item.contentSnippet ?? item.content ?? item.summary ?? "").substring(0, 500),
    pubDate: item.pubDate ? new Date(item.pubDate) : new Date(0),
  }));
}

/**
 * Filter items to those published within the last 7 days.
 */
export function filterToThisWeek(items: RssItem[]): RssItem[] {
  const cutoff = Date.now() - ONE_WEEK_MS;
  return items.filter((item) => item.pubDate.getTime() > cutoff);
}

/**
 * Fetch a single RSS feed with timeout. Returns [] on failure.
 */
async function fetchFeed(url: string, sourceName: string): Promise<RssItem[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[rss-fetcher] ${sourceName}: HTTP ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const items = await parseRssItems(xml);
    return items.map((item) => ({ ...item, sourceName }));
  } catch (err: any) {
    console.warn(`[rss-fetcher] ${sourceName}: ${err.message}`);
    return [];
  }
}

/**
 * Get enabled RSS sources from the database.
 */
export function getEnabledSources(db: Database.Database): RssSource[] {
  return db
    .prepare("SELECT * FROM research_sources WHERE enabled = 1")
    .all() as RssSource[];
}

/**
 * Fetch all enabled RSS feeds in parallel, filter to this week.
 * Returns combined items from all feeds that responded.
 * Throws if ALL feeds fail.
 */
export async function fetchAllFeeds(db: Database.Database): Promise<RssItem[]> {
  const sources = getEnabledSources(db);
  if (sources.length === 0) {
    throw new Error("No RSS sources configured");
  }

  const results = await Promise.all(
    sources.map((source) => fetchFeed(source.feed_url, source.name))
  );

  const allItems = results.flat();
  if (allItems.length === 0) {
    throw new Error("All RSS feeds failed or returned no items");
  }

  const recentItems = filterToThisWeek(allItems);
  if (recentItems.length === 0) {
    throw new Error("No stories found from the past week");
  }

  return recentItems;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/rss-fetcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/rss-fetcher.ts server/src/__tests__/rss-fetcher.test.ts
git -c commit.gpgsign=false commit -m "feat: add RSS fetcher with timeout and filtering"
```

---

## Chunk 3: Perplexity Sonar Pro Integration

### Task 5: Perplexity API wrapper

**Files:**
- Create: `server/src/ai/perplexity.ts`
- Create: `server/src/__tests__/perplexity.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/src/__tests__/perplexity.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSearchPrompt, parseSonarResponse, type SonarResult } from "../ai/perplexity.js";

describe("buildSearchPrompt", () => {
  it("builds a news search prompt", () => {
    const prompt = buildSearchPrompt("AI agents replacing SREs", "news");
    expect(prompt).toContain("AI agents replacing SREs");
    expect(prompt).toContain("recent news coverage");
  });

  it("builds a topic search prompt", () => {
    const prompt = buildSearchPrompt("zero trust architecture", "topic");
    expect(prompt).toContain("zero trust architecture");
    expect(prompt).toContain("discussions");
  });

  it("builds an insight search prompt", () => {
    const prompt = buildSearchPrompt("migrating to microservices", "insight");
    expect(prompt).toContain("migrating to microservices");
    expect(prompt).toContain("practitioner");
  });
});

describe("parseSonarResponse", () => {
  it("extracts content and citations from Sonar Pro response", () => {
    const sonarJson = {
      choices: [{ message: { content: "Here is what I found about the topic." } }],
      citations: ["https://example.com/article1", "https://example.com/article2"],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    };

    const result = parseSonarResponse(sonarJson);
    expect(result.content).toBe("Here is what I found about the topic.");
    expect(result.citations).toEqual(["https://example.com/article1", "https://example.com/article2"]);
    expect(result.usage.input_tokens).toBe(100);
    expect(result.usage.output_tokens).toBe(200);
  });

  it("handles missing citations gracefully", () => {
    const sonarJson = {
      choices: [{ message: { content: "Content without citations." } }],
      usage: { prompt_tokens: 50, completion_tokens: 100 },
    };

    const result = parseSonarResponse(sonarJson);
    expect(result.content).toBe("Content without citations.");
    expect(result.citations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/perplexity.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement perplexity.ts**

Create `server/src/ai/perplexity.ts`:

```typescript
import { AiLogger } from "./logger.js";

export interface SonarResult {
  content: string;
  citations: string[];
  usage: { input_tokens: number; output_tokens: number };
}

const SEARCH_PROMPTS: Record<string, (topic: string) => string> = {
  news: (topic) =>
    `Find recent news coverage, reactions, and analysis about "${topic}" from the past week. Include multiple sources and perspectives. Focus on what happened, who reacted, and why it matters for practitioners.`,
  topic: (topic) =>
    `Find current discussions, debates, and different perspectives on "${topic}". What are practitioners saying? What's controversial? Include specific examples and named sources.`,
  insight: (topic) =>
    `Find practitioner experiences, case studies, and lessons learned about "${topic}". What worked, what failed, what surprised people? Focus on firsthand accounts and concrete outcomes.`,
};

/**
 * Build a search prompt for Sonar Pro based on topic and post type.
 */
export function buildSearchPrompt(topic: string, postType: string): string {
  const builder = SEARCH_PROMPTS[postType] ?? SEARCH_PROMPTS.topic;
  return builder(topic);
}

/**
 * Parse the raw JSON response from Sonar Pro API.
 */
export function parseSonarResponse(json: any): SonarResult {
  const content = json.choices?.[0]?.message?.content ?? "";
  const citations: string[] = json.citations ?? [];
  const usage = {
    input_tokens: json.usage?.prompt_tokens ?? 0,
    output_tokens: json.usage?.completion_tokens ?? 0,
  };
  return { content, citations, usage };
}

/**
 * Call Perplexity Sonar Pro API for a single topic.
 */
export async function searchWithSonarPro(
  topic: string,
  postType: string,
  logger: AiLogger
): Promise<SonarResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error("PERPLEXITY_API_KEY is required for web research");
  }

  const searchPrompt = buildSearchPrompt(topic, postType);
  const start = Date.now();

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [{ role: "user", content: searchPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Perplexity API error: ${response.status} ${errText}`);
  }

  const json = await response.json();
  const duration = Date.now() - start;
  const result = parseSonarResponse(json);

  logger.log({
    step: `sonar_pro_search`,
    model: "perplexity/sonar-pro",
    input_messages: JSON.stringify([{ role: "user", content: searchPrompt }]),
    output_text: result.content,
    tool_calls: null,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/perplexity.test.ts`
Expected: PASS (tests only cover pure functions, not the API call)

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/perplexity.ts server/src/__tests__/perplexity.test.ts
git -c commit.gpgsign=false commit -m "feat: add Perplexity Sonar Pro API wrapper"
```

---

## Chunk 4: Researcher Rewrite

### Task 6: Rewrite researcher.ts — the orchestration pipeline

**Files:**
- Rewrite: `server/src/ai/researcher.ts`
- Create: `server/src/__tests__/researcher.test.ts`

This is the core task — replacing the LLM-fabricated research with the real pipeline.

- [ ] **Step 1: Write failing tests for the new researcher**

Create `server/src/__tests__/researcher.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildRankingPrompt, parseRankedTopics, buildSynthesisPrompt, parseSynthesizedStories } from "../ai/researcher.js";

describe("buildRankingPrompt", () => {
  it("includes RSS items and post type guidance", () => {
    const items = [
      { title: "Article A", link: "https://a.com", summary: "Summary A", pubDate: new Date(), sourceName: "no.security" },
      { title: "Article B", link: "https://b.com", summary: "Summary B", pubDate: new Date(), sourceName: "Import AI" },
    ];
    const recentHeadlines = ["Old Story X"];
    const prompt = buildRankingPrompt(items, "news", recentHeadlines);

    expect(prompt).toContain("Article A");
    expect(prompt).toContain("Article B");
    expect(prompt).toContain("news");
    expect(prompt).toContain("Old Story X");
  });
});

describe("parseRankedTopics", () => {
  it("parses JSON array of ranked topics from LLM response", () => {
    const text = '```json\n[{"topic": "AI agents", "source_headline": "AI Agents Are Replacing SREs", "source_url": "https://a.com"}, {"topic": "Zero trust", "source_headline": "Zero Trust Is Dead", "source_url": "https://b.com"}]\n```';
    const topics = parseRankedTopics(text);
    expect(topics).toHaveLength(2);
    expect(topics[0].topic).toBe("AI agents");
    expect(topics[0].source_url).toBe("https://a.com");
  });
});

describe("buildSynthesisPrompt", () => {
  it("includes Sonar Pro content and citations", () => {
    const prompt = buildSynthesisPrompt(
      "AI agents in security",
      "Here is deep research content about AI agents...",
      ["https://example.com/1", "https://example.com/2"],
      "news"
    );
    expect(prompt).toContain("AI agents in security");
    expect(prompt).toContain("deep research content");
    expect(prompt).toContain("https://example.com/1");
  });
});

describe("parseSynthesizedStories", () => {
  it("parses story card JSON from LLM response", () => {
    const text = JSON.stringify({
      stories: [
        {
          headline: "Test Headline",
          summary: "Test summary",
          source: "Example Source",
          source_url: "https://example.com",
          age: "2 days ago",
          tag: "security",
          angles: ["angle 1", "angle 2"],
          is_stretch: false,
        },
      ],
    });
    const stories = parseSynthesizedStories(text);
    expect(stories).toHaveLength(1);
    expect(stories[0].headline).toBe("Test Headline");
    expect(stories[0].source_url).toBe("https://example.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/researcher.test.ts`
Expected: FAIL — functions not found

- [ ] **Step 3: Implement the new researcher.ts**

Rewrite `server/src/ai/researcher.ts`:

```typescript
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

/**
 * Build Claude Haiku prompt to rank RSS items by interest/relevance.
 */
export function buildRankingPrompt(
  items: RssItem[],
  postType: string,
  recentHeadlines: string[]
): string {
  const typeGuidance: Record<string, string> = {
    news: "Prioritize breaking/recent stories and hard news that practitioners would want to react to.",
    topic: "Prioritize trends, debates, and emerging themes that invite strong practitioner opinions.",
    insight: "Prioritize stories about lessons learned, failures, and practitioner-relevant experiences.",
  };

  const itemList = items
    .map((item, i) => `${i + 1}. [${item.sourceName ?? "Unknown"}] ${item.title}\n   ${item.summary}\n   URL: ${item.link}`)
    .join("\n\n");

  const avoidSection = recentHeadlines.length > 0
    ? `\n\nAvoid stories similar to these recently-used topics:\n${recentHeadlines.map((h) => `- ${h}`).join("\n")}`
    : "";

  return `You are a news editor selecting the most interesting stories for a tech/security practitioner to write LinkedIn posts about.

Post type: ${postType}
${typeGuidance[postType] ?? typeGuidance.topic}

Here are today's stories from various feeds:

${itemList}
${avoidSection}

Pick the 5 most interesting and postworthy topics. For each, extract:
- topic: a clear, concise description of the topic (not just the headline)
- source_headline: the original headline
- source_url: the original URL

Return JSON array:
[{"topic": "...", "source_headline": "...", "source_url": "..."}, ...]`;
}

/**
 * Parse the ranked topics from Claude's response.
 */
export function parseRankedTopics(text: string): RankedTopic[] {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Ranking response did not contain valid JSON array");
  return JSON.parse(match[0]);
}

/**
 * Build Claude Haiku prompt to synthesize Sonar Pro results into story cards.
 */
export function buildSynthesisPrompt(
  topic: string,
  sonarContent: string,
  citations: string[],
  postType: string
): string {
  const citationList = citations.length > 0
    ? `\n\nSources found:\n${citations.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
    : "";

  return `Convert this research into a story card for a LinkedIn post.

Topic: ${topic}
Post type: ${postType}

Research:
${sonarContent}
${citationList}

Return JSON:
{
  "headline": "string — newsreader-style headline",
  "summary": "string — 2-3 sentence summary of what happened and why it matters",
  "source": "string — primary source name (e.g. 'Krebs on Security')",
  "source_url": "string — primary source URL",
  "age": "string — e.g. 'This week', '2 days ago'",
  "tag": "string — topic category",
  "angles": ["string — possible angle 1", "string — possible angle 2"],
  "is_stretch": false
}`;
}

/**
 * Parse synthesized stories from Claude's response.
 * Handles both single-story JSON and multi-story {stories: [...]} format.
 */
export function parseSynthesizedStories(text: string): Story[] {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Synthesis response did not contain valid JSON");
  const parsed = JSON.parse(match[0]);
  // Handle both { stories: [...] } and single story object
  if (Array.isArray(parsed.stories)) return parsed.stories;
  return [parsed];
}

/**
 * Build synthesis prompt for manual topic — asks for 3 different angle cards.
 */
function buildManualTopicSynthesisPrompt(
  topic: string,
  sonarContent: string,
  citations: string[],
  postType: string
): string {
  const citationList = citations.length > 0
    ? `\n\nSources found:\n${citations.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
    : "";

  return `Convert this research into 3 story cards with different angles for a LinkedIn post.

Topic: ${topic}
Post type: ${postType}

Research:
${sonarContent}
${citationList}

Return JSON:
{
  "stories": [
    {
      "headline": "string — newsreader-style headline for this angle",
      "summary": "string — 2-3 sentence summary from this angle",
      "source": "string — primary source name",
      "source_url": "string — primary source URL",
      "age": "string — e.g. 'This week'",
      "tag": "string — topic category",
      "angles": ["string — possible angle 1", "string — possible angle 2"],
      "is_stretch": false
    }
  ]
}

Make each story card take a DIFFERENT angle on the topic — e.g., one contrarian, one practical, one forward-looking. Use different sources where possible.`;
}

/**
 * Research stories — the main orchestration function.
 *
 * Two paths:
 * 1. Manual topic (options.topic provided): Skip RSS, go straight to Sonar Pro
 * 2. Auto-generate: RSS → Claude ranks → Sonar Pro deep dives → Claude synthesizes
 */
export async function researchStories(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger,
  postType: string,
  options?: {
    topic?: string;
    avoid?: string[];
  }
): Promise<ResearchResult> {
  // ── Manual topic path ──────────────────────────────────────
  if (options?.topic) {
    const sonarResult = await searchWithSonarPro(options.topic, postType, logger);

    const start = Date.now();
    const response = await client.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 2000,
      system: "You synthesize research into LinkedIn post story cards. Always return valid JSON.",
      messages: [
        { role: "user", content: buildManualTopicSynthesisPrompt(options.topic, sonarResult.content, sonarResult.citations, postType) },
      ],
    });
    const duration = Date.now() - start;
    const text = response.content[0].type === "text" ? response.content[0].text : "";

    logger.log({
      step: "synthesis_manual",
      model: MODELS.HAIKU,
      input_messages: JSON.stringify([{ role: "user", content: `synthesis for: ${options.topic}` }]),
      output_text: text,
      tool_calls: null,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      thinking_tokens: 0,
      duration_ms: duration,
    });

    const stories = parseSynthesizedStories(text);
    return {
      stories: stories.slice(0, 3),
      article_count: sonarResult.citations.length,
      source_count: sonarResult.citations.length,
      sources_metadata: sonarResult.citations.map((url) => ({ name: new URL(url).hostname, url })),
    };
  }

  // ── Auto-generate path ─────────────────────────────────────

  // Stage 1: RSS Discovery
  const rssItems = await fetchAllFeeds(db);

  // Stage 1b: Claude Haiku ranks the items
  const recentHeadlines = [
    ...getRecentStoryHeadlines(db, 30),
    ...(options?.avoid ?? []),
  ];

  const rankStart = Date.now();
  const rankResponse = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 1500,
    system: "You are a news editor. Always return valid JSON.",
    messages: [
      { role: "user", content: buildRankingPrompt(rssItems, postType, recentHeadlines) },
    ],
  });
  const rankDuration = Date.now() - rankStart;
  const rankText = rankResponse.content[0].type === "text" ? rankResponse.content[0].text : "";

  logger.log({
    step: "rank_stories",
    model: MODELS.HAIKU,
    input_messages: JSON.stringify([{ role: "user", content: `ranking ${rssItems.length} RSS items` }]),
    output_text: rankText,
    tool_calls: null,
    input_tokens: rankResponse.usage.input_tokens,
    output_tokens: rankResponse.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: rankDuration,
  });

  const rankedTopics = parseRankedTopics(rankText).slice(0, 3);

  // Stage 2: Sonar Pro deep dives (top 3 in parallel)
  const sonarResults = await Promise.all(
    rankedTopics.map(async (topic): Promise<{ topic: RankedTopic; sonar: SonarResult } | null> => {
      try {
        const sonar = await searchWithSonarPro(topic.topic, postType, logger);
        return { topic, sonar };
      } catch (err: any) {
        console.warn(`[researcher] Sonar Pro failed for "${topic.topic}": ${err.message}`);
        return null;
      }
    })
  );

  const successfulResults = sonarResults.filter((r): r is NonNullable<typeof r> => r !== null);

  if (successfulResults.length === 0) {
    // Fallback: use RSS headlines directly as degraded story cards
    console.warn("[researcher] All Sonar Pro calls failed. Falling back to RSS headlines.");
    const fallbackStories: Story[] = rankedTopics.map((topic, i) => ({
      headline: topic.source_headline,
      summary: `From ${topic.source_url}`,
      source: new URL(topic.source_url).hostname,
      source_url: topic.source_url,
      age: "This week",
      tag: postType,
      angles: [topic.topic],
      is_stretch: i === rankedTopics.length - 1,
    }));
    return {
      stories: fallbackStories,
      article_count: rssItems.length,
      source_count: 0,
      sources_metadata: [],
    };
  }

  // Stage 3: Claude Haiku synthesizes each Sonar result into a story card
  const storyPromises = successfulResults.map(async ({ topic, sonar }) => {
    const synthStart = Date.now();
    const synthResponse = await client.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 1000,
      system: "You synthesize research into LinkedIn post story cards. Always return valid JSON.",
      messages: [
        { role: "user", content: buildSynthesisPrompt(topic.topic, sonar.content, sonar.citations, postType) },
      ],
    });
    const synthDuration = Date.now() - synthStart;
    const synthText = synthResponse.content[0].type === "text" ? synthResponse.content[0].text : "";

    logger.log({
      step: `synthesis_${topic.topic.substring(0, 30)}`,
      model: MODELS.HAIKU,
      input_messages: JSON.stringify([{ role: "user", content: `synthesis for: ${topic.topic}` }]),
      output_text: synthText,
      tool_calls: null,
      input_tokens: synthResponse.usage.input_tokens,
      output_tokens: synthResponse.usage.output_tokens,
      thinking_tokens: 0,
      duration_ms: synthDuration,
    });

    return { stories: parseSynthesizedStories(synthText), citations: sonar.citations };
  });

  const synthesized = await Promise.all(storyPromises);
  const allStories = synthesized.flatMap((s) => s.stories).slice(0, 3);
  const allCitations = [...new Set(synthesized.flatMap((s) => s.citations))];

  // Mark last story as stretch
  if (allStories.length > 0) {
    allStories[allStories.length - 1].is_stretch = true;
  }

  return {
    stories: allStories,
    article_count: rssItems.length,
    source_count: allCitations.length,
    sources_metadata: allCitations.map((url) => {
      try { return { name: new URL(url).hostname, url }; }
      catch { return { name: url, url }; }
    }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/__tests__/researcher.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd server && npx vitest run`
Expected: All pass. If existing researcher tests exist and break because the function signature changed, update them to pass the new `options` parameter.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/researcher.ts server/src/__tests__/researcher.test.ts
git -c commit.gpgsign=false commit -m "feat: rewrite researcher with RSS + Sonar Pro pipeline"
```

---

### Task 7: Update generate route to accept topic and avoid params

**Files:**
- Modify: `server/src/routes/generate.ts` (lines 54-93)

- [ ] **Step 1: Update the research endpoint**

In `server/src/routes/generate.ts`, change the research endpoint (around line 54):

```typescript
  app.post("/api/generate/research", async (request, reply) => {
    const { post_type, topic, avoid } = request.body as {
      post_type: string;
      topic?: string;
      avoid?: string[];
    };
    if (!["news", "topic", "insight"].includes(post_type)) {
      return reply.status(400).send({ error: "post_type must be news, topic, or insight" });
    }

    const client = getClient();
    const runId = createRun(db, "generate_research", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await researchStories(client, db, logger, post_type, {
        topic: topic || undefined,
        avoid: avoid || undefined,
      });

      const researchId = insertResearch(db, {
        post_type,
        stories_json: JSON.stringify(result.stories),
        sources_json: JSON.stringify(result.sources_metadata),
        article_count: result.article_count,
        source_count: result.source_count,
      });

      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      completeRun(db, runId, {
        input_tokens: logs.reduce((s, l) => s + l.input_tokens, 0),
        output_tokens: logs.reduce((s, l) => s + l.output_tokens, 0),
        cost_cents: calculateCostCents(logs),
      });

      return {
        research_id: researchId,
        stories: result.stories,
        article_count: result.article_count,
        source_count: result.source_count,
      };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });
```

- [ ] **Step 2: Run existing route tests**

Run: `cd server && npx vitest run src/__tests__/generate-routes.test.ts`
Expected: PASS (existing tests don't hit the research endpoint directly since it needs API keys)

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/generate.ts
git -c commit.gpgsign=false commit -m "feat: accept topic and avoid params in research endpoint"
```

---

## Chunk 5: Frontend Changes

### Task 8: Update API client

**Files:**
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add source_url to GenStory and update generateResearch**

In `dashboard/src/api/client.ts`, update `GenStory` interface (around line 225):

```typescript
export interface GenStory {
  headline: string;
  summary: string;
  source: string;
  source_url?: string;
  age: string;
  tag: string;
  angles: string[];
  is_stretch: boolean;
}
```

Update `generateResearch` method (around line 521):

```typescript
  generateResearch: (postType: string, topic?: string, avoid?: string[]) =>
    fetch(`${BASE_URL}/generate/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        post_type: postType,
        ...(topic && { topic }),
        ...(avoid && avoid.length > 0 && { avoid }),
      }),
    }).then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json() as Promise<GenResearchResponse>;
    }),
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/api/client.ts
git -c commit.gpgsign=false commit -m "feat: update API client with source_url and topic params"
```

---

### Task 9: Update GenerationState with per-type cache

**Files:**
- Modify: `dashboard/src/pages/Generate.tsx`

- [ ] **Step 1: Refactor GenerationState to use per-type cache**

Replace the `GenerationState` interface and `initialState` in `dashboard/src/pages/Generate.tsx`:

```typescript
type PostType = "news" | "topic" | "insight";

interface TypeCache {
  stories: GenStory[];
  researchId: number | null;
  articleCount: number;
  sourceCount: number;
}

interface GenerationState {
  postType: PostType;
  cache: Record<PostType, TypeCache | null>;
  // Top-level convenience fields — derived from cache + current type
  researchId: number | null;
  stories: GenStory[];
  articleCount: number;
  sourceCount: number;
  selectedStoryIndex: number | null;
  generationId: number | null;
  drafts: GenDraft[];
  selectedDraftIndices: number[];
  combiningGuidance: string;
  finalDraft: string;
  qualityGate: GenQualityGate | null;
  appliedInsights: GenCoachingInsight[];
  personalConnection: string;
}

const initialState: GenerationState = {
  postType: "news",
  cache: { news: null, topic: null, insight: null },
  researchId: null,
  stories: [],
  articleCount: 0,
  sourceCount: 0,
  selectedStoryIndex: null,
  generationId: null,
  drafts: [],
  selectedDraftIndices: [],
  combiningGuidance: "",
  finalDraft: "",
  qualityGate: null,
  appliedInsights: [],
  personalConnection: "",
};
```

Keep `researchId`, `stories`, `articleCount`, `sourceCount` as top-level convenience fields that stay in sync with the active cache. This avoids breaking downstream components (`DraftVariations`, `ReviewEdit`) that reference `gen.stories` or `gen.researchId`.

The sync happens in `StorySelection`'s `switchPostType` function when it updates the cache — it also sets the top-level fields from cache.

Pass `gen` directly to all child components (no prop derivation needed since top-level fields stay synced):

```typescript
<StorySelection
  gen={gen}
  setGen={setGen}
  loading={loading}
  setLoading={setLoading}
  onNext={() => setStep(2)}
/>
```

`StorySelection`'s interface stays the same as today — it reads `gen.stories`, `gen.researchId`, etc. from the top level. When writing research results, it updates both `cache[postType]` AND the top-level fields. This keeps backward compatibility with `DraftVariations` and `ReviewEdit`.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Generate.tsx
git -c commit.gpgsign=false commit -m "feat: refactor GenerationState to per-type cache"
```

---

### Task 10: Rewrite StorySelection with manual topic + cached tabs

**Files:**
- Modify: `dashboard/src/pages/generate/StorySelection.tsx`

- [ ] **Step 1: Rewrite StorySelection**

Replace `dashboard/src/pages/generate/StorySelection.tsx` with:

```typescript
import { useState, useEffect, useRef } from "react";
import { api, type GenStory } from "../../api/client";
import StoryCard from "./components/StoryCard";

type PostType = "news" | "topic" | "insight";

interface StorySelectionProps {
  gen: {
    postType: PostType;
    stories: GenStory[];
    researchId: number | null;
    articleCount: number;
    sourceCount: number;
    selectedStoryIndex: number | null;
    personalConnection: string;
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onNext: () => void;
}

const postTypes: { value: PostType; label: string }[] = [
  { value: "news", label: "News" },
  { value: "topic", label: "Topic" },
  { value: "insight", label: "Insight" },
];

const LOADING_MESSAGES = [
  "Scanning news feeds...",
  "Finding the best stories...",
  "Researching in depth...",
  "Preparing your stories...",
];

const MANUAL_LOADING_MESSAGES = [
  "Researching your topic...",
  "Finding multiple perspectives...",
  "Preparing your stories...",
];

export default function StorySelection({ gen, setGen, loading, setLoading, onNext }: StorySelectionProps) {
  const [showConnectionInput, setShowConnectionInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualTopic, setManualTopic] = useState("");
  const [loadingMessage, setLoadingMessage] = useState("");
  const loadingTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Progressive loading messages
  useEffect(() => {
    if (loading) {
      const messages = manualTopic ? MANUAL_LOADING_MESSAGES : LOADING_MESSAGES;
      let idx = 0;
      setLoadingMessage(messages[0]);
      loadingTimerRef.current = setInterval(() => {
        idx = Math.min(idx + 1, messages.length - 1);
        setLoadingMessage(messages[idx]);
      }, 3000);
    } else {
      if (loadingTimerRef.current) clearInterval(loadingTimerRef.current);
      setLoadingMessage("");
    }
    return () => {
      if (loadingTimerRef.current) clearInterval(loadingTimerRef.current);
    };
  }, [loading, manualTopic]);

  const switchPostType = (postType: PostType) => {
    setGen((prev: any) => {
      const cached = prev.cache[postType];
      return {
        ...prev,
        postType,
        // Sync top-level from cache
        researchId: cached?.researchId ?? null,
        stories: cached?.stories ?? [],
        articleCount: cached?.articleCount ?? 0,
        sourceCount: cached?.sourceCount ?? 0,
        selectedStoryIndex: null, // Clear selection on tab switch
      };
    });
    setError(null);
    setShowConnectionInput(false);
  };

  const doResearch = async (postType: PostType, topic?: string) => {
    setLoading(true);
    setError(null);
    setShowConnectionInput(false);

    // Get previous headlines to avoid (for "New research" freshness)
    const previousStories = gen.stories;
    const avoid = previousStories.map((s) => s.headline);

    // Clear current cache and top-level fields for this type
    setGen((prev: any) => ({
      ...prev,
      cache: { ...prev.cache, [postType]: null },
      stories: [],
      researchId: null,
      articleCount: 0,
      sourceCount: 0,
      selectedStoryIndex: null,
      postType,
    }));

    try {
      const res = await api.generateResearch(postType, topic || undefined, avoid.length > 0 ? avoid : undefined);
      setGen((prev: any) => ({
        ...prev,
        cache: {
          ...prev.cache,
          [postType]: {
            researchId: res.research_id,
            stories: res.stories,
            articleCount: res.article_count,
            sourceCount: res.source_count,
          },
        },
        // Sync top-level fields for downstream components
        researchId: res.research_id,
        stories: res.stories,
        articleCount: res.article_count,
        sourceCount: res.source_count,
        selectedStoryIndex: null,
        postType,
      }));
    } catch (err: any) {
      console.error("Research failed:", err);
      setError(err.message ?? "Research failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = () => {
    if (!manualTopic.trim()) return;
    doResearch(gen.postType, manualTopic.trim());
  };

  const handleGenerateDrafts = async () => {
    if (gen.selectedStoryIndex === null || gen.researchId === null) return;
    setLoading(true);
    try {
      const res = await api.generateDrafts(gen.researchId, gen.selectedStoryIndex, gen.postType, gen.personalConnection || undefined);
      setGen((prev: any) => ({
        ...prev,
        generationId: res.generation_id,
        drafts: res.drafts,
        selectedDraftIndices: [],
      }));
      onNext();
    } catch (err) {
      console.error("Draft generation failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoPickAndGenerate = async () => {
    if (gen.researchId === null || gen.stories.length === 0) return;
    const bestIndex = gen.stories.findIndex((s) => !s.is_stretch);
    const pickIndex = bestIndex >= 0 ? bestIndex : 0;
    setGen((prev: any) => ({ ...prev, selectedStoryIndex: pickIndex }));
    setLoading(true);
    try {
      const res = await api.generateDrafts(gen.researchId, pickIndex, gen.postType);
      setGen((prev: any) => ({
        ...prev,
        selectedStoryIndex: pickIndex,
        generationId: res.generation_id,
        drafts: res.drafts,
        selectedDraftIndices: [],
      }));
      onNext();
    } catch (err) {
      console.error("Draft generation failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const hasStories = gen.stories.length > 0;
  const showInitialPrompt = !hasStories && !loading;

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-[15px] font-medium text-gen-text-0">
          {hasStories ? "Pick a story to write about" : "What do you want to write about?"}
        </h2>
        <div className="flex gap-1">
          {postTypes.map((pt) => (
            <button
              key={pt.value}
              onClick={() => switchPostType(pt.value)}
              disabled={loading}
              className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors ${
                gen.postType === pt.value
                  ? "bg-gen-accent-soft text-gen-accent border border-gen-accent-border"
                  : "text-gen-text-3 hover:text-gen-text-1 border border-transparent"
              }`}
            >
              {pt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[13px] text-red-400">
          {error}
        </div>
      )}

      {/* Initial prompt — manual topic or auto-generate */}
      {showInitialPrompt && (
        <div className="flex flex-col items-center py-12">
          <div className="w-full max-w-md space-y-4">
            {/* Manual topic input */}
            <div>
              <label className="block text-[13px] text-gen-text-2 mb-2">
                I want to write about...
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualTopic}
                  onChange={(e) => setManualTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
                  placeholder="e.g. AI agents in security operations"
                  className="flex-1 bg-gen-bg-0 border border-gen-border-1 rounded-lg px-3 py-2 text-[13px] text-gen-text-0 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent"
                />
                <button
                  onClick={handleManualSubmit}
                  disabled={!manualTopic.trim()}
                  className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-lg hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Go
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gen-border-1" />
              <span className="text-[12px] text-gen-text-4">or</span>
              <div className="flex-1 h-px bg-gen-border-1" />
            </div>

            {/* Auto-generate button */}
            <button
              onClick={() => doResearch(gen.postType)}
              className="w-full py-3 rounded-lg border border-gen-border-1 text-[13px] text-gen-text-2 hover:text-gen-text-0 hover:border-gen-border-2 transition-colors"
            >
              Find me something
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !hasStories && (
        <div className="flex items-center justify-center py-20 text-gen-text-3 text-[14px]">
          <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
          {loadingMessage || "Researching stories..."}
        </div>
      )}

      {/* Story cards */}
      {hasStories && (
        <div className="space-y-3">
          {gen.stories.map((story, i) => (
            <StoryCard
              key={i}
              story={story}
              index={i}
              selected={gen.selectedStoryIndex === i}
              onSelect={() =>
                setGen((prev: any) => ({ ...prev, selectedStoryIndex: i }))
              }
            />
          ))}
        </div>
      )}

      {/* Bottom bar */}
      {hasStories && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
          <div className="flex items-center gap-3">
            <button
              onClick={() => doResearch(gen.postType)}
              disabled={loading}
              className="text-[13px] text-gen-text-2 hover:text-gen-text-0 transition-colors disabled:opacity-50"
            >
              New research
            </button>
            <span className="text-[12px] text-gen-text-3">
              {gen.articleCount} articles from {gen.sourceCount} sources
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleAutoPickAndGenerate}
              disabled={loading}
              className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors disabled:opacity-50"
            >
              Auto-pick best match
            </button>
            <button
              onClick={() => setShowConnectionInput(true)}
              disabled={gen.selectedStoryIndex === null || loading}
              className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Generating..." : "Generate drafts"}
            </button>
          </div>
        </div>
      )}

      {/* Personal connection input */}
      {showConnectionInput && gen.selectedStoryIndex !== null && (
        <div className="mt-4 p-4 bg-gen-bg-1 border border-gen-border-1 rounded-xl space-y-3">
          <div>
            <h3 className="text-[14px] font-medium text-gen-text-0">
              What's your personal connection to this?
            </h3>
            <p className="text-[12px] text-gen-text-3 mt-1">
              Optional — helps the AI ground the draft in your real experience.
            </p>
          </div>
          <textarea
            value={gen.personalConnection}
            onChange={(e) => setGen((prev: any) => ({ ...prev, personalConnection: e.target.value }))}
            rows={3}
            placeholder='e.g. "We migrated off Heroku to AWS and it took 6 months longer than estimated. The real cost wasn&#39;t the migration — it was the feature freeze."'
            className="w-full bg-gen-bg-0 border border-gen-border-1 rounded-lg px-3 py-2 text-[13px] text-gen-text-0 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent resize-none"
          />
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => { setShowConnectionInput(false); handleGenerateDrafts(); }}
              className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors"
            >
              Skip — generate without
            </button>
            <button
              onClick={() => { setShowConnectionInput(false); handleGenerateDrafts(); }}
              disabled={loading}
              className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40"
            >
              {loading ? "Generating..." : "Generate with connection"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the dashboard compiles**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/generate/StorySelection.tsx
git -c commit.gpgsign=false commit -m "feat: add manual topic input, cached tabs, progressive loading"
```

---

### Task 11: Update StoryCard to make source a clickable link

**Files:**
- Modify: `dashboard/src/pages/generate/components/StoryCard.tsx` (line 53)

- [ ] **Step 1: Make source clickable when source_url exists**

In `dashboard/src/pages/generate/components/StoryCard.tsx`, replace the source span (line 53):

```typescript
// Before:
<span className="text-gen-text-3">{story.source}</span>

// After:
{story.source_url ? (
  <a
    href={story.source_url}
    target="_blank"
    rel="noopener noreferrer"
    onClick={(e) => e.stopPropagation()}
    className="text-gen-text-3 hover:text-gen-accent transition-colors underline underline-offset-2"
  >
    {story.source}
  </a>
) : (
  <span className="text-gen-text-3">{story.source}</span>
)}
```

Note: `e.stopPropagation()` prevents the link click from triggering the StoryCard's `onSelect`.

- [ ] **Step 2: Verify dashboard compiles**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/generate/components/StoryCard.tsx
git -c commit.gpgsign=false commit -m "feat: make story source a clickable link"
```

---

### Task 12: Add PERPLEXITY_API_KEY to environment

**Files:**
- Modify: `server/.env` (or `.env.example` if it exists)

- [ ] **Step 1: Check for env file pattern**

Run: `ls -la server/.env* server/../.env* 2>/dev/null`

Look at how `TRUSTMIND_LLM_API_KEY` is configured — follow the same pattern for `PERPLEXITY_API_KEY`.

- [ ] **Step 2: Add the key**

If there's an `.env.example`, add: `PERPLEXITY_API_KEY=your_perplexity_api_key_here`
If env vars are set directly, the user needs to set `PERPLEXITY_API_KEY` in their environment.

- [ ] **Step 3: Commit (only if .env.example modified)**

```bash
git add .env.example  # or wherever the pattern is
git -c commit.gpgsign=false commit -m "docs: add PERPLEXITY_API_KEY to env example"
```

---

### Task 13: Manual end-to-end verification

- [ ] **Step 1: Run full server test suite**

Run: `cd server && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run dashboard type check**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Start the app and test manually**

Run: `cd server && npm run dev`

Test these flows in the browser:
1. Go to Generate tab — should see "I want to write about..." prompt (not auto-research)
2. Type a topic (e.g., "AI agents in cybersecurity") and click Go — should see progressive loading, then 3 story cards with real sources
3. Click "Find me something" — should fetch RSS feeds and show 3 story cards with real headlines
4. Switch between News/Topic/Insight tabs — cached results should appear instantly
5. Click "New research" — should fetch fresh results (different from previous)
6. Select a story and generate drafts — existing flow should work unchanged
7. Verify story cards show clickable source links

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git -c commit.gpgsign=false commit -m "fix: end-to-end adjustments for generate flow redesign"
```
