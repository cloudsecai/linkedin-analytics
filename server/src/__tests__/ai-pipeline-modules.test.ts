import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import { initDatabase } from "../db/index.js";
import { AiLogger } from "../ai/logger.js";
import { researchStories } from "../ai/researcher.js";
import { generateDrafts } from "../ai/drafter.js";
import { combineDrafts } from "../ai/combiner.js";

import { analyzeCoaching } from "../ai/coaching-analyzer.js";

// Mock searchWithSonarPro to avoid needing TRUSTMIND_LLM_API_KEY
vi.mock("../ai/perplexity.js", () => ({
  searchWithSonarPro: vi.fn().mockResolvedValue({
    text: "AI costs have dropped significantly. Companies are seeing 90% reductions.",
    citations: ["https://example.com/ai-costs", "https://example.com/cloud-pricing"],
  }),
}));
import {
  seedDefaultRules,
  getRules,
  getActiveCoachingInsights,
  type Story,
  type Draft,
} from "../db/generate-queries.js";
import { createRun } from "../db/ai-queries.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-ai-modules.db");

let db: ReturnType<typeof initDatabase>;
let logger: AiLogger;

function makeMockClient(responseText: string): any {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    },
  };
}

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
  seedDefaultRules(db);
  const runId = createRun(db, "test", 0);
  logger = new AiLogger(db, runId);
});

afterAll(() => {
  db.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("researcher", () => {
  it("returns 3 stories from LLM response", async () => {
    const mockResponse = JSON.stringify({
      stories: [
        { headline: "AI Costs Plummet", summary: "Cloud AI pricing dropped 90%", source: "Industry", age: "This week", tag: "AI", angles: ["Cost angle"], is_stretch: false },
        { headline: "Remote Work Shift", summary: "Companies reversing RTO", source: "News", age: "Today", tag: "Work", angles: ["Culture angle"], is_stretch: false },
        { headline: "Biotech Breakthrough", summary: "New CRISPR technique", source: "Science", age: "This month", tag: "Biotech", angles: ["Future angle"], is_stretch: true },
      ],
    });
    const client = makeMockClient(mockResponse);
    const result = await researchStories(client, db, logger, "AI costs dropping");
    expect(result.stories).toHaveLength(3);
    expect(result.stories[2].is_stretch).toBe(true);
    expect(client.messages.create).toHaveBeenCalledOnce();
  });
});

describe("drafter", () => {
  it("generates 3 draft variations", async () => {
    const mockDraft = JSON.stringify({
      hook: "Everyone thinks AI is expensive. They're wrong.",
      body: "Here's what actually happened...",
      closing: "What's the most surprising cost reduction you've seen?",
      word_count: 280,
      structure_label: "Contrarian take with evidence",
    });
    const client = makeMockClient(mockDraft);
    const story: Story = {
      headline: "AI Costs Plummet",
      summary: "Cloud pricing dropped 90%",
      source: "Industry",
      age: "This week",
      tag: "AI",
      angles: ["Cost reduction angle"],
      is_stretch: false,
    };
    const result = await generateDrafts(client, db, logger, story);
    expect(result.drafts).toHaveLength(3);
    expect(result.drafts[0].type).toBe("contrarian");
    expect(result.drafts[1].type).toBe("operator");
    expect(result.drafts[2].type).toBe("future");
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });
});

describe("combiner", () => {
  const drafts: Draft[] = [
    { type: "contrarian", hook: "Hook A", body: "Body A", closing: "Close A", word_count: 200, structure_label: "Contrarian" },
    { type: "operator", hook: "Hook B", body: "Body B", closing: "Close B", word_count: 250, structure_label: "Operator" },
    { type: "future", hook: "Hook C", body: "Body C", closing: "Close C", word_count: 220, structure_label: "Future" },
  ];

  it("returns single draft as-is without LLM call", async () => {
    const client = makeMockClient("");
    const result = await combineDrafts(client, logger, drafts, [0]);
    expect(result.final_draft).toContain("Hook A");
    expect(result.final_draft).toContain("Body A");
    expect(result.input_tokens).toBe(0);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("combines multiple drafts via LLM", async () => {
    const client = makeMockClient("Combined post text here with best elements from both drafts.");
    const result = await combineDrafts(client, logger, drafts, [0, 2], "Focus on the contrarian hook");
    expect(result.final_draft).toContain("Combined post");
    expect(result.input_tokens).toBe(100);
    expect(client.messages.create).toHaveBeenCalledOnce();
  });
});


describe("coaching-analyzer", () => {
  it("returns coaching change proposals", async () => {
    const mockResponse = JSON.stringify({
      changes: [
        {
          type: "new",
          title: "Use numbers early",
          evidence: "Top posts all include a number in the first sentence",
          new_text: "Include a specific number or metric in the opening hook",
        },
      ],
    });
    const client = makeMockClient(mockResponse);
    const result = await analyzeCoaching(client, db, logger);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].type).toBe("new");
    expect(result.changes[0].title).toBe("Use numbers early");
  });

  it("returns empty changes when nothing to improve", async () => {
    const client = makeMockClient(JSON.stringify({ changes: [] }));
    const result = await analyzeCoaching(client, db, logger);
    expect(result.changes).toHaveLength(0);
  });
});
