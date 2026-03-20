import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  getRules,
  replaceAllRules,
  seedDefaultRules,
  getActiveCoachingInsights,
  insertCoachingInsight,
  updateCoachingInsight,
  insertResearch,
  getResearch,
  insertGeneration,
  getGeneration,
  updateGeneration,
  listGenerations,
  insertRevision,
  insertCoachingSync,
  getCoachingSync,
  insertCoachingChangeLog,
  updateCoachingChangeDecision,
  getCoachingChangeLog,
  insertTopicLog,
  getRecentTopics,
  getRecentStoryHeadlines,
  getPostTypeTemplate,
  DEFAULT_RULES,
} from "../db/generate-queries.js";
import { initDatabase } from "../db/index.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-generate-queries.db");

let db: ReturnType<typeof initDatabase>;

beforeAll(() => {
  db = initDatabase(TEST_DB_PATH);
});

afterAll(() => {
  db.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("generation_rules", () => {
  it("seeds default rules", () => {
    seedDefaultRules(db);
    const rules = getRules(db);
    expect(rules.length).toBe(DEFAULT_RULES.length);
    expect(rules[0].category).toBe("anti_ai_tropes");
  });

  it("replaces all rules", () => {
    replaceAllRules(db, [
      { category: "voice_tone", rule_text: "Test rule", sort_order: 0 },
    ]);
    const rules = getRules(db);
    expect(rules.length).toBe(1);
    expect(rules[0].rule_text).toBe("Test rule");
  });
});

describe("coaching_insights", () => {
  it("inserts and retrieves active insights", () => {
    const id = insertCoachingInsight(db, {
      title: "Hook patterns",
      prompt_text: "Use contrarian hooks for higher engagement",
      evidence: "Top 5 posts all use contrarian hooks",
    });
    expect(id).toBeGreaterThan(0);

    const insights = getActiveCoachingInsights(db);
    expect(insights.length).toBe(1);
    expect(insights[0].title).toBe("Hook patterns");
  });

  it("updates insight status", () => {
    const insights = getActiveCoachingInsights(db);
    updateCoachingInsight(db, insights[0].id, { status: "retired", retired_at: new Date().toISOString() });
    const active = getActiveCoachingInsights(db);
    expect(active.length).toBe(0);
  });
});

describe("post_type_templates", () => {
  it("returns seeded templates", () => {
    const tpl = getPostTypeTemplate(db, "news");
    expect(tpl).toBeDefined();
    expect(tpl!.template_text).toContain("news story");
  });

  it("returns undefined for unknown type", () => {
    const tpl = getPostTypeTemplate(db, "nonexistent");
    expect(tpl).toBeUndefined();
  });
});

describe("generation_research", () => {
  it("inserts and retrieves research", () => {
    const id = insertResearch(db, {
      post_type: "news",
      stories_json: JSON.stringify([{ headline: "Test" }]),
      article_count: 5,
      source_count: 2,
    });
    const research = getResearch(db, id);
    expect(research).toBeDefined();
    expect(research!.post_type).toBe("news");
    expect(JSON.parse(research!.stories_json)).toHaveLength(1);
  });
});

describe("generations", () => {
  let genId: number;

  it("inserts a generation", () => {
    const researchId = insertResearch(db, {
      post_type: "topic",
      stories_json: JSON.stringify([]),
    });
    genId = insertGeneration(db, {
      research_id: researchId,
      post_type: "topic",
      selected_story_index: 0,
      drafts_json: JSON.stringify([{ type: "contrarian", hook: "Test" }]),
    });
    expect(genId).toBeGreaterThan(0);
  });

  it("updates generation fields", () => {
    updateGeneration(db, genId, {
      final_draft: "The final post text",
      status: "copied",
    });
    const gen = getGeneration(db, genId);
    expect(gen!.final_draft).toBe("The final post text");
    expect(gen!.status).toBe("copied");
  });

  it("lists generations with pagination", () => {
    const result = listGenerations(db, { limit: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.generations.length).toBeGreaterThan(0);
  });

  it("filters generations by status", () => {
    const result = listGenerations(db, { status: "copied" });
    expect(result.generations.every((g) => g.status === "copied")).toBe(true);
  });
});

describe("generation_revisions", () => {
  it("inserts a revision", () => {
    const researchId = insertResearch(db, { post_type: "news", stories_json: "[]" });
    const genId = insertGeneration(db, {
      research_id: researchId,
      post_type: "news",
      selected_story_index: 0,
      drafts_json: "[]",
    });
    const revId = insertRevision(db, {
      generation_id: genId,
      action: "shorten",
      input_draft: "Long draft",
      output_draft: "Short draft",
    });
    expect(revId).toBeGreaterThan(0);
  });
});

describe("coaching_syncs", () => {
  it("inserts and retrieves a sync", () => {
    const syncId = insertCoachingSync(db, JSON.stringify([{ type: "new" }]));
    const sync = getCoachingSync(db, syncId);
    expect(sync).toBeDefined();
    expect(sync!.status).toBe("pending");
  });
});

describe("coaching_change_log", () => {
  it("inserts changes and updates decisions", () => {
    const syncId = insertCoachingSync(db, "[]");
    const changeId = insertCoachingChangeLog(db, {
      sync_id: syncId,
      change_type: "new",
      new_text: "New insight text",
      evidence: "Data shows X",
    });
    updateCoachingChangeDecision(db, changeId, "accept");
    const changes = getCoachingChangeLog(db, syncId);
    expect(changes.length).toBe(1);
    expect(changes[0].decision).toBe("accept");
  });
});

describe("generation_topic_log", () => {
  it("tracks topic selections", () => {
    const researchId = insertResearch(db, { post_type: "news", stories_json: "[]" });
    const genId = insertGeneration(db, {
      research_id: researchId,
      post_type: "news",
      selected_story_index: 0,
      drafts_json: "[]",
    });
    insertTopicLog(db, { generation_id: genId, topic_category: "AI", was_stretch: false });
    insertTopicLog(db, { generation_id: genId, topic_category: "Finance", was_stretch: true });
    const topics = getRecentTopics(db, 5);
    expect(topics.length).toBe(2);
    expect(topics[0].topic_category).toBe("Finance");
  });
});

describe("getRecentStoryHeadlines", () => {
  it("returns headlines from recent research sessions", () => {
    insertResearch(db, {
      post_type: "news",
      stories_json: JSON.stringify([
        { headline: "Headline Alpha", summary: "s", source: "src", age: "today", tag: "t", angles: [], is_stretch: false },
        { headline: "Headline Beta", summary: "s", source: "src", age: "today", tag: "t", angles: [], is_stretch: false },
      ]),
      article_count: 2,
      source_count: 1,
    });

    const headlines = getRecentStoryHeadlines(db, 30);
    expect(headlines).toContain("Headline Alpha");
    expect(headlines).toContain("Headline Beta");
  });

  it("limits the number of research sessions queried", () => {
    // Get all headlines (limit=30 gets all sessions)
    const allHeadlines = getRecentStoryHeadlines(db, 30);
    // Get only from the most recent session (limit=1)
    const oneSession = getRecentStoryHeadlines(db, 1);
    // The limited query should return fewer headlines
    expect(oneSession.length).toBeLessThan(allHeadlines.length);
    expect(oneSession.length).toBeGreaterThan(0);
  });
});
