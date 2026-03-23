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
} from "../db/ai-queries.js";
import { createClient, calculateCostCents } from "../ai/client.js";
import { runPipeline } from "../ai/orchestrator.js";

export function registerInsightsRoutes(app: FastifyInstance, db: Database.Database): void {
  // Backfill costs for existing runs (runs once, idempotent)
  const runsToBackfill = db
    .prepare(
      "SELECT id FROM ai_runs WHERE status = 'completed' AND (total_cost_cents = 0 OR total_cost_cents IS NULL)"
    )
    .all() as { id: number }[];

  if (runsToBackfill.length > 0) {
    for (const run of runsToBackfill) {
      const logs = db
        .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
        .all(run.id) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
      if (logs.length === 0) continue; // No logs = genuinely free run, skip
      const cost = calculateCostCents(logs);
      if (cost > 0) {
        db.prepare("UPDATE ai_runs SET total_cost_cents = ? WHERE id = ?").run(cost, run.id);
      }
    }
    console.log(`[Cost Backfill] Checked ${runsToBackfill.length} runs for missing costs`);
  }

  app.get("/api/insights", async () => ({
    recommendations: getRecommendations(db),
    insights: getActiveInsights(db),
  }));

  app.get("/api/insights/overview", async () => ({
    overview: getLatestOverview(db),
  }));

  app.get("/api/insights/changelog", async () => getChangelog(db));

  app.get("/api/insights/tags", async (request) => {
    const q = request.query as { post_ids?: string };
    const postIds = q.post_ids ? q.post_ids.split(",") : [];
    return { tags: getAiTags(db, postIds) };
  });

  app.get("/api/insights/taxonomy", async () => ({
    taxonomy: getTaxonomy(db),
  }));

  app.post("/api/insights/refresh", async (request, reply) => {
    const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (!apiKey) {
      return reply.status(400).send({ error: "No API key configured. Set TRUSTMIND_LLM_API_KEY." });
    }
    const running = getRunningRun(db);
    if (running) {
      return reply.status(409).send({ error: "Analysis already running", started_at: running.started_at });
    }
    const client = createClient(apiKey);
    const body = request.body as { force?: boolean } | undefined;
    const trigger = body?.force ? "force" : "manual";
    // Fire and forget — don't block the response
    runPipeline(client, db, trigger).catch((err) => {
      console.error("[AI Pipeline] Refresh failed:", err.message);
    });
    return { ok: true, message: "Analysis started" };
  });

  app.post("/api/insights/retag", async (_request, reply) => {
    const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (!apiKey) {
      return reply.status(400).send({ error: "No API key configured. Set TRUSTMIND_LLM_API_KEY." });
    }
    const running = getRunningRun(db);
    if (running) {
      return reply.status(409).send({ error: "Analysis already running", started_at: running.started_at });
    }
    // Clear all tags, topics, and taxonomy to force full regeneration
    db.prepare("DELETE FROM ai_tags").run();
    db.prepare("DELETE FROM ai_post_topics").run();
    db.prepare("DELETE FROM ai_taxonomy").run();
    const client = createClient(apiKey);
    runPipeline(client, db, "retag").catch((err) => {
      console.error("[AI Pipeline] Retag failed:", err.message);
    });
    return { ok: true, message: "Cleared tags and taxonomy, regenerating from scratch" };
  });

  app.patch("/api/insights/recommendations/:id/feedback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { feedback?: string | { rating: string; reason?: string }; acted_on?: boolean };
    if (!body.feedback && body.acted_on === undefined) {
      return reply.status(400).send({ error: "Provide feedback or acted_on" });
    }
    const rec = db.prepare("SELECT id FROM recommendations WHERE id = ?").get(Number(id));
    if (!rec) {
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
      db.prepare("UPDATE recommendations SET acted_on = ?, acted_on_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(body.acted_on ? 1 : 0, Number(id));
    }
    return { ok: true };
  });

  app.get("/api/insights/logs/:runId", async (request) => {
    const { runId } = request.params as { runId: string };
    return { logs: db.prepare("SELECT * FROM ai_logs WHERE run_id = ? ORDER BY id").all(Number(runId)) };
  });

  app.get("/api/insights/gaps", async () => ({
    gaps: getLatestAnalysisGaps(db),
  }));

  app.get("/api/insights/prompt-suggestions", async () => ({
    prompt_suggestions: getLatestPromptSuggestions(db),
  }));

  // Coach redesign: recommendations with cooldown filtering
  app.get("/api/insights/recommendations", async () => {
    return getRecommendationsWithCooldown(db);
  });

  // Resolve (accept/dismiss) a recommendation
  app.patch("/api/insights/recommendations/:id/resolve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { type?: "accepted" | "dismissed" };
    if (!body.type || !["accepted", "dismissed"].includes(body.type)) {
      return reply.status(400).send({ error: "Provide type: 'accepted' or 'dismissed'" });
    }
    const rec = db.prepare("SELECT id FROM recommendations WHERE id = ?").get(Number(id));
    if (!rec) {
      return reply.status(404).send({ error: "Recommendation not found" });
    }
    resolveRecommendation(db, Number(id), body.type);
    return { ok: true };
  });

  // Deep Dive: progress metrics
  app.get("/api/insights/deep-dive/progress", async (request) => {
    const q = request.query as { days?: string };
    const days = parseInt(q.days ?? "30", 10) || 30;
    return getProgressMetrics(db, days);
  });

  // Deep Dive: category performance
  app.get("/api/insights/deep-dive/categories", async () => ({
    categories: getCategoryPerformance(db),
  }));

  // Deep Dive: engagement quality
  app.get("/api/insights/deep-dive/engagement", async () => ({
    engagement: getEngagementQuality(db),
  }));

  // Deep Dive: sparkline data (per-post time series)
  app.get("/api/insights/deep-dive/sparkline", async (request) => {
    const q = request.query as { days?: string };
    const days = parseInt(q.days ?? "90", 10) || 90;
    return { points: getSparklineData(db, days) };
  });

  // Deep Dive: topic performance
  app.get("/api/insights/deep-dive/topics", async (request) => {
    const q = request.query as { days?: string };
    const days = q.days ? parseInt(q.days, 10) || undefined : undefined;
    return { topics: getTopicPerformance(db, days) };
  });

  // Deep Dive: hook type performance
  app.get("/api/insights/deep-dive/hooks", async (request) => {
    const q = request.query as { days?: string };
    const days = q.days ? parseInt(q.days, 10) || undefined : undefined;
    return getHookPerformance(db, days);
  });

  // Deep Dive: image subtype performance
  app.get("/api/insights/deep-dive/image-subtypes", async (request) => {
    const q = request.query as { days?: string };
    const days = q.days ? parseInt(q.days, 10) || undefined : undefined;
    return { subtypes: getImageSubtypePerformance(db, days) };
  });

  // ── Run history with costs ────────────────────────────────

  app.get("/api/insights/runs", async () => {
    const runs = db
      .prepare(
        `SELECT id, triggered_by, post_count, status, started_at, completed_at,
                total_input_tokens, total_output_tokens, total_cost_cents
         FROM ai_runs
         WHERE status = 'completed'
         ORDER BY id DESC LIMIT 20`
      )
      .all();
    const totalCostCents = db
      .prepare(
        "SELECT COALESCE(SUM(total_cost_cents), 0) as total FROM ai_runs WHERE status = 'completed'"
      )
      .get() as { total: number };
    return { runs, total_cost_cents: totalCostCents.total };
  });

  // ── Analysis status (for regenerate button + next auto-regen) ──

  app.get("/api/insights/status", async () => {
    const running = getRunningRun(db);
    const lastFullRun = db.prepare(
      `SELECT id, triggered_by, post_count, completed_at
       FROM ai_runs WHERE status = 'completed'
         AND triggered_by NOT LIKE '%tagging%'
       ORDER BY id DESC LIMIT 1`
    ).get() as { id: number; triggered_by: string; post_count: number; completed_at: string } | undefined;

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
