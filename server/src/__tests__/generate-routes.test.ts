import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";

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
  it("rejects invalid post_type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/research",
      payload: { post_type: "invalid" },
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
      payload: { research_id: 999, story_index: 0, post_type: "news" },
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

describe("POST /api/generate/revise", () => {
  it("returns 404 for non-existent generation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/revise",
      payload: { generation_id: 999, action: "shorten" },
    });
    expect(res.statusCode).toBe(404);
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
