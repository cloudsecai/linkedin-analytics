import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  getRecommendations,
  getRecommendationsWithCooldown,
  getActiveInsights,
  getLatestOverview,
  getAiTags,
  getTaxonomy,
  getChangelog,
  updateRecommendationFeedback,
  resolveRecommendation,
  getRunningRun,
  getLatestAnalysisGaps,
  getLatestPromptSuggestions,
  getProgressMetrics,
  getCategoryPerformance,
  getEngagementQuality,
  getSparklineData,
  getTopicPerformance,
  getHookPerformance,
  getImageSubtypePerformance,
  getSetting,
  getRunCost,
  getRunsNeedingCostBackfill,
  backfillRunCost,
  clearTagsForPersona,
  getRecommendationById,
  markRecommendationActedOn,
  getAiLogsForRun,
  listCompletedRuns,
  getTotalCostForPersona,
  getLastFullRun,
} from "../db/ai-queries.js";
import { createClient } from "../ai/client.js";
import { runPipeline } from "../ai/orchestrator.js";
import { getPersonaId } from "../utils.js";
import { validateBody } from "../validation.js";
import { refreshBody, feedbackBody, resolveBody } from "../schemas/insights.js";

export function registerInsightsRoutes(app: FastifyInstance, db: Database.Database): void {
  // Backfill costs for existing runs (runs once, idempotent)
  const runsToBackfill = getRunsNeedingCostBackfill(db);
  if (runsToBackfill.length > 0) {
    for (const run of runsToBackfill) {
      const { cost_cents } = getRunCost(db, run.id);
      if (cost_cents > 0) {
        backfillRunCost(db, run.id, cost_cents);
      }
    }
    console.log(`[Cost Backfill] Checked ${runsToBackfill.length} runs for missing costs`);
  }

  app.get("/api/insights", async (request) => {
    const personaId = getPersonaId(request);
    return {
      recommendations: getRecommendations(db, personaId),
      insights: getActiveInsights(db, personaId),
    };
  });

  app.get("/api/insights/overview", async (request) => {
    const personaId = getPersonaId(request);
    return { overview: getLatestOverview(db, personaId) };
  });

  app.get("/api/insights/changelog", async (request) => {
    const personaId = getPersonaId(request);
    return getChangelog(db, personaId);
  });

  app.get("/api/insights/tags", async (request) => {
    const q = request.query as { post_ids?: string };
    const postIds = q.post_ids ? q.post_ids.split(",") : [];
    return { tags: getAiTags(db, postIds) };
  });

  app.get("/api/insights/taxonomy", async () => {
    return { taxonomy: getTaxonomy(db) };
  });

  app.post("/api/insights/refresh", async (request, reply) => {
    const personaId = getPersonaId(request);
    const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (!apiKey) {
      return reply.status(400).send({ error: "No API key configured. Set TRUSTMIND_LLM_API_KEY." });
    }
    const running = getRunningRun(db, personaId);
    if (running) {
      return reply.status(409).send({ error: "Analysis already running", started_at: running.started_at });
    }
    const client = createClient(apiKey);
    const body = request.body ? validateBody(refreshBody, request.body) : undefined;
    const trigger = body?.force ? "force" : "manual";
    // Fire and forget — don't block the response
    runPipeline(client, db, personaId, trigger).catch((err) => {
      console.error("[AI Pipeline] Refresh failed:", err.message);
    });
    return { ok: true, message: "Analysis started" };
  });

  app.post("/api/insights/retag", async (request, reply) => {
    const personaId = getPersonaId(request);
    const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (!apiKey) {
      return reply.status(400).send({ error: "No API key configured. Set TRUSTMIND_LLM_API_KEY." });
    }
    const running = getRunningRun(db, personaId);
    if (running) {
      return reply.status(409).send({ error: "Analysis already running", started_at: running.started_at });
    }
    // Clear tags and topics for this persona's posts only; taxonomy is shared
    clearTagsForPersona(db, personaId);
    const client = createClient(apiKey);
    runPipeline(client, db, personaId, "retag").catch((err) => {
      console.error("[AI Pipeline] Retag failed:", err.message);
    });
    return { ok: true, message: "Cleared tags and taxonomy, regenerating from scratch" };
  });

  app.patch("/api/insights/recommendations/:id/feedback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validateBody(feedbackBody, request.body);
    if (!body.feedback && body.acted_on === undefined) {
      return reply.status(400).send({ error: "Provide feedback or acted_on" });
    }
    if (!getRecommendationById(db, Number(id))) {
      return reply.status(404).send({ error: "Recommendation not found" });
    }
    if (body.feedback) {
      // Accept both plain string and JSON object with { rating, reason }
      const feedbackStr = typeof body.feedback === "object"
        ? JSON.stringify(body.feedback)
        : JSON.stringify({ rating: body.feedback, reason: null });
      updateRecommendationFeedback(db, Number(id), feedbackStr);
    }
    if (body.acted_on !== undefined) {
      markRecommendationActedOn(db, Number(id), body.acted_on);
    }
    return { ok: true };
  });

  app.get("/api/insights/logs/:runId", async (request) => {
    const { runId } = request.params as { runId: string };
    return { logs: getAiLogsForRun(db, Number(runId)) };
  });

  app.get("/api/insights/gaps", async (request) => ({
    gaps: getLatestAnalysisGaps(db, getPersonaId(request)),
  }));

  app.get("/api/insights/prompt-suggestions", async (request) => {
    const personaId = getPersonaId(request);
    return { prompt_suggestions: getLatestPromptSuggestions(db, personaId) };
  });

  // Coach redesign: recommendations with cooldown filtering
  app.get("/api/insights/recommendations", async (request) => {
    const personaId = getPersonaId(request);
    return getRecommendationsWithCooldown(db, personaId);
  });

  // Resolve (accept/dismiss) a recommendation
  app.patch("/api/insights/recommendations/:id/resolve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validateBody(resolveBody, request.body);
    if (!getRecommendationById(db, Number(id))) {
      return reply.status(404).send({ error: "Recommendation not found" });
    }
    resolveRecommendation(db, Number(id), body.type);
    return { ok: true };
  });

  // Deep Dive: progress metrics
  app.get("/api/insights/deep-dive/progress", async (request) => {
    const personaId = getPersonaId(request);
    const q = request.query as { days?: string };
    const days = parseInt(q.days ?? "30", 10) || 30;
    return getProgressMetrics(db, personaId, days);
  });

  // Deep Dive: category performance
  app.get("/api/insights/deep-dive/categories", async (request) => {
    const personaId = getPersonaId(request);
    return { categories: getCategoryPerformance(db, personaId) };
  });

  // Deep Dive: engagement quality
  app.get("/api/insights/deep-dive/engagement", async (request) => {
    const personaId = getPersonaId(request);
    return { engagement: getEngagementQuality(db, personaId) };
  });

  // Deep Dive: sparkline data (per-post time series)
  app.get("/api/insights/deep-dive/sparkline", async (request) => {
    const personaId = getPersonaId(request);
    const q = request.query as { days?: string };
    const days = parseInt(q.days ?? "90", 10) || 90;
    return { points: getSparklineData(db, personaId, days) };
  });

  // Deep Dive: topic performance
  app.get("/api/insights/deep-dive/topics", async (request) => {
    const personaId = getPersonaId(request);
    const q = request.query as { days?: string };
    const days = q.days ? parseInt(q.days, 10) || undefined : undefined;
    return { topics: getTopicPerformance(db, personaId, days) };
  });

  // Deep Dive: hook type performance
  app.get("/api/insights/deep-dive/hooks", async (request) => {
    const personaId = getPersonaId(request);
    const q = request.query as { days?: string };
    const days = q.days ? parseInt(q.days, 10) || undefined : undefined;
    return getHookPerformance(db, personaId, days);
  });

  // Deep Dive: image subtype performance
  app.get("/api/insights/deep-dive/image-subtypes", async (request) => {
    const personaId = getPersonaId(request);
    const q = request.query as { days?: string };
    const days = q.days ? parseInt(q.days, 10) || undefined : undefined;
    return { subtypes: getImageSubtypePerformance(db, personaId, days) };
  });

  // ── Run history with costs ────────────────────────────────

  app.get("/api/insights/runs", async (request) => {
    const personaId = getPersonaId(request);
    const runs = listCompletedRuns(db, personaId);
    return { runs, total_cost_cents: getTotalCostForPersona(db, personaId) };
  });

  // ── Analysis status (for regenerate button + next auto-regen) ──

  app.get("/api/insights/status", async (request) => {
    const personaId = getPersonaId(request);
    const running = getRunningRun(db, personaId);
    const lastFullRun = getLastFullRun(db, personaId);

    const schedule = getSetting(db, "auto_interpret_schedule") ?? "weekly";
    const postThreshold = parseInt(getSetting(db, "auto_interpret_post_threshold") ?? "5", 10);

    // Compute next auto-regen time
    let nextAutoRegen: string | null = null;
    if (lastFullRun && schedule !== "off") {
      const lastRunTime = new Date(lastFullRun.completed_at + "Z").getTime();
      const msPerDay = 86400000;
      const interval = schedule === "daily" ? msPerDay : 7 * msPerDay;
      nextAutoRegen = new Date(lastRunTime + interval).toISOString();
    }

    return {
      running: running ? { id: running.id, started_at: running.started_at } : null,
      last_run: lastFullRun ? {
        id: lastFullRun.id,
        completed_at: lastFullRun.completed_at,
        triggered_by: lastFullRun.triggered_by,
      } : null,
      schedule,
      post_threshold: postThreshold,
      next_auto_regen: nextAutoRegen,
    };
  });
}
