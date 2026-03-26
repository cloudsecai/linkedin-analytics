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
  insertTopicLog,
  getAntiAiTropesEnabled,
  getActiveGeneration,
  insertGenerationMessage,
  getGenerationMessages,
  getRuleCount,
  getMaxRuleSortOrder,
  insertSingleRule,
  startRetro,
  completeRetro,
  getRetroResult,
  getPendingRetros,
  markRetroApplied,
  type Story,
  type Draft,
} from "../db/generate-queries.js";
import { createRun, completeRun, failRun, getRunCost, getSetting } from "../db/ai-queries.js";
import { createClient, MODELS } from "../ai/client.js";
import { AiLogger } from "../ai/logger.js";
import { researchStories } from "../ai/researcher.js";
import { generateDrafts } from "../ai/drafter.js";
import { combineDrafts } from "../ai/combiner.js";
import { coachCheck } from "../ai/coach-check.js";
import { analyzeRetro } from "../ai/retro.js";
import { registerCoachingRoutes } from "./generate-coaching.js";
import { registerSourceRoutes } from "./generate-sources.js";
import { getPersonaId } from "../utils.js";
import { validateBody } from "../validation.js";
import { researchBody, draftsBody, combineBody, chatBody, rulesBody, addRuleBody, retroBody } from "../schemas/generate.js";

function getClient(): Anthropic {
  const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
  if (!apiKey) throw new Error("TRUSTMIND_LLM_API_KEY is required");
  return createClient(apiKey);
}

