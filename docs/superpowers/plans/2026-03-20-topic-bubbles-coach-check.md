# Topic Bubbles + Coach-Check + Conversational Revision Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace post type tabs with browsable topic discovery, replace pass/warn quality gate with auto-fixing coach-check, and replace action-button revision with conversational chat.

**Architecture:** Three connected changes to the Generate pipeline: (1) new discovery endpoint clusters RSS headlines into ~20 topic bubbles, (2) coach-check module auto-fixes rule violations and surfaces human-judgment questions, (3) chat endpoint enables conversational revision with history. Post type concept is removed entirely.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Anthropic SDK (via OpenRouter), React, Tailwind CSS

---

## Chunk 1: Server — Database Migration + Coach-Check Module

### Task 1: Database migration — `generation_messages` table

**Files:**
- Create: `server/src/db/migrations/012-generation-messages.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration 012: Chat-based revision messages
CREATE TABLE IF NOT EXISTS generation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL REFERENCES generations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  draft_snapshot TEXT,
  quality_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generation_messages_gen ON generation_messages(generation_id);
```

- [ ] **Step 2: Verify migration applies**

Run: `cd /Users/nate/code/linkedin && npx vitest run server/src/__tests__/db.test.ts`
Expected: PASS (migration runner picks up the new file automatically)

- [ ] **Step 3: Add query functions for generation_messages**

Modify: `server/src/db/generate-queries.ts`

Add at the end of the file:

```typescript
// ── Generation Messages (chat history) ───────────────────

export interface GenerationMessage {
  id: number;
  generation_id: number;
  role: string;
  content: string;
  draft_snapshot: string | null;
  quality_json: string | null;
  created_at: string;
}

export function insertGenerationMessage(
  db: Database.Database,
  data: {
    generation_id: number;
    role: string;
    content: string;
    draft_snapshot?: string;
    quality_json?: string;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO generation_messages (generation_id, role, content, draft_snapshot, quality_json)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(data.generation_id, data.role, data.content, data.draft_snapshot ?? null, data.quality_json ?? null);
  return Number(result.lastInsertRowid);
}

export function getGenerationMessages(
  db: Database.Database,
  generationId: number,
  limit: number = 20
): GenerationMessage[] {
  return db
    .prepare(
      `SELECT * FROM generation_messages WHERE generation_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(generationId, limit) as GenerationMessage[];
}
```

- [ ] **Step 4: Write test for generation_messages queries**

Modify: `server/src/__tests__/generate-queries.test.ts`

Add a test block:

```typescript
describe("generation_messages queries", () => {
  it("inserts and retrieves messages", () => {
    // First insert a research record and generation to satisfy FK
    const researchId = insertResearch(db, {
      post_type: "general",
      stories_json: "[]",
    });
    const genId = insertGeneration(db, {
      research_id: researchId,
      post_type: "general",
      selected_story_index: 0,
      drafts_json: "[]",
    });

    const msgId = insertGenerationMessage(db, {
      generation_id: genId,
      role: "user",
      content: "Make it shorter",
    });
    expect(msgId).toBeGreaterThan(0);

    const assistantId = insertGenerationMessage(db, {
      generation_id: genId,
      role: "assistant",
      content: "Here is the shortened version",
      draft_snapshot: "shortened draft text",
      quality_json: '{"expertise_needed":[],"alignment":[]}',
    });
    expect(assistantId).toBeGreaterThan(msgId);

    const messages = getGenerationMessages(db, genId);
    expect(messages).toHaveLength(2);
    // Ordered DESC so most recent first
    expect(messages[0].role).toBe("assistant");
    expect(messages[1].role).toBe("user");
  });
});
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run server/src/__tests__/generate-queries.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/db/migrations/012-generation-messages.sql server/src/db/generate-queries.ts server/src/__tests__/generate-queries.test.ts
git commit -m "feat: add generation_messages table for chat-based revision"
```

---

### Task 2: Coach-check module

**Files:**
- Create: `server/src/ai/coach-check.ts`
- Create: `server/src/__tests__/coach-check.test.ts`

- [ ] **Step 1: Write the test for coachCheck**

Create `server/src/__tests__/coach-check.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildCoachCheckPrompt, parseCoachCheckResponse } from "../ai/coach-check.js";

describe("buildCoachCheckPrompt", () => {
  it("includes draft, rules, and insights in prompt", () => {
    const prompt = buildCoachCheckPrompt(
      "This is a draft about AI.",
      [{ id: 1, category: "voice_tone", rule_text: "Be direct", example_text: null, sort_order: 0, enabled: 1 }],
      [{ id: 1, title: "Test insight", prompt_text: "Use examples", evidence: null, status: "active", source_sync_id: null, created_at: "", updated_at: "", retired_at: null }]
    );
    expect(prompt).toContain("This is a draft about AI.");
    expect(prompt).toContain("Be direct");
    expect(prompt).toContain("Use examples");
    expect(prompt).toContain("voice_match");
    expect(prompt).toContain("expertise_needed");
  });
});

