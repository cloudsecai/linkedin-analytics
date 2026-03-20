import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";
import {
  insertResearch,
  getResearch,
  insertGeneration,
  getGeneration,
  updateGeneration,
  listGenerations,
  getRules,
  replaceAllRules,
  seedDefaultRules,
  getActiveCoachingInsights,
  insertCoachingSync,
  getCoachingSync,
  completeCoachingSync,
  insertCoachingChangeLog,
  updateCoachingChangeDecision,
  getCoachingChangeLog,
  getCoachingSyncHistory,
  insertCoachingInsight,
  updateCoachingInsight,
  insertTopicLog,
  getAntiAiTropesEnabled,
  insertGenerationMessage,
  getGenerationMessages,
  type Story,
  type Draft,
} from "../db/generate-queries.js";
import { createRun, completeRun, failRun } from "../db/ai-queries.js";
import { createClient, MODELS, calculateCostCents } from "../ai/client.js";
import { AiLogger } from "../ai/logger.js";
import { researchStories } from "../ai/researcher.js";
import { generateDrafts } from "../ai/drafter.js";
import { combineDrafts } from "../ai/combiner.js";
import { coachCheck } from "../ai/coach-check.js";
import { analyzeCoaching } from "../ai/coaching-analyzer.js";
import { discoverTopics } from "../ai/discovery.js";
import { discoverFeeds, discoverFeedsByGuessing } from "../ai/feed-discoverer.js";
import { type RssSource } from "../ai/rss-fetcher.js";

function getClient(): Anthropic {
  const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
  if (!apiKey) throw new Error("TRUSTMIND_LLM_API_KEY is required");
  return createClient(apiKey);
}