export function registerGenerateRoutes(app: FastifyInstance, db: Database.Database): void {
  // Seed default rules for persona 1 if none exist (first run)
  if (getRuleCount(db, 1) === 0) {
    seedDefaultRules(db, 1);
  }

  // ── Research ─────────────────────────────────────────────

  app.post("/api/generate/research", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { topic, avoid } = validateBody(researchBody, request.body);
    const safeAvoid = Array.isArray(avoid) ? avoid.slice(0, 50).map((s) => String(s).slice(0, 200)) : undefined;

    const client = getClient();
    const runId = createRun(db, personaId, "generate_research", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await researchStories(client, db, logger, topic, safeAvoid);

      const researchId = insertResearch(db, personaId, {
        post_type: "general",
        stories_json: JSON.stringify(result.stories),
        sources_json: JSON.stringify(result.sources_metadata),
        article_count: result.article_count,
        source_count: result.source_count,
      });

      completeRun(db, runId, getRunCost(db, runId));

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
    const personaId = getPersonaId(request);
    const { research_id, story_index, personal_connection, length } = validateBody(draftsBody, request.body);

    const research = getResearch(db, research_id);
    if (!research) {
      return reply.status(404).send({ error: "Research not found" });
    }

    const stories: Story[] = JSON.parse(research.stories_json);
    if (story_index < 0 || story_index >= stories.length) {
      return reply.status(400).send({ error: "Invalid story_index" });
    }

    const client = getClient();
    const runId = createRun(db, personaId, "generate_drafts", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await generateDrafts(
        client,
        db,
        personaId,
        logger,
        stories[story_index],
        personal_connection,
        length
      );

      const generationId = insertGeneration(db, personaId, {
        research_id,
        post_type: "general",
        selected_story_index: story_index,
        drafts_json: JSON.stringify(result.drafts),
        prompt_snapshot: result.prompt_snapshot,
        personal_connection,
        draft_length: length,
      });

      // Log topic for anti-narrowing
      insertTopicLog(db, {
        generation_id: generationId,
        topic_category: stories[story_index].tag,
        was_stretch: stories[story_index].is_stretch,
      });

      completeRun(db, runId, getRunCost(db, runId));

      return { generation_id: generationId, drafts: result.drafts };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Combine ──────────────────────────────────────────────

  app.post("/api/generate/combine", async (request, reply) => {
    const { generation_id, selected_drafts, combining_guidance } = validateBody(combineBody, request.body);

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

    const personaId = getPersonaId(request);
    const client = getClient();
    const runId = createRun(db, personaId, "generate_combine", 0);
    const logger = new AiLogger(db, runId);

    try {
      const validLengths = new Set(["short", "medium", "long"]);
      const draftLength = gen.draft_length && validLengths.has(gen.draft_length)
        ? (gen.draft_length as import("../ai/drafter.js").DraftLength)
        : undefined;
      const combineResult = await combineDrafts(client, logger, drafts, selected_drafts, combining_guidance, gen.prompt_snapshot ?? undefined, draftLength);

      // Run coach-check
      const rules = getRules(db, personaId);
      const insights = getActiveCoachingInsights(db, personaId);
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

      completeRun(db, runId, getRunCost(db, runId));

      return { final_draft: coachResult.draft, quality: qualityData };
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Chat (replaces Revise) ───────────────────────────────

  app.post("/api/generate/chat", async (request, reply) => {
    const { generation_id, message, edited_draft } = validateBody(chatBody, request.body);

    const gen = getGeneration(db, generation_id);
    if (!gen?.final_draft) {
      return reply.status(404).send({ error: "Generation not found or no final draft" });
    }

    const personaId = getPersonaId(request);
    const client = getClient();
    const runId = createRun(db, personaId, "generate_chat", 0);
    const logger = new AiLogger(db, runId);

    try {
      const history = getGenerationMessages(db, generation_id, 20).reverse();

      const rules = getRules(db, personaId);
      const insights = getActiveCoachingInsights(db, personaId);
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
      }, { timeout: 90_000, maxRetries: 1 });

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

      completeRun(db, runId, getRunCost(db, runId));

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

  app.get("/api/generate/rules", async (request) => {
    const personaId = getPersonaId(request);
    const rules = getRules(db, personaId);
    const antiAiEnabled = getAntiAiTropesEnabled(db, personaId);

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
    const personaId = getPersonaId(request);
    const { categories } = validateBody(rulesBody, request.body);

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

    replaceAllRules(db, personaId, allRules);
    return { ok: true };
  });

  app.post("/api/generate/rules/reset", async (request) => {
    const personaId = getPersonaId(request);
    seedDefaultRules(db, personaId);
    // Return the freshly-seeded rules in the same shape as GET
    const rules = getRules(db, personaId);
    const antiAiEnabled = getAntiAiTropesEnabled(db, personaId);
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

  // Add a single rule (used by retro flow)
  app.post("/api/generate/rules/add", async (request, reply) => {
    const personaId = getPersonaId(request);
    const body = validateBody(addRuleBody, request.body);
    const validCategories = ["voice_tone", "structure_formatting", "anti_ai_tropes"];
    if (!validCategories.includes(body.category)) {
      return reply.status(400).send({ error: "Invalid category" });
    }
    const maxSort = getMaxRuleSortOrder(db, body.category, personaId);
    insertSingleRule(db, personaId, body.category, body.rule_text, maxSort + 1);
    return { ok: true };
  });

  // ── Active generation (auto-restore) ────────────────────

  app.get('/api/generate/active', async (request) => {
    const personaId = getPersonaId(request);
    const row = getActiveGeneration(db, personaId);
    if (!row) {
      return { generation: null };
    }
    // Enrich with research stories — same logic as history detail endpoint
    let stories: any[] = [];
    let articleCount = 0;
    let sourceCount = 0;
    if (row.research_id) {
      const research = getResearch(db, row.research_id);
      if (research) {
        stories = JSON.parse(research.stories_json);
        articleCount = research.article_count ?? 0;
        sourceCount = research.source_count ?? 0;
      }
    }
    return { generation: { ...row, stories, article_count: articleCount, source_count: sourceCount } };
  });

  // ── History ──────────────────────────────────────────────

  app.get("/api/generate/history", async (request) => {
    const personaId = getPersonaId(request);
    const q = request.query as { status?: string; offset?: string; limit?: string };
    const result = listGenerations(db, personaId, {
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

  // ── Retro: compare draft vs published ───────────────────

  app.post("/api/generate/history/:id/retro", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validateBody(retroBody, request.body);
    if (!body.published_text?.trim()) {
      return reply.status(400).send({ error: "published_text is required" });
    }

    const gen = getGeneration(db, Number(id));
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }
    if (!gen.final_draft) {
      return reply.status(400).send({ error: "Generation has no final draft to compare against" });
    }

    const personaId = getPersonaId(request);
    const client = getClient();

    // Get existing rules for context
    const rules = getRules(db, personaId);
    const ruleTexts = rules.filter(r => r.enabled).map(r => r.rule_text);

    // Get current writing prompt so the LLM can suggest specific edits
    const writingPromptValue = getSetting(db, "writing_prompt");

    // Mark as in-progress so the UI can show a spinner and recover if user navigates away
    startRetro(db, Number(id), body.published_text.trim());

    let analysis;
    let input_tokens: number;
    let output_tokens: number;
    try {
      const result = await analyzeRetro(
        client, gen.final_draft, body.published_text.trim(), ruleTexts, writingPromptValue ?? undefined
      );
      analysis = result.analysis;
      input_tokens = result.input_tokens;
      output_tokens = result.output_tokens;
    } catch (err: any) {
      console.error(`[Retro] Analysis failed for generation ${id}:`, err.message ?? err);
      if (err.status) console.error(`[Retro] HTTP status: ${err.status}`);
      if (err.error) console.error(`[Retro] Error body:`, JSON.stringify(err.error));
      return reply.status(502).send({
        error: "AI analysis failed",
        detail: err.message ?? "Unknown error",
      });
    }

    // Store the published text and analysis
    completeRetro(db, Number(id), JSON.stringify(analysis));

    // Update status to published
    updateGeneration(db, Number(id), { status: "published" });

    return { analysis, input_tokens, output_tokens };
  });

  // Get retro results for a generation
  app.get("/api/generate/history/:id/retro", async (request, reply) => {
    const { id } = request.params as { id: string };
    const gen = getGeneration(db, Number(id));
    if (!gen) {
      return reply.status(404).send({ error: "Generation not found" });
    }
    const row = getRetroResult(db, Number(id));

    if (!row?.retro_json) {
      return { retro: null };
    }
    return {
      retro: {
        published_text: row.published_text,
        analysis: JSON.parse(row.retro_json),
        retro_at: row.retro_at,
      }
    };
  });

  // ── Pending Retros (for Coach page) ─────────────────────

  app.get("/api/generate/retros/pending", async (request) => {
    const personaId = getPersonaId(request);
    const rows = getPendingRetros(db, personaId);

    return {
      retros: rows.map((r) => ({
        generation_id: r.id,
        draft_excerpt: (r.final_draft ?? "").split("\n").slice(0, 3).join("\n"),
        retro_at: r.retro_at,
        matched_post_id: r.matched_post_id,
        analysis: JSON.parse(r.retro_json),
      })),
    };
  });

  app.patch("/api/generate/retros/:id/apply", async (request) => {
    const { id } = request.params as { id: string };
    markRetroApplied(db, Number(id));
    return { ok: true };
  });

  // ── Coaching routes (extracted) ────────────────────────────
  registerCoachingRoutes(app, db);

  // ── Source & discovery routes (extracted) ──────────────────
  registerSourceRoutes(app, db);
}
