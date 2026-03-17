import { describe, it, expect, beforeAll, afterAll } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
  median,
  iqr,
  cliffsDelta,
  computeER,
  getPostPreview,
  getLocalHour,
  getLocalDayName,
  pct,
  buildStatsReport,
} from "../ai/stats-report.js";
import { initDatabase } from "../db/index.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-stats-report.db");

describe("median", () => {
  it("returns null for empty array", () => expect(median([])).toBeNull());
  it("single element", () => expect(median([5])).toBe(5));
  it("even length — average of two middle values", () => expect(median([1, 3])).toBe(2));
  it("odd length — returns middle", () => expect(median([1, 2, 9])).toBe(2));
  it("unsorted input", () => expect(median([9, 1, 5])).toBe(5));
});

describe("iqr", () => {
  it("returns null for fewer than 4 values", () => {
    expect(iqr([1, 2, 3])).toBeNull();
  });
  it("returns a positive number for [1,2,3,4]", () => {
    const result = iqr([1, 2, 3, 4]);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });
});

describe("cliffsDelta", () => {
  it("d=0 and negligible for identical arrays", () => {
    const r = cliffsDelta([1, 2, 3], [1, 2, 3]);
    expect(r.d).toBe(0);
    expect(r.label).toBe("negligible");
  });
  it("d=1 and large when all x > all y", () => {
    const r = cliffsDelta([10, 11, 12], [1, 2, 3]);
    expect(r.d).toBe(1);
    expect(r.label).toBe("large");
  });
  it("d=-1 and large when all x < all y", () => {
    const r = cliffsDelta([1, 2, 3], [10, 11, 12]);
    expect(r.d).toBe(-1);
    expect(r.label).toBe("large");
  });
  it("negligible for |d| < 0.147", () => {
    const r = cliffsDelta([1, 2, 3, 4, 5], [1, 2, 3, 4, 6]);
    expect(r.label).toBe("negligible");
  });
  it("returns negligible for empty arrays", () => {
    const r = cliffsDelta([], [1, 2, 3]);
    expect(r.label).toBe("negligible");
  });
});

describe("computeER", () => {
  it("returns null when impressions is 0", () => {
    expect(computeER(10, 5, 3, 0)).toBeNull();
  });
  it("computes (reactions+comments+reposts)/impressions*100", () => {
    expect(computeER(10, 5, 5, 1000)).toBeCloseTo(2.0);
  });
  it("rounds correctly for 28 reactions, 5 comments, 2 reposts, 1000 impressions", () => {
    expect(computeER(28, 5, 2, 1000)).toBeCloseTo(3.5);
  });
});

describe("getPostPreview", () => {
  it("prefers hook_text over full_text", () => {
    expect(
      getPostPreview({ hook_text: "Hook text", full_text: "Full text", content_preview: "Preview" })
    ).toBe("Hook text");
  });
  it("falls back to full_text, truncated at 80 chars", () => {
    const longText = "a".repeat(100);
    const result = getPostPreview({ hook_text: null, full_text: longText, content_preview: null });
    expect(result).toBe("a".repeat(77) + "...");
  });
  it("falls back to content_preview", () => {
    expect(
      getPostPreview({ hook_text: null, full_text: null, content_preview: "Preview text" })
    ).toBe("Preview text");
  });
  it("returns 'Untitled post' when all null", () => {
    expect(getPostPreview({ hook_text: null, full_text: null, content_preview: null })).toBe(
      "Untitled post"
    );
  });
});

describe("getLocalHour", () => {
  it("converts 14:00 UTC to 9 in America/New_York (UTC-5 in January)", () => {
    const hour = getLocalHour("2026-01-15T14:00:00Z", "America/New_York");
    expect(hour).toBe(9);
  });
  it("converts 14:00 UTC to 14 in UTC", () => {
    expect(getLocalHour("2026-01-15T14:00:00Z", "UTC")).toBe(14);
  });
});

