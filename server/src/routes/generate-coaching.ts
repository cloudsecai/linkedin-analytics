import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  getActiveCoachingInsights,
  insertCoachingSync,
  completeCoachingSync,
  insertCoachingChangeLog,
  updateCoachingChangeDecision,
  getCoachingChangeLog,
  getCoachingSyncHistory,
  insertCoachingInsight,
  updateCoachingInsight,
  getCoachingChange,
} from "../db/generate-queries.js";
import { createRun, completeRun, failRun, getRunCost } from "../db/ai-queries.js";
import { createClient } from "../ai/client.js";
import { AiLogger } from "../ai/logger.js";
import { analyzeCoaching } from "../ai/coaching-analyzer.js";
import { getPersonaId } from "../utils.js";

export function registerCoachingRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post("/api/generate/coaching/analyze", async (request, reply) => {
    const personaId = getPersonaId(request);
    const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (!apiKey) throw new Error("TRUSTMIND_LLM_API_KEY is required");
    const client = createClient(apiKey);
    const runId = createRun(db, personaId, "coaching_analyze", 0);
    const logger = new AiLogger(db, runId);

    try {
      const result = await analyzeCoaching(client, db, personaId, logger);

      const syncId = insertCoachingSync(db, personaId, JSON.stringify(result.changes));

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

      completeRun(db, runId, getRunCost(db, runId));

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
    const change = getCoachingChange(db, changeId);
    if (!change) {
      return reply.status(404).send({ error: "Change not found" });
    }

    const personaId = getPersonaId(request);

    // Apply the decision
    if (action === "accept") {
      if (change.change_type === "new") {
        insertCoachingInsight(db, personaId, {
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

  app.get("/api/generate/coaching/history", async (request) => {
    const personaId = getPersonaId(request);
    const syncs = getCoachingSyncHistory(db, personaId);
    return { syncs };
  });

  app.get("/api/generate/coaching/insights", async (request) => {
    const personaId = getPersonaId(request);
    const insights = getActiveCoachingInsights(db, personaId);
    return { insights };
  });
}