describe("parseCoachCheckResponse", () => {
  it("parses valid JSON response", () => {
    const json = JSON.stringify({
      draft: "Fixed draft text",
      expertise_needed: [{ area: "Framing", question: "Is this the right angle?" }],
      alignment: [{ dimension: "voice_match", summary: "Matches practitioner tone" }],
    });
    const result = parseCoachCheckResponse(json);
    expect(result.draft).toBe("Fixed draft text");
    expect(result.expertise_needed).toHaveLength(1);
    expect(result.alignment).toHaveLength(1);
  });

  it("handles markdown-wrapped JSON", () => {
    const text = "```json\n" + JSON.stringify({
      draft: "Draft",
      expertise_needed: [],
      alignment: [],
    }) + "\n```";
    const result = parseCoachCheckResponse(text);
    expect(result.draft).toBe("Draft");
  });

  it("returns original draft on parse failure", () => {
    const result = parseCoachCheckResponse("not json at all");
    expect(result.draft).toBe("");
    expect(result.expertise_needed).toEqual([]);
    expect(result.alignment).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nate/code/linkedin && npx vitest run server/src/__tests__/coach-check.test.ts`
Expected: FAIL — module does not exist yet

- [ ] **Step 3: Implement coach-check module**

Create `server/src/ai/coach-check.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import type { GenerationRule, CoachingInsight } from "../db/generate-queries.js";

export type AlignmentDimension =
  | "voice_match"
  | "ai_tropes"
  | "hook_strength"
  | "engagement_close"
  | "concrete_specifics"
  | "ending_quality";

export interface CoachCheckResult {
  draft: string;
  expertise_needed: Array<{ area: string; question: string }>;
  alignment: Array<{ dimension: AlignmentDimension; summary: string }>;
}

const DIMENSIONS: Array<{ name: AlignmentDimension; description: string }> = [
  { name: "voice_match", description: "Does the post sound like a practitioner, not an analyst? Check against writing rules for tone and specificity." },
  { name: "ai_tropes", description: "No hedge words, correlative constructions, rhetorical questions as filler, meandering intros, recapping conclusions." },
  { name: "hook_strength", description: "Opens with friction, a claim, or a surprise — not a question, context dump, or generic statement." },
  { name: "engagement_close", description: "Closing invites informed practitioner responses — not generic opinion questions." },
  { name: "concrete_specifics", description: "Uses named tools, specific metrics, real experiences — not vague abstractions." },
  { name: "ending_quality", description: "Ending extends the idea forward — does not summarize, recap, or restate." },
];

export function buildCoachCheckPrompt(
  draft: string,
  rules: GenerationRule[],
  insights: CoachingInsight[]
): string {
  const rulesText = rules
    .filter((r) => r.enabled)
    .map((r) => {
      let line = `- [${r.category}] ${r.rule_text}`;
      if (r.example_text) line += ` (${r.example_text})`;
      return line;
    })
    .join("\n");

  const insightsText = insights
    .map((i) => `- **${i.title}**: ${i.prompt_text}`)
    .join("\n");

  const dimensionsText = DIMENSIONS
    .map((d) => `- **${d.name}**: ${d.description}`)
    .join("\n");

  return `You are a writing coach for LinkedIn posts. Your job is to:

1. **Fix** any rule violations in the draft silently — rewrite to comply without explaining what you changed.
2. **Identify** 2-4 areas where the author's real expertise and judgment are needed (framing choices, perspective decisions, domain knowledge gaps). These are things rules alone cannot resolve.
3. **Confirm** alignment on each quality dimension with a specific reason.

## Draft
${draft}

## Writing Rules
${rulesText}

## Coaching Insights
${insightsText}

## Quality Dimensions
${dimensionsText}

Return JSON only (no markdown fences, no extra text):
{
  "draft": "the full revised draft with rule violations fixed",
  "expertise_needed": [
    { "area": "short label", "question": "what the author should weigh in on" }
  ],
  "alignment": [
    { "dimension": "voice_match|ai_tropes|hook_strength|engagement_close|concrete_specifics|ending_quality", "summary": "why this dimension is satisfied" }
  ]
}

Important:
- Do NOT over-edit. Preserve the argument structure and specific content.
- Fix rule violations (banned words, correlative constructions, recap paragraphs, weak hooks) silently.
- Surface framing/perspective issues as expertise_needed — these are for the human to decide.
- Every quality dimension must appear in alignment with a specific summary.`;
}

export function parseCoachCheckResponse(text: string): CoachCheckResult {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { draft: "", expertise_needed: [], alignment: [] };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      draft: parsed.draft ?? "",
      expertise_needed: Array.isArray(parsed.expertise_needed) ? parsed.expertise_needed : [],
      alignment: Array.isArray(parsed.alignment) ? parsed.alignment : [],
    };
  } catch {
    return { draft: "", expertise_needed: [], alignment: [] };
  }
}

export async function coachCheck(
  client: Anthropic,
  logger: AiLogger,
  draft: string,
  rules: GenerationRule[],
  insights: CoachingInsight[]
): Promise<CoachCheckResult> {
  const prompt = buildCoachCheckPrompt(draft, rules, insights);

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 4000,
    system: "You are a writing quality coach. Return valid JSON only.",
    messages: [{ role: "user", content: prompt }],
  });

  const duration = Date.now() - start;
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.log({
    step: "coach_check",
    model: MODELS.SONNET,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  const result = parseCoachCheckResponse(text);

  // If parse returned empty draft, fall back to original
  if (!result.draft) {
    result.draft = draft;
  }

  return result;
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run server/src/__tests__/coach-check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/coach-check.ts server/src/__tests__/coach-check.test.ts
git commit -m "feat: add coach-check module for auto-fixing rule violations"
```

---

### Task 3: Wire coach-check into combine endpoint

**Files:**
- Modify: `server/src/routes/generate.ts` (combine endpoint, lines 177-250)
- Modify: `server/src/db/generate-queries.ts` (QualityGate type)
- Modify: `server/src/__tests__/generate-routes.test.ts`

- [ ] **Step 1: Update QualityGate types in generate-queries.ts**

Add a new type alongside the existing one for backward compatibility:

```typescript
// New coach-check quality shape
export interface CoachCheckQuality {
  expertise_needed: Array<{ area: string; question: string }>;
  alignment: Array<{ dimension: string; summary: string }>;
}
```

- [ ] **Step 2: Update the combine endpoint in generate.ts**

Replace the `runQualityGate` import with `coachCheck`:

```typescript
// Remove: import { runQualityGate } from "../ai/quality-gate.js";
// Add:
import { coachCheck } from "../ai/coach-check.js";
```

In the combine endpoint handler, replace the quality gate call:

**Old code (lines 207-210):**
```typescript
const qualityGate = await runQualityGate(client, logger, combineResult.final_draft, rules, insights);
```

**New code:**
```typescript
const coachResult = await coachCheck(client, logger, combineResult.final_draft, rules, insights);
const qualityData = {
  expertise_needed: coachResult.expertise_needed,
  alignment: coachResult.alignment,
};
```

**Remove** the `insertRevision` call entirely from the combine endpoint (per spec: `generation_revisions` gets no new writes — replaced by `generation_messages`).

Update the generation update and return:
```typescript
const genUpdate: Parameters<typeof updateGeneration>[2] = {
  selected_draft_indices: JSON.stringify(selected_drafts),
  final_draft: coachResult.draft,
  quality_gate_json: JSON.stringify(qualityData),
};
// ...
return { final_draft: coachResult.draft, quality: qualityData };
```

- [ ] **Step 3: Update the route test**

The combine endpoint test still tests 404 for nonexistent generation, which doesn't change. No test update needed for the 404 case. The actual LLM-dependent behavior isn't testable without mocking.

- [ ] **Step 4: Run tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run server/src/__tests__/generate-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/generate.ts server/src/db/generate-queries.ts
git commit -m "feat: wire coach-check into combine endpoint, replacing quality gate"
```

---

## Chunk 2: Server — Simplify Research/Drafts, Add Discovery + Chat Endpoints

### Task 4: Simplify research endpoint — remove post type, require topic

**Files:**
- Modify: `server/src/routes/generate.ts` (research endpoint, lines 52-104)
- Modify: `server/src/ai/perplexity.ts` (drop postType param)
- Modify: `server/src/ai/researcher.ts` (drop auto path, simplify)
- Modify: `server/src/__tests__/researcher.test.ts`
- Modify: `server/src/__tests__/perplexity.test.ts`

- [ ] **Step 1: Simplify searchWithSonarPro — remove postType parameter**

Modify `server/src/ai/perplexity.ts`:

Replace the `SEARCH_PROMPTS` record and `buildSearchPrompt` function with a single general prompt:

```typescript
export function buildSearchPrompt(topic: string): string {
  return `Find recent coverage, practitioner discussions, and multiple perspectives on "${topic}". Include specific examples, named sources, and concrete outcomes. Focus on what happened, what's controversial, and what practitioners are saying.`;
}
```

Update `searchWithSonarPro` signature — remove `postType` parameter:

```typescript
export async function searchWithSonarPro(
  topic: string,
  logger: AiLogger
): Promise<SonarResult> {
  // ...
  const searchPrompt = buildSearchPrompt(topic);
  // ... rest stays the same
}
```

- [ ] **Step 2: Update perplexity tests**

Modify `server/src/__tests__/perplexity.test.ts` — update any tests that pass `postType` to `buildSearchPrompt` or `searchWithSonarPro`.

- [ ] **Step 3: Simplify researcher.ts — remove auto path**

Modify `server/src/ai/researcher.ts`:

Remove:
- `buildRankingPrompt` function
- `parseRankedTopics` function
- The entire auto path in `researchStories` (the `if (!options?.topic)` branch)
- The `RankedTopic` interface/export
- The `fetchAllFeeds` import (discovery endpoint will use it instead)
- `postType` parameter from `researchStories`, `synthesizeTopic`, `buildSynthesisPrompt`

Make `topic` required in `researchStories`. Keep `avoid` as optional — per spec, it stays optional and is passed to the synthesis prompt so the AI avoids overlapping angles with previously-covered headlines:

```typescript
export async function researchStories(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger,
  topic: string,
  avoid?: string[]
): Promise<ResearchResult> {
  const sonarResult = await searchWithSonarPro(topic, logger);
  const stories = await synthesizeTopic(client, logger, topic, sonarResult, avoid);
  const finalStories = markStretch(stories.slice(0, 3));
  return {
    stories: finalStories,
    article_count: sonarResult.citations.length,
    source_count: sonarResult.citations.length,
    sources_metadata: sonarResult.citations.map((url) => ({ name: safeHostname(url), url })),
  };
}
```

Update `buildSynthesisPrompt` — remove `postType` parameter, use a single general framing:

```typescript
export function buildSynthesisPrompt(
  topic: string,
  sonarContent: string,
  citations: string[],
  avoid?: string[]
): string {
  const citationList =
    citations.length > 0
      ? `\n\nSources (cite 1-2 per story):\n${citations.map((c, i) => `[${i + 1}] ${c}`).join("\n")}`
      : "";

  const avoidSection =
    avoid && avoid.length > 0
      ? `\n\nAvoid overlapping with these previously covered angles:\n${avoid.map((a) => `- ${a}`).join("\n")}`
      : "";

  return `You are synthesizing web research into LinkedIn story cards.

Topic: ${topic}
Framing guidance: Frame each angle as a distinct practitioner perspective — different audience, different hook. Think: contrarian take, operator perspective, future implication.

Research content:
${sonarContent}${citationList}${avoidSection}

Create exactly 3 story card angles on this topic. Each angle should be distinct.

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
```

Remove `postType` from `synthesizeTopic`:

```typescript
async function synthesizeTopic(
  client: Anthropic,
  logger: AiLogger,
  topic: string,
  sonarResult: SonarResult,
  avoid?: string[]
): Promise<Story[]> {
  const synthPrompt = buildSynthesisPrompt(topic, sonarResult.content, sonarResult.citations, avoid);
  // ... rest stays the same
}
```

- [ ] **Step 4: Update the research route**

Modify `server/src/routes/generate.ts` research endpoint:

```typescript
app.post("/api/generate/research", async (request, reply) => {
  const { topic, avoid } = request.body as {
    topic: string;
    avoid?: string[];
  };
  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return reply.status(400).send({ error: "topic is required" });
  }
  const safeTopic = topic.slice(0, 500).trim();

  const client = getClient();
  const runId = createRun(db, "generate_research", 0);
  const logger = new AiLogger(db, runId);

  try {
    const result = await researchStories(client, db, logger, safeTopic, avoid);

    const researchId = insertResearch(db, {
      post_type: "general",
      stories_json: JSON.stringify(result.stories),
      sources_json: JSON.stringify(result.sources_metadata),
      article_count: result.article_count,
      source_count: result.source_count,
    });

    // ... cost tracking stays the same ...

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

- [ ] **Step 5: Update researcher tests**

Modify `server/src/__tests__/researcher.test.ts` — update function signatures and remove tests for ranking/auto path.

- [ ] **Step 6: Update generate-routes research test**

Replace the `post_type` validation test with topic validation test:

```typescript
describe("POST /api/generate/research", () => {
  it("rejects missing topic", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/research",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 7: Run all tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/ai/perplexity.ts server/src/ai/researcher.ts server/src/routes/generate.ts server/src/__tests__/researcher.test.ts server/src/__tests__/perplexity.test.ts server/src/__tests__/generate-routes.test.ts
git commit -m "feat: simplify research endpoint — require topic, remove post type"
```

---

### Task 5: Simplify drafts endpoint — remove post type, unified prompt

**Files:**
- Modify: `server/src/routes/generate.ts` (drafts endpoint, lines 106-174)
- Modify: `server/src/ai/drafter.ts` (remove postType param)
- Modify: `server/src/ai/prompt-assembler.ts` (drop postType, skip post_type_templates)

- [ ] **Step 1: Update prompt-assembler — remove postType parameter**

Modify `server/src/ai/prompt-assembler.ts`:

Remove the `postType` parameter, the `formatPostTypeLayer` function, the `getPostTypeTemplate` import, and the post type layer from the assembled prompt:

```typescript
export function assemblePrompt(
  db: Database.Database,
  storyContext: string
): AssembledPrompt {
  const rules = getRules(db);
  const insights = getActiveCoachingInsights(db);

  const rulesText = formatRulesLayer(rules);
  const coachingText = formatCoachingLayer(insights);

  const profile = getAuthorProfile(db);
  const profileText = profile ? formatProfileLayer(profile.profile_text) : "";
  const profileTokens = estimateTokens(profileText);

  let rulesTokens = estimateTokens(rulesText);
  let coachingTokens = estimateTokens(coachingText);

  // Budget check — truncate coaching if needed
  const layerTotal = rulesTokens + coachingTokens + profileTokens;
  let finalCoachingText = coachingText;
  if (layerTotal > TOKEN_BUDGET && insights.length > 0) {
    const available = TOKEN_BUDGET - rulesTokens - profileTokens;
    if (available > 0) {
      let trimmedInsights = [...insights];
      while (estimateTokens(formatCoachingLayer(trimmedInsights)) > available && trimmedInsights.length > 0) {
        trimmedInsights.pop();
      }
      finalCoachingText = formatCoachingLayer(trimmedInsights);
      coachingTokens = estimateTokens(finalCoachingText);
    } else {
      finalCoachingText = "";
      coachingTokens = 0;
    }
  }

  const noFabricationRule = !profileText
    ? "\nIMPORTANT: Do NOT invent specific personal details, company names, project timelines, or experiences."
    : "";

  const system = [
    "You are a LinkedIn post ghostwriter." + noFabricationRule,
    "",
    rulesText,
    "",
    finalCoachingText,
    "",
    profileText,
    "",
    storyContext ? `## Story Context\n\n${storyContext}` : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");

  return {
    system,
    token_count: estimateTokens(system),
    layers: {
      rules: rulesTokens,
      coaching: coachingTokens,
      author_profile: profileTokens,
      post_type: 0,
    },
  };
}
```

Remove `getPostTypeTemplate` from imports and delete `formatPostTypeLayer`.

- [ ] **Step 2: Update drafter.ts — remove postType parameter**

Modify `server/src/ai/drafter.ts`:

```typescript
export async function generateDrafts(
  client: Anthropic,
  db: Database.Database,
  logger: AiLogger,
  story: Story,
  personalConnection?: string
): Promise<DraftResult> {
  const storyContext = `**${story.headline}**\n${story.summary}\nSource: ${story.source} | ${story.age}\nPossible angles: ${story.angles.join("; ")}`;
  const connectionContext = personalConnection
    ? `\n\n## Personal Connection\n${personalConnection}`
    : "";
  const assembled = assemblePrompt(db, storyContext);
  // ... rest stays the same
}
```

- [ ] **Step 3: Update the drafts route**

Modify `server/src/routes/generate.ts` drafts endpoint:

```typescript
app.post("/api/generate/drafts", async (request, reply) => {
  const { research_id, story_index, personal_connection } = request.body as {
    research_id: number;
    story_index: number;
    personal_connection?: string;
  };

  // ... research lookup and validation stays the same ...

  try {
    const result = await generateDrafts(
      client,
      db,
      logger,
      stories[story_index],
      personal_connection
    );

    const generationId = insertGeneration(db, {
      research_id,
      post_type: "general",
      selected_story_index: story_index,
      drafts_json: JSON.stringify(result.drafts),
      prompt_snapshot: result.prompt_snapshot,
      personal_connection,
    });

    // ... rest stays the same
  }
});
```

Remove the `post_type` validation check.

- [ ] **Step 4: Update prompt-assembler test**

Modify `server/src/__tests__/prompt-assembler.test.ts` — remove `postType` argument from `assemblePrompt` calls.

- [ ] **Step 5: Update generate-routes drafts test**

Remove `post_type` from the test payload:

```typescript
describe("POST /api/generate/drafts", () => {
  it("returns 404 for non-existent research", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/drafts",
      payload: { research_id: 999, story_index: 0 },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 6: Run all tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/ai/prompt-assembler.ts server/src/ai/drafter.ts server/src/routes/generate.ts server/src/__tests__/prompt-assembler.test.ts server/src/__tests__/generate-routes.test.ts
git commit -m "feat: simplify drafts endpoint — remove post type, unified prompt"
```

---

### Task 6: Discovery endpoint + clustering prompt

**Files:**
- Modify: `server/src/routes/generate.ts` (add new endpoint)
- Create: `server/src/ai/discovery.ts`
- Create: `server/src/__tests__/discovery.test.ts`

- [ ] **Step 1: Write the test for clustering prompt builder and parser**

Create `server/src/__tests__/discovery.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildClusteringPrompt, parseClusteringResponse } from "../ai/discovery.js";
import type { RssItem } from "../ai/rss-fetcher.js";

const mockItems: RssItem[] = [
  { title: "AI Agents Take Over SRE", link: "https://example.com/1", summary: "AI agents are replacing SREs", pubDate: new Date() },
  { title: "Zero Trust Adoption Stalls", link: "https://example.com/2", summary: "Zero trust is hard", pubDate: new Date() },
];

describe("buildClusteringPrompt", () => {
  it("includes all headlines", () => {
    const prompt = buildClusteringPrompt(mockItems);
    expect(prompt).toContain("AI Agents Take Over SRE");
    expect(prompt).toContain("Zero Trust Adoption Stalls");
  });
});

describe("parseClusteringResponse", () => {
  it("parses valid categories", () => {
    const json = JSON.stringify({
      categories: [
        {
          name: "AI & Automation",
          topics: [
            { label: "AI agents replacing SREs", source_headline: "AI Agents Take Over SRE", source_url: "https://example.com/1" },
          ],
        },
      ],
    });
    const result = parseClusteringResponse(json);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].topics).toHaveLength(1);
  });

  it("returns empty categories on parse failure", () => {
    const result = parseClusteringResponse("not json");
    expect(result.categories).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nate/code/linkedin && npx vitest run server/src/__tests__/discovery.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement discovery module**

Create `server/src/ai/discovery.ts`:

```typescript
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

export function buildClusteringPrompt(items: RssItem[]): string {
  const itemList = items
    .map((item, i) => `${i + 1}. ${item.title} — ${item.summary?.substring(0, 200) || ""} [${item.link}]`)
    .join("\n");

  return `You are organizing RSS feed items into topic clusters for a LinkedIn content creator.

RSS items from the past week:
${itemList}

Organize these into 3-5 thematic categories. For each category:
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
  logger: AiLogger
): Promise<DiscoveryResult> {
  const rssItems = await fetchAllFeeds(db);
  const prompt = buildClusteringPrompt(rssItems);

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
```

- [ ] **Step 4: Add the discover route**

Modify `server/src/routes/generate.ts` — add new endpoint before the research endpoint:

```typescript
import { discoverTopics } from "../ai/discovery.js";

// ── Discovery ──────────────────────────────────────────────

app.post("/api/generate/discover", async (_request, reply) => {
  const client = getClient();
  const runId = createRun(db, "generate_discover", 0);
  const logger = new AiLogger(db, runId);

  try {
    const result = await discoverTopics(client, db, logger);

    const logs = db
      .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
      .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
    completeRun(db, runId, {
      input_tokens: logs.reduce((s, l) => s + l.input_tokens, 0),
      output_tokens: logs.reduce((s, l) => s + l.output_tokens, 0),
      cost_cents: calculateCostCents(logs),
    });

    return result;
  } catch (err: any) {
    failRun(db, runId, err.message);
    return reply.status(500).send({ error: err.message });
  }
});
```

- [ ] **Step 5: Add route test for discovery endpoint**

Add to `server/src/__tests__/generate-routes.test.ts`:

```typescript
describe("POST /api/generate/discover", () => {
  it("endpoint is registered and returns error without API key", async () => {
    const res = await app.inject({ method: "POST", url: "/api/generate/discover" });
    // Without TRUSTMIND_LLM_API_KEY, it should return 500 (not 404)
    expect(res.statusCode).toBe(500);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/ai/discovery.ts server/src/__tests__/discovery.test.ts server/src/routes/generate.ts server/src/__tests__/generate-routes.test.ts
git commit -m "feat: add discovery endpoint with RSS clustering into topic bubbles"
```

---

### Task 7: Chat endpoint + conversation history

**Files:**
- Modify: `server/src/routes/generate.ts` (add chat endpoint, remove revise endpoint)
- Modify: `server/src/__tests__/generate-routes.test.ts`

- [ ] **Step 1: Add chat endpoint to generate.ts**

Add imports:

```typescript
import {
  // ... existing imports ...
  insertGenerationMessage,
  getGenerationMessages,
} from "../db/generate-queries.js";
```

Add the chat endpoint (replace the revise endpoint):

```typescript
// ── Chat (replaces Revise) ───────────────────────────────

app.post("/api/generate/chat", async (request, reply) => {
  const { generation_id, message, edited_draft } = request.body as {
    generation_id: number;
    message: string;
    edited_draft?: string;
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    return reply.status(400).send({ error: "message is required" });
  }

  const gen = getGeneration(db, generation_id);
  if (!gen?.final_draft) {
    return reply.status(404).send({ error: "Generation not found or no final draft" });
  }

  const client = getClient();
  const runId = createRun(db, "generate_chat", 0);
  const logger = new AiLogger(db, runId);

  try {
    // Load conversation history (last 20, reversed to chronological)
    const history = getGenerationMessages(db, generation_id, 20).reverse();

    // Build system prompt with rules + insights
    const rules = getRules(db);
    const insights = getActiveCoachingInsights(db);
    const rulesText = rules.filter((r) => r.enabled).map((r) => `- [${r.category}] ${r.rule_text}`).join("\n");
    const insightsText = insights.map((i) => `- ${i.prompt_text}`).join("\n");

    const systemPrompt = `You are a LinkedIn post revision assistant. Make targeted changes based on user feedback — do not full-rewrite unless asked.

## Writing Rules
${rulesText}

## Coaching Insights
${insightsText}

When the user gives framing/perspective feedback, apply it and briefly explain what changed. If the user's feedback is ambiguous, ask one clarifying question before rewriting.

Return JSON only:
{
  "draft": "the full revised draft",
  "explanation": "1-2 sentences explaining what changed and why"
}`;

    // Build messages array
    const currentDraft = edited_draft ?? gen.final_draft;
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

    // Reconstruct history with proper context — user messages stored with draft context,
    // assistant messages stored as full JSON responses for coherent replay
    for (const msg of history) {
      messages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }

    // Add current message with draft context
    const userContent = `## Current Draft\n${currentDraft}\n\n## Instruction\n${message.trim()}`;
    messages.push({ role: "user", content: userContent });

    const start = Date.now();
    const response = await client.messages.create({
      model: MODELS.SONNET,
      max_tokens: 4000,
      system: systemPrompt,
      messages,
    });

    const duration = Date.now() - start;
    const text = response.content[0].type === "text" ? response.content[0].text : "";

    logger.log({
      step: "chat_revision",
      model: MODELS.SONNET,
      input_messages: JSON.stringify(messages.slice(-1)),
      output_text: text,
      tool_calls: null,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      thinking_tokens: 0,
      duration_ms: duration,
    });

    // Parse response
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    let revisedDraft = currentDraft;
    let explanation = "";

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        revisedDraft = parsed.draft ?? currentDraft;
        explanation = parsed.explanation ?? "";
      } catch {
        // If JSON parse fails, treat entire response as revised draft
        revisedDraft = text.trim();
      }
    } else {
      revisedDraft = text.trim();
    }

    // Run coach-check on revised draft
    const coachResult = await coachCheck(client, logger, revisedDraft, rules, insights);
    const qualityData = {
      expertise_needed: coachResult.expertise_needed,
      alignment: coachResult.alignment,
    };

    // Save messages — store context-enriched content for coherent history replay.
    // User messages include draft context so the LLM sees consistent history.
    // Assistant messages store the full JSON response for replay, with
    // draft_snapshot and quality_json as structured data for the frontend.
    insertGenerationMessage(db, {
      generation_id,
      role: "user",
      content: userContent,
    });
    insertGenerationMessage(db, {
      generation_id,
      role: "assistant",
      content: text, // Full LLM response for history replay
      draft_snapshot: coachResult.draft,
      quality_json: JSON.stringify(qualityData),
    });

    // Update generation
    updateGeneration(db, generation_id, {
      final_draft: coachResult.draft,
      quality_gate_json: JSON.stringify(qualityData),
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
      draft: coachResult.draft,
      quality: qualityData,
      explanation,
    };
  } catch (err: any) {
    failRun(db, runId, err.message);
    return reply.status(500).send({ error: err.message });
  }
});
```

- [ ] **Step 2: Add GET messages endpoint for history restore**

Add a read-only endpoint to load chat history for a generation:

```typescript
// ── Chat history (for restoring from Generation History) ──

app.get("/api/generate/:id/messages", async (request, reply) => {
  const { id } = request.params as { id: string };
  const genId = parseInt(id, 10);
  if (isNaN(genId)) return reply.status(400).send({ error: "Invalid id" });

  const messages = getGenerationMessages(db, genId, 20).reverse();

  // For frontend display, extract just the user instruction (not draft context)
  // and parse assistant explanation from stored JSON response
  return messages.map((msg) => {
    if (msg.role === "user") {
      // Extract instruction from "## Instruction\n..." section
      const instrMatch = msg.content.match(/## Instruction\n([\s\S]+)$/);
      return { ...msg, display_content: instrMatch ? instrMatch[1].trim() : msg.content };
    }
    if (msg.role === "assistant") {
      // Parse explanation from stored JSON response
      let explanation = msg.content;
      try {
        const cleaned = msg.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          explanation = parsed.explanation ?? msg.content;
        }
      } catch { /* use raw content */ }
      return { ...msg, display_content: explanation };
    }
    return { ...msg, display_content: msg.content };
  });
});
```

- [ ] **Step 3: Remove the old revise endpoint**

Delete the entire `app.post("/api/generate/revise", ...)` handler from `generate.ts`.

Remove the `insertRevision` import if no other endpoint uses it.

- [ ] **Step 4: Update route tests**

Replace the revise test with chat test:

```typescript
describe("POST /api/generate/chat", () => {
  it("returns 404 for non-existent generation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/chat",
      payload: { generation_id: 999, message: "make it shorter" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects missing message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/chat",
      payload: { generation_id: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/generate.ts server/src/__tests__/generate-routes.test.ts
git commit -m "feat: add chat endpoint for conversational revision, remove revise endpoint"
```

---

## Chunk 3: Frontend — Discovery View + State Changes

### Task 8: Update GenerationState — remove post type, add discovery fields

**Files:**
- Modify: `dashboard/src/pages/Generate.tsx`
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add new types and API methods to client.ts**

Add discovery types:

```typescript
export interface DiscoveryTopic {
  label: string;
  source_headline: string;
  source_url: string;
}

export interface DiscoveryCategory {
  name: string;
  topics: DiscoveryTopic[];
}

export interface DiscoveryResponse {
  categories: DiscoveryCategory[];
}

// New quality shape from coach-check
export interface GenExpertiseItem {
  area: string;
  question: string;
}

export interface GenAlignmentItem {
  dimension: string;
  summary: string;
}

export interface GenCoachCheckQuality {
  expertise_needed: GenExpertiseItem[];
  alignment: GenAlignmentItem[];
}

export interface GenChatResponse {
  draft: string;
  quality: GenCoachCheckQuality;
  explanation: string;
}

export interface GenChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  display_content: string;
  draft_snapshot?: string;
  quality_json?: string;
}
```

Update `GenCombineResponse`:

```typescript
export interface GenCombineResponse {
  final_draft: string;
  quality: GenCoachCheckQuality;
}
```

Add API methods:

```typescript
generateDiscover: () =>
  fetch(`${BASE_URL}/generate/discover`, { method: "POST" }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json() as Promise<DiscoveryResponse>;
  }),

generateChat: (generationId: number, message: string, editedDraft?: string) =>
  fetch(`${BASE_URL}/generate/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generation_id: generationId, message, edited_draft: editedDraft }),
  }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json() as Promise<GenChatResponse>;
  }),

generateChatHistory: (generationId: number) =>
  fetch(`${BASE_URL}/generate/${generationId}/messages`).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json() as Promise<GenChatMessage[]>;
  }),
```

Update `generateResearch` — remove `postType` param:

```typescript
generateResearch: (topic: string, avoid?: string[]) =>
  fetch(`${BASE_URL}/generate/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic,
      ...(avoid && avoid.length > 0 && { avoid }),
    }),
  }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json() as Promise<GenResearchResponse>;
  }),
```

Update `generateDrafts` — remove `postType` param:

```typescript
generateDrafts: (researchId: number, storyIndex: number, personalConnection?: string) =>
  fetch(`${BASE_URL}/generate/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      research_id: researchId,
      story_index: storyIndex,
      personal_connection: personalConnection,
    }),
  }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json() as Promise<GenDraftsResponse>;
  }),
```

Remove `generateRevise` method.

- [ ] **Step 2: Update Generate.tsx — remove PostType, TypeCache, add discovery state**

Remove `PostType` type export, `TypeCache` interface export.

Update `GenerationState`:

```typescript
interface GenerationState {
  // Discovery
  discoveryTopics: DiscoveryCategory[] | null;
  selectedTopic: string | null;
  // Research
  researchId: number | null;
  stories: GenStory[];
  articleCount: number;
  sourceCount: number;
  selectedStoryIndex: number | null;
  // Generation
  generationId: number | null;
  drafts: GenDraft[];
  selectedDraftIndices: number[];
  combiningGuidance: string;
  personalConnection: string;
  // Review
  finalDraft: string;
  qualityGate: GenCoachCheckQuality | null;
  appliedInsights: GenCoachingInsight[];
  // Chat
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>;
}
```

Update `initialState`:

```typescript
const initialState: GenerationState = {
  discoveryTopics: null,
  selectedTopic: null,
  researchId: null,
  stories: [],
  articleCount: 0,
  sourceCount: 0,
  selectedStoryIndex: null,
  generationId: null,
  drafts: [],
  selectedDraftIndices: [],
  combiningGuidance: "",
  personalConnection: "",
  finalDraft: "",
  qualityGate: null,
  appliedInsights: [],
  chatMessages: [],
};
```

Update the history restore handler to not use PostType/TypeCache. Also load chat messages from the API if a generation exists:

```typescript
// Load chat messages for this generation
let chatMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
if (data.id && data.final_draft) {
  try {
    const msgs = await api.generateChatHistory(data.id);
    chatMessages = msgs.map((m: any) => ({ role: m.role, content: m.display_content ?? m.content }));
  } catch {
    // Chat history is non-critical — proceed without it
  }
}

setGen({
  ...initialState,
  researchId: data.research_id,
  stories: data.stories ?? [],
  articleCount: data.article_count ?? 0,
  sourceCount: data.source_count ?? 0,
  selectedStoryIndex: data.selected_story_index,
  generationId: data.id,
  drafts,
  selectedDraftIndices: selectedIndices,
  combiningGuidance: data.combining_guidance ?? "",
  finalDraft: data.final_draft ?? "",
  qualityGate: qualityGate,
  personalConnection: data.personal_connection ?? "",
  chatMessages,
});
```

**Note:** This requires a `generateChatHistory` method in client.ts (see Task 8 step 1) and a corresponding server endpoint `GET /api/generate/:id/messages` (see Task 7).

Import `DiscoveryCategory` and `GenCoachCheckQuality` from client.

Clear discovery cache when switching away from Generate tab so returning triggers a fresh discover call (per spec: "navigating away from the Generate tab and back triggers a fresh discover call"):

```typescript
// In the SubTabBar onChange handler:
<SubTabBar active={subTab} onChange={(tab) => {
  setSubTab(tab);
  if (tab !== "Generate") {
    setGen((prev) => ({ ...prev, discoveryTopics: null }));
  }
}} />
```

Update the step 1 component from `StorySelection` to `DiscoveryView`:

```typescript
{subTab === "Generate" && step === 1 && (
  <DiscoveryView
    gen={gen}
    setGen={setGen}
    loading={loading}
    setLoading={setLoading}
    onNext={() => setStep(2)}
  />
)}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/api/client.ts dashboard/src/pages/Generate.tsx
git commit -m "feat: update GenerationState — remove post type, add discovery and chat fields"
```

---

### Task 9: DiscoveryView component

**Files:**
- Create: `dashboard/src/pages/generate/DiscoveryView.tsx`
- Delete content from: `dashboard/src/pages/generate/StorySelection.tsx` (will be removed)

- [ ] **Step 1: Create DiscoveryView component**

Create `dashboard/src/pages/generate/DiscoveryView.tsx`:

```typescript
import { useState, useEffect, useRef } from "react";
import { api, type GenStory, type DiscoveryCategory } from "../../api/client";
import StoryCard from "./components/StoryCard";

interface DiscoveryViewProps {
  gen: {
    discoveryTopics: DiscoveryCategory[] | null;
    selectedTopic: string | null;
    stories: GenStory[];
    articleCount: number;
    sourceCount: number;
    researchId: number | null;
    selectedStoryIndex: number | null;
    personalConnection: string;
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onNext: () => void;
}

const DISCOVERY_MESSAGES = [
  "Scanning news feeds...",
  "Clustering topics...",
  "Finding interesting angles...",
];

const RESEARCH_MESSAGES = [
  "Researching your topic...",
  "Finding multiple perspectives...",
  "Preparing your stories...",
];

export default function DiscoveryView({ gen, setGen, loading, setLoading, onNext }: DiscoveryViewProps) {
  const [topicInput, setTopicInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [isDiscovering, setIsDiscovering] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startLoadingMessages = (messages: string[]) => {
    let idx = 0;
    setLoadingMessage(messages[0]);
    loadingTimerRef.current = setInterval(() => {
      idx += 1;
      if (idx < messages.length) {
        setLoadingMessage(messages[idx]);
      } else if (loadingTimerRef.current) {
        clearInterval(loadingTimerRef.current);
      }
    }, 3000);
  };

  const stopLoadingMessages = () => {
    if (loadingTimerRef.current) {
      clearInterval(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
    setLoadingMessage("");
  };

  useEffect(() => {
    return () => stopLoadingMessages();
  }, []);

  // Auto-discover on mount if no topics cached
  useEffect(() => {
    if (!gen.discoveryTopics && !gen.stories.length && !loading) {
      handleDiscover();
    }
  }, []);

  const handleDiscover = async () => {
    setIsDiscovering(true);
    setLoading(true);
    setError(null);
    startLoadingMessages(DISCOVERY_MESSAGES);

    try {
      const res = await api.generateDiscover();
      setGen((prev: any) => ({
        ...prev,
        discoveryTopics: res.categories,
        stories: [],
        researchId: null,
        selectedStoryIndex: null,
        selectedTopic: null,
      }));
    } catch (err: any) {
      setError(err.message ?? "Couldn't load topics. Try again.");
    } finally {
      setLoading(false);
      setIsDiscovering(false);
      stopLoadingMessages();
    }
  };

  const handleTopicClick = async (label: string) => {
    setLoading(true);
    setError(null);
    startLoadingMessages(RESEARCH_MESSAGES);
    setGen((prev: any) => ({ ...prev, selectedTopic: label }));

    const avoid = gen.stories.map((s) => s.headline).filter(Boolean);

    try {
      const res = await api.generateResearch(label, avoid.length > 0 ? avoid : undefined);
      setGen((prev: any) => ({
        ...prev,
        researchId: res.research_id,
        stories: res.stories,
        articleCount: res.article_count,
        sourceCount: res.source_count,
        selectedStoryIndex: null,
      }));
    } catch (err: any) {
      setError(err.message ?? "Research failed. Try again.");
    } finally {
      setLoading(false);
      stopLoadingMessages();
    }
  };

  const handleGoTopic = () => {
    const trimmed = topicInput.trim();
    if (!trimmed) return;
    handleTopicClick(trimmed);
  };

  const handleBackToTopics = () => {
    setGen((prev: any) => ({
      ...prev,
      stories: [],
      researchId: null,
      selectedStoryIndex: null,
      selectedTopic: null,
    }));
  };

  const handleGenerateDrafts = async () => {
    if (gen.selectedStoryIndex === null || gen.researchId === null) return;
    setLoading(true);
    try {
      const res = await api.generateDrafts(gen.researchId, gen.selectedStoryIndex, gen.personalConnection || undefined);
      setGen((prev: any) => ({
        ...prev,
        generationId: res.generation_id,
        drafts: res.drafts,
        selectedDraftIndices: [],
      }));
      onNext();
    } catch (err: any) {
      setError(err.message ?? "Draft generation failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const hasStories = gen.stories.length > 0;
  const hasBubbles = gen.discoveryTopics && gen.discoveryTopics.length > 0;

  return (
    <div>
      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[13px] text-red-400">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !hasStories && (
        <div className="flex items-center justify-center py-20 text-gen-text-3 text-[14px]">
          <svg className="animate-spin h-4 w-4 mr-2 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
          {loadingMessage || "Loading..."}
        </div>
      )}

      {/* Discovery bubbles view */}
      {!loading && !hasStories && (
        <div>
          {/* Topic input */}
          <div className="flex gap-2 mb-8">
            <input
              type="text"
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleGoTopic(); }}
              placeholder="I want to write about..."
              className="flex-1 bg-gen-bg-1 border border-gen-border-1 rounded-[10px] px-4 py-3 text-[14px] text-gen-text-0 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent"
            />
            <button
              onClick={handleGoTopic}
              disabled={!topicInput.trim()}
              className="px-6 py-3 bg-gen-accent text-white text-[14px] font-medium rounded-[10px] hover:bg-gen-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Go
            </button>
          </div>

          {hasBubbles && (
            <>
              {/* Divider */}
              <div className="flex items-center gap-4 mb-8">
                <div className="flex-1 h-px bg-gen-border-1" />
                <span className="text-[11px] uppercase tracking-[1.6px] text-gen-text-4">or explore trending topics</span>
                <div className="flex-1 h-px bg-gen-border-1" />
              </div>

              {/* Categories with bubbles */}
              {gen.discoveryTopics!.map((category, catIdx) => (
                <div
                  key={category.name}
                  className="mb-8"
                  style={{ animation: `fadeInUp 0.5s ease both`, animationDelay: `${catIdx * 0.08}s` }}
                >
                  <div className="flex items-center gap-3 my-3.5 pl-1">
                    <span className="text-[22px] font-extralight text-gen-text-2 whitespace-nowrap">
                      {category.name}
                    </span>
                    <div className="flex-1 h-px bg-gen-border-1" />
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {category.topics.map((topic) => (
                      <button
                        key={topic.label}
                        onClick={() => handleTopicClick(topic.label)}
                        className="bg-gen-bg-1 border border-gen-border-1 rounded-full px-4 py-2 text-[13.5px] text-gen-text-2 hover:bg-gen-bg-2 hover:border-gen-accent hover:text-gen-text-0 hover:-translate-y-px transition-all cursor-pointer"
                      >
                        {topic.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <p className="text-center text-[12px] text-gen-text-4 mt-6">
                ~{gen.discoveryTopics!.reduce((sum, c) => sum + c.topics.length, 0)} topics from your RSS feeds · refreshed each session
              </p>
            </>
          )}

          {/* If no bubbles and not loading, show retry */}
          {!hasBubbles && !loading && (
            <div className="text-center py-10">
              <button
                onClick={handleDiscover}
                className="px-5 py-2.5 border border-gen-border-1 rounded-[10px] text-[13px] text-gen-text-2 hover:text-gen-text-0 hover:border-gen-border-2 transition-colors"
              >
                Load trending topics
              </button>
            </div>
          )}
        </div>
      )}

      {/* Story cards — shown after clicking a bubble or entering a topic */}
      {!loading && hasStories && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-medium text-gen-text-0">
              Pick a story to write about
            </h2>
            <button
              onClick={handleBackToTopics}
              className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors"
            >
              Back to topics
            </button>
          </div>

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

          {/* Personal connection */}
          {gen.selectedStoryIndex !== null && (
            <div className="mt-4 p-4 bg-gen-bg-1 border border-gen-border-1 rounded-xl space-y-2">
              <h3 className="text-[14px] font-medium text-gen-text-0">
                What's your personal connection to this?
              </h3>
              <p className="text-[12px] text-gen-text-3">
                Optional — helps the AI ground the draft in your real experience.
              </p>
              <textarea
                value={gen.personalConnection}
                onChange={(e) => setGen((prev: any) => ({ ...prev, personalConnection: e.target.value }))}
                rows={3}
                placeholder='e.g. "We migrated off Heroku to AWS and it took 6 months longer than estimated..."'
                className="w-full bg-gen-bg-0 border border-gen-border-1 rounded-lg px-3 py-2 text-[13px] text-gen-text-0 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent resize-none"
              />
            </div>
          )}

          {/* Bottom bar */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
            <span className="text-[12px] text-gen-text-3">
              {gen.articleCount} articles from {gen.sourceCount} sources
            </span>
            <button
              onClick={handleGenerateDrafts}
              disabled={gen.selectedStoryIndex === null || loading}
              className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Generate drafts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the fadeInUp keyframe to tailwind config or as inline style**

Check if the `fadeInUp` animation exists in the tailwind config. If not, add it as a `<style>` tag at the top of the component or use inline keyframes. Given the existing codebase uses `animate-fade-up-draft`, add a similar animation. The simplest approach: use inline style with `@keyframes` in a `<style>` tag within the component return, or define it in the global CSS. Since other components use custom animations, add to the existing tailwind config:

Check `dashboard/tailwind.config.js` for existing animation definitions and add `fadeInUp` if needed.

- [ ] **Step 3: Update Generate.tsx to import DiscoveryView instead of StorySelection**

```typescript
// Remove: import StorySelection from "./generate/StorySelection";
import DiscoveryView from "./generate/DiscoveryView";
```

- [ ] **Step 4: Build dashboard and verify no compile errors**

Run: `cd /Users/nate/code/linkedin && pnpm build:dashboard`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/generate/DiscoveryView.tsx dashboard/src/pages/Generate.tsx
git commit -m "feat: add DiscoveryView component with topic bubbles"
```

---

### Task 10: Remove personal connection from DraftVariations (already in DiscoveryView)

Personal connection textarea already lives in DiscoveryView (shown when a story is selected, before "Generate drafts"). DraftVariations does NOT need it. This task verifies DraftVariations has no `personalConnection` reference and removes the old `postType` prop if present.

**Files:**
- Modify: `dashboard/src/pages/generate/DraftVariations.tsx`

- [ ] **Step 1: Remove post type references from DraftVariations**

Remove any `postType` or `post_type` references from the component's props interface and JSX. The component should only need: `generationId`, `drafts`, `selectedDraftIndices`, `combiningGuidance`.

- [ ] **Step 2: Build and verify**

Run: `cd /Users/nate/code/linkedin && pnpm build:dashboard`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/generate/DraftVariations.tsx
git commit -m "refactor: remove post type references from DraftVariations"
```

---

## Chunk 4: Frontend — ReviewEdit Rewrite + Cleanup

### Task 11: Rewrite ReviewEdit with chat panel + new quality sections

**Files:**
- Modify: `dashboard/src/pages/generate/ReviewEdit.tsx`
- Create: `dashboard/src/pages/generate/components/ExpertiseCard.tsx`
- Create: `dashboard/src/pages/generate/components/AlignmentCard.tsx`
- Delete: `dashboard/src/pages/generate/components/QualityGateCard.tsx` (replaced)

- [ ] **Step 1: Create ExpertiseCard component**

Create `dashboard/src/pages/generate/components/ExpertiseCard.tsx`:

```typescript
import type { GenExpertiseItem } from "../../../api/client";

interface ExpertiseCardProps {
  items: GenExpertiseItem[];
  onClickItem: (question: string) => void;
}

export default function ExpertiseCard({ items, onClickItem }: ExpertiseCardProps) {
  if (items.length === 0) return null;

  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
      <h4 className="text-[13px] font-semibold text-gen-text-0 mb-3">
        Needs your expertise
      </h4>
      <div className="space-y-2">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => onClickItem(item.question)}
            className="w-full text-left p-3 bg-gen-bg-3 border border-gen-border-1 rounded-lg hover:border-gen-accent-border transition-colors group"
          >
            <p className="text-[12px] font-medium text-gen-accent mb-1">{item.area}</p>
            <p className="text-[12px] text-gen-text-2 leading-snug group-hover:text-gen-text-1 transition-colors">
              {item.question}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create AlignmentCard component**

Create `dashboard/src/pages/generate/components/AlignmentCard.tsx`:

```typescript
import type { GenAlignmentItem } from "../../../api/client";

interface AlignmentCardProps {
  items: GenAlignmentItem[];
}

export default function AlignmentCard({ items }: AlignmentCardProps) {
  if (items.length === 0) return null;

  const dimensionLabels: Record<string, string> = {
    voice_match: "Voice match",
    ai_tropes: "AI tropes",
    hook_strength: "Hook strength",
    engagement_close: "Engagement close",
    concrete_specifics: "Concrete specifics",
    ending_quality: "Ending quality",
  };

  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
      <h4 className="text-[13px] font-semibold text-gen-text-0 mb-3">
        Alignment
      </h4>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <svg className="mt-0.5 flex-shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="#34d399" strokeWidth="1.5" />
              <path d="M4.5 7l1.5 1.5 3-3" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <p className="text-[12px] text-gen-text-1 font-medium">
                {dimensionLabels[item.dimension] ?? item.dimension}
              </p>
              <p className="text-[11px] text-gen-text-3 leading-snug">{item.summary}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite ReviewEdit with chat panel**

Rewrite `dashboard/src/pages/generate/ReviewEdit.tsx`:

```typescript
import { useState, useRef, useEffect } from "react";
import { api, type GenDraft, type GenCoachCheckQuality, type GenStory } from "../../api/client";
import ExpertiseCard from "./components/ExpertiseCard";
import AlignmentCard from "./components/AlignmentCard";
import PostDetailsCard from "./components/PostDetailsCard";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ReviewEditProps {
  gen: {
    generationId: number | null;
    finalDraft: string;
    qualityGate: GenCoachCheckQuality | null;
    drafts: GenDraft[];
    selectedDraftIndices: number[];
    stories: GenStory[];
    selectedStoryIndex: number | null;
    chatMessages: ChatMessage[];
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onBack: () => void;
  onReset: () => void;
}

export default function ReviewEdit({ gen, setGen, loading, setLoading, onBack, onReset }: ReviewEditProps) {
  const [localDraft, setLocalDraft] = useState(gen.finalDraft);
  const [chatInput, setChatInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setLocalDraft(gen.finalDraft); }, [gen.finalDraft]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [localDraft]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [gen.chatMessages]);

  const sendMessage = async (message: string) => {
    if (!gen.generationId || !message.trim()) return;
    setLoading(true);
    setChatError(null);

    // Add user message optimistically
    setGen((prev: any) => ({
      ...prev,
      chatMessages: [...prev.chatMessages, { role: "user", content: message.trim() }],
    }));

    try {
      const draftChanged = localDraft !== gen.finalDraft ? localDraft : undefined;
      const res = await api.generateChat(gen.generationId, message.trim(), draftChanged);
      setGen((prev: any) => ({
        ...prev,
        finalDraft: res.draft,
        qualityGate: res.quality,
        chatMessages: [...prev.chatMessages, { role: "assistant", content: res.explanation }],
      }));
      setChatInput("");
    } catch (err: any) {
      console.error("Chat failed:", err);
      setChatError(err.message ?? "Revision failed. Try again.");
      // Remove optimistic user message on error
      setGen((prev: any) => ({
        ...prev,
        chatMessages: prev.chatMessages.slice(0, -1),
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(localDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleOpenLinkedIn = async () => {
    await navigator.clipboard.writeText(localDraft);
    window.open("https://www.linkedin.com/feed/?shareActive=true", "_blank");
  };

  const wordCount = localDraft.split(/\s+/).filter(Boolean).length;
  const selectedDraftTypes = gen.selectedDraftIndices.map((i) => gen.drafts[i]?.type).filter(Boolean);
  const storyHeadline = gen.selectedStoryIndex !== null ? gen.stories[gen.selectedStoryIndex]?.headline || "" : "";
  const structureLabel = gen.drafts[gen.selectedDraftIndices[0]]?.structure_label || "";

  const shortcutChips = [
    { label: "Shorten", prompt: "Make this post shorter and punchier. Cut anything that doesn't earn its place. Target 20-30% shorter." },
    { label: "Strengthen close", prompt: "Rewrite just the closing. Make it a sharper question that invites informed disagreement or practitioner reflection." },
    { label: "Regenerate", prompt: "Regenerate this draft from scratch with a different angle and structure, keeping the same core topic and research." },
  ];

  const expertiseItems = gen.qualityGate?.expertise_needed ?? [];
  const alignmentItems = gen.qualityGate?.alignment ?? [];

  return (
    <div>
      <div className="flex gap-6">
        {/* Editor panel */}
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={localDraft}
            onChange={(e) => setLocalDraft(e.target.value)}
            className="w-full bg-transparent text-[15.5px] leading-[1.85] text-gen-text-1 resize-none focus:outline-none min-h-[300px]"
            style={{ fontFamily: "var(--font-sans)" }}
          />
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gen-border-1">
            <span className="text-[12px] text-gen-text-3">{wordCount} words</span>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-[340px] flex-shrink-0 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
          {/* Expertise cards */}
          <ExpertiseCard
            items={expertiseItems}
            onClickItem={(question) => setChatInput(question)}
          />

          {/* Chat thread */}
          {gen.chatMessages.length > 0 && (
            <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
              <h4 className="text-[13px] font-semibold text-gen-text-0 mb-3">Conversation</h4>
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {gen.chatMessages.map((msg, i) => (
                  <div key={i} className={`text-[12px] leading-snug ${msg.role === "user" ? "text-gen-text-1" : "text-gen-text-2 pl-3 border-l-2 border-gen-accent/30"}`}>
                    {msg.content}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            </div>
          )}

          {/* Chat error */}
          {chatError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-400">
              {chatError}
            </div>
          )}

          {/* Chat input */}
          <div className="space-y-2">
            {/* Shortcut chips */}
            <div className="flex gap-1.5">
              {shortcutChips.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => sendMessage(chip.prompt)}
                  disabled={loading}
                  className="px-3 py-1.5 bg-gen-bg-3 border border-gen-border-2 text-gen-text-2 text-[11px] rounded-lg hover:border-gen-border-3 transition-colors disabled:opacity-50"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && chatInput.trim()) sendMessage(chatInput);
                }}
                placeholder="Tell the AI what to change..."
                className="flex-1 bg-gen-bg-2 border border-gen-border-2 rounded-lg px-3 py-2 text-[12px] text-gen-text-1 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent-border"
              />
              <button
                onClick={() => { if (chatInput.trim()) sendMessage(chatInput); }}
                disabled={!chatInput.trim() || loading}
                className="px-3 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[12px] rounded-lg hover:border-gen-border-3 transition-colors disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>

          {/* Alignment */}
          <AlignmentCard items={alignmentItems} />

          {/* Post details */}
          <PostDetailsCard
            storyHeadline={storyHeadline}
            draftsUsed={selectedDraftTypes}
            structureLabel={structureLabel}
            wordCount={wordCount}
          />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-[13px] text-gen-text-2 hover:text-gen-text-0 transition-colors">
            Back to drafts
          </button>
          <button onClick={onReset} className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors">
            Start new
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleCopy} className="px-4 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[13px] font-medium rounded-[10px] hover:border-gen-border-3 transition-colors">
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          <button onClick={handleOpenLinkedIn} className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors">
            Open in LinkedIn
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build and verify**

Run: `cd /Users/nate/code/linkedin && pnpm build:dashboard`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/generate/ReviewEdit.tsx dashboard/src/pages/generate/components/ExpertiseCard.tsx dashboard/src/pages/generate/components/AlignmentCard.tsx
git commit -m "feat: rewrite ReviewEdit with chat panel and coach-check quality sections"
```

---

### Task 12: Remove post type references everywhere

**Files:**
- Modify: `dashboard/src/pages/generate/GenerationHistory.tsx` (remove post_type column)
- Delete: `dashboard/src/pages/generate/StorySelection.tsx`
- Delete: `dashboard/src/pages/generate/components/QualityGateCard.tsx`
- Delete: `dashboard/src/pages/generate/components/GuidanceAppliedCard.tsx`
- Modify: `dashboard/src/api/client.ts` (remove GenReviseResponse, old GenQualityGate)

- [ ] **Step 1: Remove post type column from GenerationHistory**

In `GenerationHistory.tsx`:
- Remove the "Type" column header (`<th>...Type...</th>`)
- Remove the "Type" cell (`<td>...<span>{item.post_type}</span>...</td>`)

- [ ] **Step 2: Clean up client.ts types**

Remove these types that are no longer used:
- `GenReviseResponse`
- `GenQualityCheck` (old shape)
- `GenQualityGate` (old shape — replaced by `GenCoachCheckQuality`)

Remove the `generateRevise` method.

Keep `GenHistoryItem` but note `post_type` field still exists for backward compat with existing DB rows.

- [ ] **Step 3: Delete unused files**

Delete:
- `dashboard/src/pages/generate/StorySelection.tsx`
- `dashboard/src/pages/generate/components/QualityGateCard.tsx`
- `dashboard/src/pages/generate/components/GuidanceAppliedCard.tsx`

- [ ] **Step 4: Remove unused imports from Generate.tsx**

Remove any remaining imports of `PostType`, `TypeCache`, `StorySelection`, `QualityGateCard`, `GuidanceAppliedCard`.

- [ ] **Step 5: Delete quality-gate.ts from server**

Delete `server/src/ai/quality-gate.ts` — fully replaced by `coach-check.ts`.

Remove any remaining `runQualityGate` imports from routes.

- [ ] **Step 6: Build and verify**

Run: `cd /Users/nate/code/linkedin && pnpm build:dashboard`
Expected: Build succeeds

- [ ] **Step 7: Run all tests**

Run: `cd /Users/nate/code/linkedin && npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/pages/generate/GenerationHistory.tsx dashboard/src/api/client.ts dashboard/src/pages/Generate.tsx server/src/ai/quality-gate.ts
git rm dashboard/src/pages/generate/StorySelection.tsx dashboard/src/pages/generate/components/QualityGateCard.tsx dashboard/src/pages/generate/components/GuidanceAppliedCard.tsx
git commit -m "feat: remove post type references, delete unused components and quality-gate module"
```

---

### Task 13: End-to-end verification

**Files:** (no new files — verification only)

- [ ] **Step 1: Rebuild dashboard**

Run: `cd /Users/nate/code/linkedin && pnpm build:dashboard`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/nate/code/linkedin && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd /Users/nate/code/linkedin && npx tsc --noEmit -p server/tsconfig.json`
Expected: No type errors

- [ ] **Step 4: Manual smoke test**

Start the dev server and verify:
1. Generate tab loads and auto-discovers topic bubbles
2. Clicking a bubble triggers research and shows 3 story cards
3. "Back to topics" restores cached bubbles
4. Typing a manual topic works
5. Selecting a story + generating drafts works
6. Personal connection appears in DiscoveryView when a story is selected
7. Combining runs coach-check and shows "Needs your expertise" + "Alignment"
8. Chat input sends messages and receives revisions
9. Generation History restores a generation with chat history intact
10. Switching away from Generate tab and back triggers fresh discovery
9. Shortcut chips (Shorten, Strengthen close) work through chat
10. History table no longer shows post type column
11. Opening a history item restores the generation correctly

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: end-to-end verification and fixes"
```