describe("getLocalDayName", () => {
  it("returns Thursday for 2026-01-15", () => {
    const day = getLocalDayName("2026-01-15T12:00:00Z", "UTC");
    expect(day).toBe("Thursday");
  });
});

describe("pct", () => {
  it("formats 2.3456 as '2.3%'", () => expect(pct(2.3456)).toBe("2.3%"));
  it("formats 0 as '0.0%'", () => expect(pct(0)).toBe("0.0%"));
});

describe("buildStatsReport", () => {
  let db: BetterSqlite3.Database;

  beforeAll(() => {
    db = initDatabase(TEST_DB_PATH);

    // Seed: 3 posts with known metrics
    db.prepare(
      `INSERT OR IGNORE INTO posts (id, content_type, published_at, hook_text) VALUES (?, ?, ?, ?)`
    ).run("sr-post-1", "text", "2026-01-15T15:00:00Z", "My post about startup funding rounds");
    db.prepare(
      `INSERT OR IGNORE INTO posts (id, content_type, published_at, hook_text) VALUES (?, ?, ?, ?)`
    ).run("sr-post-2", "image", "2026-01-20T14:00:00Z", "Why due diligence matters");
    db.prepare(
      `INSERT OR IGNORE INTO posts (id, content_type, published_at, hook_text) VALUES (?, ?, ?, ?)`
    ).run("sr-post-3", "text", "2026-01-25T10:00:00Z", "Three lessons from failed fundraising");

    // Metrics: reactions+comments+reposts / impressions
    // post-1: (20+5+3)/1000 = 2.8%
    db.prepare(
      `INSERT OR IGNORE INTO post_metrics (post_id, impressions, reactions, comments, reposts, saves, sends)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("sr-post-1", 1000, 20, 5, 3, 2, 1);
    // post-2: (40+10+5)/2000 = 2.75%
    db.prepare(
      `INSERT OR IGNORE INTO post_metrics (post_id, impressions, reactions, comments, reposts, saves, sends)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("sr-post-2", 2000, 40, 10, 5, 3, 2);
    // post-3: (10+2+1)/500 = 2.6%
    db.prepare(
      `INSERT OR IGNORE INTO post_metrics (post_id, impressions, reactions, comments, reposts, saves, sends)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("sr-post-3", 500, 10, 2, 1, 0, 0);
  });

  afterAll(() => {
    db.close();
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    try { fs.unlinkSync(TEST_DB_PATH + "-wal"); } catch {}
    try { fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch {}
  });

  it("returns a non-empty string", () => {
    const report = buildStatsReport(db, "America/New_York", null);
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(100);
  });

  it("contains Overview section with post count", () => {
    const report = buildStatsReport(db, "America/New_York", null);
    expect(report).toContain("## 1. Overview");
    expect(report).toContain("3 posts");
  });

  it("uses standard ER formula — shows 2.8% for post-1", () => {
    const report = buildStatsReport(db, "America/New_York", null);
    expect(report).toContain("2.8%");
  });

  it("references posts by content, never by ID", () => {
    const report = buildStatsReport(db, "America/New_York", null);
    expect(report).not.toContain("sr-post-");
    expect(report).toContain("startup funding");
  });

  it("includes top 10 posts section", () => {
    const report = buildStatsReport(db, "America/New_York", null);
    expect(report).toContain("## 4. Top");
  });

  it("includes day-of-week section", () => {
    const report = buildStatsReport(db, "America/New_York", null);
    expect(report).toContain("## 6. Day-of-Week");
  });

  it("includes writing prompt when provided", () => {
    const report = buildStatsReport(db, "America/New_York", "Always start with a question hook");
    expect(report).toContain("Always start with a question hook");
    expect(report).toContain("## 12. Author");
  });

  it("omits writing prompt section when null", () => {
    const report = buildStatsReport(db, "America/New_York", null);
    expect(report).toContain("## 12. Author");
    expect(report).toContain("(none set");
  });
});
