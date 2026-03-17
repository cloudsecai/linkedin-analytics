import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-insights-routes.db");

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp(TEST_DB_PATH);
  await app.ready();

  // Seed posts with metrics for a realistic scenario
  await app.inject({
    method: "POST",
    url: "/api/ingest",
    payload: {
      posts: Array.from({ length: 15 }, (_, i) => ({
        id: `insight-test-${i}`,
        content_preview: `Test post ${i}`,
        content_type: "text",
        published_at: `2026-03-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      })),
      post_metrics: Array.from({ length: 15 }, (_, i) => ({
        post_id: `insight-test-${i}`,
        impressions: 1000 + i * 100,
        reactions: 50 + i * 5,
        comments: 10 + i,
        reposts: 5,
      })),
    },
  });
});

afterAll(async () => {
  await app.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("GET /api/insights", () => {
  it("returns empty when no analysis has run", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recommendations).toEqual([]);
    expect(body.insights).toEqual([]);
  });
});

describe("GET /api/insights/overview", () => {
  it("returns null overview when no analysis has run", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights/overview" });
    expect(res.statusCode).toBe(200);
    expect(res.json().overview).toBeNull();
  });
});

describe("GET /api/insights/tags", () => {
  it("returns empty tags when nothing tagged", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights/tags" });
    expect(res.statusCode).toBe(200);
    expect(res.json().tags).toEqual({});
  });
});

describe("GET /api/insights/taxonomy", () => {
  it("returns empty taxonomy initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights/taxonomy" });
    expect(res.statusCode).toBe(200);
    expect(res.json().taxonomy).toEqual([]);
  });
});

describe("GET /api/insights/changelog", () => {
  it("returns empty changelog when no analysis has run", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights/changelog" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.confirmed).toEqual([]);
    expect(body.new_signal).toEqual([]);
  });
});

describe("POST /api/insights/refresh", () => {
  it("returns error without API key", async () => {
    // Ensure no API key is set
    const originalKey = process.env.TRUSTMIND_LLM_API_KEY;
    delete process.env.TRUSTMIND_LLM_API_KEY;

    const res = await app.inject({ method: "POST", url: "/api/insights/refresh" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("API key");

    if (originalKey) process.env.TRUSTMIND_LLM_API_KEY = originalKey;
  });
});

describe("PATCH /api/insights/recommendations/:id/feedback", () => {
  it("returns 404 for nonexistent recommendation", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/insights/recommendations/999/feedback",
      payload: { feedback: "useful" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/insights/logs/:runId", () => {
  it("returns empty logs for nonexistent run", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights/logs/999" });
    expect(res.statusCode).toBe(200);
    expect(res.json().logs).toEqual([]);
  });
});