export function registerGenerateRoutes(app: FastifyInstance, db: Database.Database): void {
  // Seed default rules if table is empty (first run)
  const ruleCount = (db.prepare("SELECT COUNT(*) as count FROM generation_rules").get() as any).count;
  if (ruleCount === 0) {
    seedDefaultRules(db);
  }

  // ── Research ─────────────────────────────────────────────

  app.post("/api/generate/research", async (request, reply) => {
    const { topic, avoid } = request.body as {
      topic: string;
      avoid?: string[];
    };
    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return reply.status(400).send({ error: "topic is required" });
    }
    const safeTopic = topic.slice(0, 500).trim();
    const safeAvoid = Array.isArray(avoid) ? avoid.slice(0, 50).map((s) => String(s).slice(0, 200)) : undefined;

    const client = getClient();
    const runId = createRun(db, "generate_research", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await researchStories(client, db, logger, safeTopic, safeAvoid);

      const researchId = insertResearch(db, {
        post_type: "general",
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

  // ── Drafts ───────────────────────────────────────────────

  app.post("/api/generate/drafts", async (request, reply) => {
    const { research_id, story_index, personal_connection } = request.body as {
      research_id: number;
      story_index: number;
      personal_connection?: string;
    };

    const research = getResearch(db, research_id);
    if (!research) {
      return reply.status(404).send({ error: "Research not found" });
    }

    const stories: Story[] = JSON.parse(research.stories_json);
    if (story_index < 0 || story_index >= stories.length) {
      return reply.status(400).send({ error: "Invalid story_index" });
    }

    const client = getClient();
    const runId = createRun(db, "generate_drafts", 0);
    const logger = new AiLogger(db, runId);

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

      // Log topic for anti-narrowing
      insertTopicLog(db, {
        generation_id: generationId,
        topic_category: stories[story_index].tag,
        was_stretch: stories[story_index].is_stretch,
      });

      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      completeRun(db, runId, {
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        cost_cents: calculateCostCents(logs),
      });

      return { generation_id: generationId, drafts: result.drafts };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Combine ──────────────────────────────────────────────

  app.post("/api/generate/combine", async (request, reply) => {
    const { generation_id, selected_drafts, combining_guidance } = request.body as {
      generation_id: number;
      selected_drafts: number[];
      combining_guidance?: string;
    };

    const gen = getGeneration(db, generation_id);
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }

    const drafts: Draft[] = gen.drafts_json ? JSON.parse(gen.drafts_json) : [];
    if (drafts.length === 0) {
      return reply.status(400).send({ error: "No drafts available" });
    }

    const invalidIndex = selected_drafts.find((i) => i < 0 || i >= drafts.length);
    if (invalidIndex !== undefined) {
      return reply.status(400).send({ error: `Invalid draft index: ${invalidIndex}` });
    }

    const client = getClient();
    const runId = createRun(db, "generate_combine", 0);
    const logger = new AiLogger(db, runId);

    try {
      const combineResult = await combineDrafts(client, logger, drafts, selected_drafts, combining_guidance, gen.prompt_snapshot ?? undefined);

      // Run coach-check
      const rules = getRules(db);
      const insights = getActiveCoachingInsights(db);
      const coachResult = await coachCheck(client, logger, combineResult.final_draft, rules, insights);
      const qualityData = {
        expertise_needed: coachResult.expertise_needed,
        alignment: coachResult.alignment,
      };

      const genUpdate: Parameters<typeof updateGeneration>[2] = {
        selected_draft_indices: JSON.stringify(selected_drafts),
        final_draft: coachResult.draft,
        quality_gate_json: JSON.stringify(qualityData),
      };
      if (combining_guidance !== undefined) {
        genUpdate.combining_guidance = combining_guidance;
      }
      updateGeneration(db, generation_id, genUpdate);

      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      completeRun(db, runId, {
        input_tokens: logs.reduce((s, l) => s + l.input_tokens, 0),
        output_tokens: logs.reduce((s, l) => s + l.output_tokens, 0),
        cost_cents: calculateCostCents(logs),
      });

      return { final_draft: coachResult.draft, quality: qualityData };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

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
      const history = getGenerationMessages(db, generation_id, 20).reverse();

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

      const currentDraft = edited_draft ?? gen.final_draft;
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

      for (const msg of history) {
        messages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }

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
          revisedDraft = text.trim();
        }
      } else {
        revisedDraft = text.trim();
      }

      const coachResult = await coachCheck(client, logger, revisedDraft, rules, insights);
      const qualityData = {
        expertise_needed: coachResult.expertise_needed,
        alignment: coachResult.alignment,
      };

      insertGenerationMessage(db, {
        generation_id,
        role: "user",
        content: userContent,
      });
      insertGenerationMessage(db, {
        generation_id,
        role: "assistant",
        content: text,
        draft_snapshot: coachResult.draft,
        quality_json: JSON.stringify(qualityData),
      });

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

  app.get("/api/generate/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const genId = parseInt(id, 10);
    if (isNaN(genId)) return reply.status(400).send({ error: "Invalid id" });

    const messages = getGenerationMessages(db, genId, 20).reverse();

    return messages.map((msg) => {
      if (msg.role === "user") {
        const instrMatch = msg.content.match(/## Instruction\n([\s\S]+)$/);
        return { ...msg, display_content: instrMatch ? instrMatch[1].trim() : msg.content };
      }
      if (msg.role === "assistant") {
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

  // ── Rules CRUD ───────────────────────────────────────────

  app.get("/api/generate/rules", async () => {
    const rules = getRules(db);
    const antiAiEnabled = getAntiAiTropesEnabled(db);

    const categories: Record<string, any> = {
      voice_tone: [] as any[],
      structure_formatting: [] as any[],
      anti_ai_tropes: { enabled: antiAiEnabled, rules: [] as any[] },
    };

    for (const rule of rules) {
      const item = { id: rule.id, rule_text: rule.rule_text, example_text: rule.example_text, sort_order: rule.sort_order };
      if (rule.category === "anti_ai_tropes") {
        categories.anti_ai_tropes.rules.push(item);
      } else if (categories[rule.category]) {
        (categories[rule.category] as any[]).push(item);
      }
    }

    return { categories };
  });

  app.put("/api/generate/rules", async (request) => {
    const { categories } = request.body as {
      categories: {
        voice_tone: Array<{ rule_text: string; example_text?: string; sort_order: number }>;
        structure_formatting: Array<{ rule_text: string; example_text?: string; sort_order: number }>;
        anti_ai_tropes: { enabled: boolean; rules: Array<{ rule_text: string; example_text?: string; sort_order: number }> };
      };
    };

    const allRules: Array<{ category: string; rule_text: string; example_text?: string; sort_order: number; enabled?: number }> = [];

    for (const rule of categories.voice_tone) {
      allRules.push({ category: "voice_tone", ...rule });
    }
    for (const rule of categories.structure_formatting) {
      allRules.push({ category: "structure_formatting", ...rule });
    }
    for (const rule of categories.anti_ai_tropes.rules) {
      allRules.push({ category: "anti_ai_tropes", ...rule, enabled: categories.anti_ai_tropes.enabled ? 1 : 0 });
    }

    replaceAllRules(db, allRules);
    return { ok: true };
  });

  app.post("/api/generate/rules/reset", async () => {
    seedDefaultRules(db);
    // Return the freshly-seeded rules in the same shape as GET
    const rules = getRules(db);
    const antiAiEnabled = getAntiAiTropesEnabled(db);
    const categories: Record<string, any> = {
      voice_tone: [] as any[],
      structure_formatting: [] as any[],
      anti_ai_tropes: { enabled: antiAiEnabled, rules: [] as any[] },
    };
    for (const rule of rules) {
      const item = { id: rule.id, rule_text: rule.rule_text, example_text: rule.example_text, sort_order: rule.sort_order };
      if (rule.category === "anti_ai_tropes") {
        categories.anti_ai_tropes.rules.push(item);
      } else if (categories[rule.category]) {
        (categories[rule.category] as any[]).push(item);
      }
    }
    return { categories };
  });

  // ── History ──────────────────────────────────────────────

  app.get("/api/generate/history", async (request) => {
    const q = request.query as { status?: string; offset?: string; limit?: string };
    const result = listGenerations(db, {
      status: q.status,
      offset: q.offset ? Number(q.offset) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });

    const summaries = result.generations.map((g) => {
      const drafts: Draft[] = g.drafts_json ? JSON.parse(g.drafts_json) : [];
      const hookExcerpt = g.final_draft
        ? g.final_draft.substring(0, 80) + (g.final_draft.length > 80 ? "..." : "")
        : drafts[0]?.hook?.substring(0, 80) ?? "";

      // Get story headline from research record
      let storyHeadline = "";
      if (g.research_id && g.selected_story_index !== null) {
        const research = getResearch(db, g.research_id);
        if (research) {
          const stories: Story[] = JSON.parse(research.stories_json);
          storyHeadline = stories[g.selected_story_index]?.headline ?? "";
        }
      }

      return {
        id: g.id,
        hook_excerpt: hookExcerpt,
        story_headline: storyHeadline,
        post_type: g.post_type,
        status: g.status,
        drafts_used: g.selected_draft_indices ? JSON.parse(g.selected_draft_indices).length : 0,
        created_at: g.created_at,
      };
    });

    return { generations: summaries, total: result.total };
  });

  app.get("/api/generate/history/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const gen = getGeneration(db, Number(id));
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }
    // Enrich with research stories
    let stories: any[] = [];
    let articleCount = 0;
    let sourceCount = 0;
    if (gen.research_id) {
      const research = getResearch(db, gen.research_id);
      if (research) {
        stories = JSON.parse(research.stories_json);
        articleCount = research.article_count ?? 0;
        sourceCount = research.source_count ?? 0;
      }
    }
    return { ...gen, stories, article_count: articleCount, source_count: sourceCount };
  });

  app.post("/api/generate/history/:id/discard", async (request, reply) => {
    const { id } = request.params as { id: string };
    const gen = getGeneration(db, Number(id));
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }
    updateGeneration(db, Number(id), { status: "discarded" });
    return { ok: true };
  });

  // ── Coaching Sync ────────────────────────────────────────

  app.post("/api/generate/coaching/analyze", async (request, reply) => {
    const client = getClient();
    const runId = createRun(db, "coaching_analyze", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await analyzeCoaching(client, db, logger);

      const syncId = insertCoachingSync(db, JSON.stringify(result.changes));

      // Create change log entries
      const changes = result.changes.map((change) => {
        const changeId = insertCoachingChangeLog(db, {
          sync_id: syncId,
          insight_id: change.insight_id,
          change_type: change.type,
          old_text: change.old_text,
          new_text: change.new_text,
          evidence: change.evidence,
        });
        return { id: changeId, ...change };
      });

      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      completeRun(db, runId, {
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        cost_cents: calculateCostCents(logs),
      });

      return { sync_id: syncId, changes };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  app.patch("/api/generate/coaching/changes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { action, edited_text } = request.body as {
      action: "accept" | "skip" | "retire" | "keep";
      edited_text?: string;
    };

    const changeId = Number(id);

    // Get the change record
    const change = db
      .prepare("SELECT * FROM coaching_change_log WHERE id = ?")
      .get(changeId) as any;
    if (!change) {
      return reply.status(404).send({ error: "Change not found" });
    }

    // Apply the decision
    if (action === "accept") {
      if (change.change_type === "new") {
        insertCoachingInsight(db, {
          title: change.new_text?.substring(0, 50) ?? "New insight",
          prompt_text: edited_text ?? change.new_text ?? "",
          evidence: change.evidence,
          source_sync_id: change.sync_id,
        });
      } else if (change.change_type === "updated" && change.insight_id) {
        updateCoachingInsight(db, change.insight_id, {
          prompt_text: edited_text ?? change.new_text ?? "",
        });
      }
    } else if (action === "retire" && change.insight_id) {
      updateCoachingInsight(db, change.insight_id, {
        status: "retired",
        retired_at: new Date().toISOString(),
      });
    }

    updateCoachingChangeDecision(db, changeId, action);

    // Check if all changes in this sync have been decided — if so, complete the sync
    const allChanges = getCoachingChangeLog(db, change.sync_id);
    const allDecided = allChanges.every((c) => c.decision !== null);
    if (allDecided) {
      const accepted = allChanges.filter((c) => c.decision === "accept" || c.decision === "retire").length;
      const skipped = allChanges.filter((c) => c.decision === "skip" || c.decision === "keep").length;
      completeCoachingSync(db, change.sync_id, JSON.stringify(allChanges.map((c) => ({ id: c.id, decision: c.decision }))), accepted, skipped);
    }

    return { ok: true };
  });

  app.get("/api/generate/coaching/history", async () => {
    const syncs = getCoachingSyncHistory(db);
    return { syncs };
  });

  app.get("/api/generate/coaching/insights", async () => {
    const insights = getActiveCoachingInsights(db);
    return { insights };
  });

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

  // ── Sources management ─────────────────────────────────

  app.get("/api/sources", async () => {
    const sources = db
      .prepare("SELECT id, name, feed_url, enabled, created_at FROM research_sources ORDER BY name")
      .all() as RssSource[];
    return { sources };
  });

  app.post("/api/sources", async (request, reply) => {
    const { url } = request.body as { url: string };
    if (!url || typeof url !== "string" || !url.trim()) {
      return reply.status(400).send({ error: "url is required" });
    }

    // Auto-discover feeds from the URL
    let feeds = await discoverFeeds(url.trim());
    if (feeds.length === 0) {
      feeds = await discoverFeedsByGuessing(url.trim());
    }
    if (feeds.length === 0) {
      return reply.status(404).send({ error: "No feed found at that URL. Try a blog, newsletter, or news site." });
    }

    // Use the first discovered feed
    const feed = feeds[0];

    // Check for duplicate
    const existing = db
      .prepare("SELECT id FROM research_sources WHERE feed_url = ?")
      .get(feed.feed_url);
    if (existing) {
      return reply.status(409).send({ error: "This source is already added." });
    }

    const result = db
      .prepare("INSERT INTO research_sources (name, feed_url) VALUES (?, ?)")
      .run(feed.title, feed.feed_url);

    return {
      source: {
        id: result.lastInsertRowid,
        name: feed.title,
        feed_url: feed.feed_url,
        enabled: 1,
      },
    };
  });

  app.patch("/api/sources/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { enabled, name } = request.body as { enabled?: boolean; name?: string };

    const source = db.prepare("SELECT id FROM research_sources WHERE id = ?").get(Number(id));
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    if (typeof enabled === "boolean") {
      db.prepare("UPDATE research_sources SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, Number(id));
    }
    if (typeof name === "string" && name.trim()) {
      db.prepare("UPDATE research_sources SET name = ? WHERE id = ?").run(name.trim(), Number(id));
    }

    return { ok: true };
  });

  app.delete("/api/sources/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db.prepare("DELETE FROM research_sources WHERE id = ?").run(Number(id));
    if (result.changes === 0) {
      return reply.status(404).send({ error: "Source not found" });
    }
    return { ok: true };
  });
}
