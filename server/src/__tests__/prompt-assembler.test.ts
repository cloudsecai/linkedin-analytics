import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { initDatabase } from "../db/index.js";
import { assemblePrompt } from "../ai/prompt-assembler.js";
import {
  seedDefaultRules,
  insertCoachingInsight,
} from "../db/generate-queries.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-prompt-assembler.db");

let db: ReturnType<typeof initDatabase>;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
  seedDefaultRules(db);
});

afterAll(() => {
  db.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("assemblePrompt", () => {
  it("includes writing rules and story context", () => {
    const result = assemblePrompt(db, "Breaking: AI costs drop 90%");
    expect(result.system).toContain("Writing Rules");
    expect(result.system).toContain("Story Context");
    expect(result.system).toContain("AI costs drop 90%");
    expect(result.token_count).toBeGreaterThan(0);
    expect(result.layers.rules).toBeGreaterThan(0);
    expect(result.layers.post_type).toBe(0);
  });

  it("includes coaching insights when present", () => {
    insertCoachingInsight(db, {
      title: "Contrarian hooks",
      prompt_text: "Lead with a take that challenges conventional wisdom",
    });
    const result = assemblePrompt(db, "");
    expect(result.system).toContain("Coaching Insights");
    expect(result.system).toContain("Contrarian hooks");
    expect(result.layers.coaching).toBeGreaterThan(0);
  });

  it("respects token budget by trimming coaching insights", () => {
    // Add many coaching insights to push over budget
    for (let i = 0; i < 20; i++) {
      insertCoachingInsight(db, {
        title: `Insight ${i}`,
        prompt_text: "A".repeat(200), // ~50 tokens each
      });
    }
    const result = assemblePrompt(db, "story");
    expect(result.token_count).toBeLessThanOrEqual(2200); // allow some flex for structure
  });

  it("returns empty coaching when no insights exist", () => {
    // Use a fresh DB for isolation
    const freshPath = path.join(import.meta.dirname, "../../data/test-prompt-assembler-fresh.db");
    const freshDb = initDatabase(freshPath);
    seedDefaultRules(freshDb);

    const result = assemblePrompt(freshDb, "My story");
    expect(result.system).not.toContain("Coaching Insights");
    expect(result.layers.coaching).toBe(0);

    freshDb.close();
    try { fs.unlinkSync(freshPath); fs.unlinkSync(freshPath + "-wal"); fs.unlinkSync(freshPath + "-shm"); } catch {}
  });

  it("does not include post type section", () => {
    const result = assemblePrompt(db, "context");
    expect(result.system).not.toContain("Post Type:");
    expect(result.layers.post_type).toBe(0);
  });
});
