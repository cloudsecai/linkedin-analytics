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
  insertGenerationMessage,
  getGenerationMessages,
  getActiveGeneration,
} from "../db/generate-queries.js";
import { initDatabase } from "../db/index.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-generate-queries.db");
const PERSONA_ID = 1;

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
    seedDefaultRules(db, PERSONA_ID);
    const rules = getRules(db, PERSONA_ID);
    expect(rules.length).toBe(DEFAULT_RULES.length);
    expect(rules[0].category).toBe("anti_ai_tropes");
  });

  it("replaces all rules", () => {
    replaceAllRules(db, PERSONA_ID, [
      { category: "voice_tone", rule_text: "Test rule", sort_order: 0 },
    ]);
    const rules = getRules(db, PERSONA_ID);
    expect(rules.length).toBe(1);
    expect(rules[0].rule_text).toBe("Test rule");
  });
});

describe("coaching_insights", () => {
  it("inserts and retrieves active insights", () => {
    const id = insertCoachingInsight(db, PERSONA_ID, {
      title: "Hook patterns",
      prompt_text: "Use contrarian hooks for higher engagement",
      evidence: "Top 5 posts all use contrarian hooks",
    });
    expect(id).toBeGreaterThan(0);

    const insights = getActiveCoachingInsights(db, PERSONA_ID);
    expect(insights.length).toBe(1);
    expect(insights[0].title).toBe("Hook patterns");
  });

  it("updates insight status", () => {
    const insights = getActiveCoachingInsights(db, PERSONA_ID);
    updateCoachingInsight(db, insights[0].id, { status: "retired", retired_at: new Date().toISOString() });
    const active = getActiveCoachingInsights(db, PERSONA_ID);
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
    const id = insertResearch(db, PERSONA_ID, {
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
    const researchId = insertResearch(db, PERSONA_ID, {
      post_type: "topic",
      stories_json: JSON.stringify([]),
    });
    genId = insertGeneration(db, PERSONA_ID, {
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
    const result = listGenerations(db, PERSONA_ID, { limit: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.generations.length).toBeGreaterThan(0);
  });

  it("filters generations by status", () => {
    const result = listGenerations(db, PERSONA_ID, { status: "copied" });
    expect(result.generations.every((g) => g.status === "copied")).toBe(true);
  });
});

describe("generation_revisions", () => {
  it("inserts a revision", () => {
    const researchId = insertResearch(db, PERSONA_ID, { post_type: "news", stories_json: "[]" });
    const genId = insertGeneration(db, PERSONA_ID, {
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
    const syncId = insertCoachingSync(db, PERSONA_ID, JSON.stringify([{ type: "new" }]));
    const sync = getCoachingSync(db, syncId);
    expect(sync).toBeDefined();
    expect(sync!.status).toBe("pending");
  });
});

describe("coaching_change_log", () => {
  it("inserts changes and updates decisions", () => {
    const syncId = insertCoachingSync(db, PERSONA_ID, "[]");
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
    const researchId = insertResearch(db, PERSONA_ID, { post_type: "news", stories_json: "[]" });
    const genId = insertGeneration(db, PERSONA_ID, {
      research_id: researchId,
      post_type: "news",
      selected_story_index: 0,
      drafts_json: "[]",
    });
    insertTopicLog(db, { generation_id: genId, topic_category: "AI", was_stretch: false });
    insertTopicLog(db, { generation_id: genId, topic_category: "Finance", was_stretch: true });
    const topics = getRecentTopics(db, PERSONA_ID, 5);
    expect(topics.length).toBe(2);
    expect(topics[0].topic_category).toBe("Finance");
  });
});

describe("getRecentStoryHeadlines", () => {
  it("returns headlines from recent research sessions", () => {
    insertResearch(db, PERSONA_ID, {
      post_type: "news",
      stories_json: JSON.stringify([
        { headline: "Headline Alpha", summary: "s", source: "src", age: "today", tag: "t", angles: [], is_stretch: false },
        { headline: "Headline Beta", summary: "s", source: "src", age: "today", tag: "t", angles: [], is_stretch: false },
      ]),
      article_count: 2,
      source_count: 1,
    });

    const headlines = getRecentStoryHeadlines(db, PERSONA_ID, 30);
    expect(headlines).toContain("Headline Alpha");
    expect(headlines).toContain("Headline Beta");
  });

  it("limits the number of research sessions queried", () => {
    // Get all headlines (limit=30 gets all sessions)
    const allHeadlines = getRecentStoryHeadlines(db, PERSONA_ID, 30);
    // Get only from the most recent session (limit=1)
    const oneSession = getRecentStoryHeadlines(db, PERSONA_ID, 1);
    // The limited query should return fewer headlines
    expect(oneSession.length).toBeLessThan(allHeadlines.length);
    expect(oneSession.length).toBeGreaterThan(0);
  });
});

describe("generation_messages queries", () => {
  it("inserts and retrieves messages", () => {
    // First insert a research record and generation to satisfy FK
    const researchId = insertResearch(db, PERSONA_ID, {
      post_type: "general",
      stories_json: "[]",
    });
    const genId = insertGeneration(db, PERSONA_ID, {
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

describe("getActiveGeneration", () => {
  it("returns the most recent draft generation with drafts", () => {
    const researchId = insertResearch(db, PERSONA_ID, {
      post_type: "general",
      stories_json: JSON.stringify([{ headline: "Active test" }]),
    });
    const genId = insertGeneration(db, PERSONA_ID, {
      research_id: researchId,
      post_type: "general",
      selected_story_index: 0,
      drafts_json: JSON.stringify([{ type: "contrarian", hook: "Test hook", body: "Test body" }]),
    });

    const active = getActiveGeneration(db, PERSONA_ID);
    expect(active).toBeDefined();
    expect(active!.id).toBe(genId);
    expect(active!.status).toBe("draft");
  });

  it("does not return discarded generations", () => {
    // Get the current active, then discard it
    const active = getActiveGeneration(db, PERSONA_ID);
    expect(active).toBeDefined();
    updateGeneration(db, active!.id, { status: "discarded" });

    // Create a new one for cleanup, but discard it too
    const researchId = insertResearch(db, PERSONA_ID, {
      post_type: "general",
      stories_json: "[]",
    });
    const genId = insertGeneration(db, PERSONA_ID, {
      research_id: researchId,
      post_type: "general",
      selected_story_index: 0,
      drafts_json: JSON.stringify([{ type: "test", hook: "Hook" }]),
    });
    updateGeneration(db, genId, { status: "discarded" });

    const result = getActiveGeneration(db, PERSONA_ID);
    // Should not return discarded generations (may return an older draft one)
    if (result) {
      expect(result.status).toBe("draft");
      expect(result.id).not.toBe(genId);
    }
  });

  it("does not return generations with empty drafts", () => {
    const researchId = insertResearch(db, PERSONA_ID, {
      post_type: "general",
      stories_json: "[]",
    });
    // Insert a generation with empty drafts array
    insertGeneration(db, PERSONA_ID, {
      research_id: researchId,
      post_type: "general",
      selected_story_index: 0,
      drafts_json: "[]",
    });

    const active = getActiveGeneration(db, PERSONA_ID);
    // Should not return the empty-drafts generation
    if (active) {
      const drafts = JSON.parse(active.drafts_json!);
      expect(drafts.length).toBeGreaterThan(0);
    }
  });

  it("does not return generations older than 7 days", () => {
    const researchId = insertResearch(db, PERSONA_ID, {
      post_type: "general",
      stories_json: "[]",
    });
    const genId = insertGeneration(db, PERSONA_ID, {
      research_id: researchId,
      post_type: "general",
      selected_story_index: 0,
      drafts_json: JSON.stringify([{ type: "test", hook: "Old" }]),
    });
    // Manually set updated_at to 8 days ago
    db.prepare("UPDATE generations SET updated_at = datetime('now', '-8 days') WHERE id = ?").run(genId);

    const active = getActiveGeneration(db, PERSONA_ID);
    if (active) {
      expect(active.id).not.toBe(genId);
    }
  });
});
