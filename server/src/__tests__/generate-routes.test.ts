import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";
import { initDatabase } from "../db/index.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-generate-routes.db");

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp(TEST_DB_PATH);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("GET /api/generate/rules", () => {
  it("returns empty categories when no rules exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/rules" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories).toBeDefined();
    expect(body.categories.voice_tone).toBeDefined();
    expect(body.categories.structure_formatting).toBeDefined();
    expect(body.categories.anti_ai_tropes).toBeDefined();
  });
});

describe("POST /api/generate/rules/reset", () => {
  it("seeds default rules and returns them", async () => {
    const res = await app.inject({ method: "POST", url: "/api/generate/rules/reset" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories.voice_tone.length).toBeGreaterThan(0);
    expect(body.categories.structure_formatting.length).toBeGreaterThan(0);
    expect(body.categories.anti_ai_tropes.rules.length).toBeGreaterThan(0);
  });
});

describe("PUT /api/generate/rules", () => {
  it("replaces all rules", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/generate/rules",
      payload: {
        categories: {
          voice_tone: [{ rule_text: "Be direct", sort_order: 0 }],
          structure_formatting: [{ rule_text: "Short paragraphs", sort_order: 0 }],
          anti_ai_tropes: {
            enabled: true,
            rules: [{ rule_text: "No hedging", sort_order: 0 }],
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);

    // Verify
    const getRes = await app.inject({ method: "GET", url: "/api/generate/rules" });
    const body = getRes.json();
    expect(body.categories.voice_tone).toHaveLength(1);
    expect(body.categories.voice_tone[0].rule_text).toBe("Be direct");
  });
});

describe("GET /api/generate/history", () => {
  it("returns empty list initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/history" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generations).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe("GET /api/generate/history/:id", () => {
  it("returns 404 for non-existent generation", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/history/999" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/generate/history/:id/discard", () => {
  it("returns 404 for non-existent generation", async () => {
    const res = await app.inject({ method: "POST", url: "/api/generate/history/999/discard" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/generate/research", () => {
  it("rejects missing topic", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/research",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // Note: actual research requires TRUSTMIND_LLM_API_KEY, so we only test validation
});

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

describe("POST /api/generate/combine", () => {
  it("returns 404 for non-existent generation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/combine",
      payload: { generation_id: 999, selected_drafts: [0] },
    });
    expect(res.statusCode).toBe(404);
  });
});

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

describe("GET /api/generate/coaching/insights", () => {
  it("returns empty insights initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/coaching/insights" });
    expect(res.statusCode).toBe(200);
    expect(res.json().insights).toEqual([]);
  });
});

describe("GET /api/generate/coaching/history", () => {
  it("returns empty history initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/coaching/history" });
    expect(res.statusCode).toBe(200);
    expect(res.json().syncs).toEqual([]);
  });
});

describe("PATCH /api/generate/coaching/changes/:id", () => {
  it("returns 404 for non-existent change", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/generate/coaching/changes/999",
      payload: { action: "skip" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/generate/active", () => {
  it("returns null when no active generation exists", async () => {
    const res = await app.inject({ method: "GET", url: "/api/generate/active?personaId=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generation).toBeNull();
  });

  it("returns active generation with enriched research data", async () => {
    // Insert research + generation directly via the DB
    const db = initDatabase(TEST_DB_PATH);
    const { insertResearch, insertGeneration } = await import("../db/generate-queries.js");
    const researchId = insertResearch(db, 1, {
      post_type: "general",
      stories_json: JSON.stringify([{ headline: "Test story", summary: "s", source: "src", age: "today", tag: "t", angles: [], is_stretch: false }]),
      article_count: 3,
      source_count: 2,
    });
    insertGeneration(db, 1, {
      research_id: researchId,
      post_type: "general",
      selected_story_index: 0,
      drafts_json: JSON.stringify([{ type: "contrarian", hook: "Hook", body: "Body" }]),
    });

    const res = await app.inject({ method: "GET", url: "/api/generate/active?personaId=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generation).not.toBeNull();
    expect(body.generation.stories).toHaveLength(1);
    expect(body.generation.stories[0].headline).toBe("Test story");
    expect(body.generation.article_count).toBe(3);
    expect(body.generation.source_count).toBe(2);
    expect(body.generation.status).toBe("draft");
  });
});

describe("POST /api/generate/discover", () => {
  it("endpoint is registered and returns error without API key", async () => {
    const res = await app.inject({ method: "POST", url: "/api/generate/discover" });
    expect(res.statusCode).toBe(500);
  });
});
