import type Database from "better-sqlite3";
import type {
  PromptSuggestion,
  PromptSuggestions,
  MetricsSummary,
  CategoryPerformance,
  SparklinePoint,
  EngagementQuality,
  TopicPerformance,
  HookPerformance,
  ImageSubtypePerformance,
} from "@reachlab/shared";

export type {
  PromptSuggestion,
  PromptSuggestions,
  MetricsSummary,
  CategoryPerformance,
  SparklinePoint,
  EngagementQuality,
  TopicPerformance,
  HookPerformance,
  ImageSubtypePerformance,
};

// ── Re-exports: runs ──────────────────────────────────────
export { createRun, completeRun, failRun, getRunningRun, getRunCost, getLatestCompletedRun, getRunLogs, insertAiLog, getAiLogsForRun, listCompletedRuns, getTotalCostForPersona, getLastFullRun, getRunsNeedingCostBackfill, backfillRunCost, pruneOldAiLogs } from "./ai/runs.js";
export type { AiLogInput } from "./ai/runs.js";

// ── Re-exports: tags ──────────────────────────────────────
export { upsertAiTag, getAiTags, getUntaggedPostIds, upsertImageTag, getImageTags, getUnclassifiedImagePosts, upsertTaxonomy, getTaxonomy, setPostTopics, getPostTopics, clearTagsForPersona } from "./ai/tags.js";
export type { AiTag, ImageTagInput, ImageTag } from "./ai/tags.js";

// ── Re-exports: insights ──────────────────────────────────
export { insertInsight, getActiveInsights, retireInsight, insertInsightLineage, upsertOverview, getLatestOverview, getChangelog, getLatestAnalysisGaps, upsertAnalysisGap, getLatestPromptSuggestions, clearPromptSuggestions } from "./ai/insights.js";
export type { InsightInput, OverviewInput, AnalysisGapInput, AnalysisGapRow } from "./ai/insights.js";

// ── Re-exports: recommendations ───────────────────────────
export { insertRecommendation, getUnresolvedRecommendationHeadlines, getRecommendations, getRecommendationsWithCooldown, updateRecommendationFeedback, resolveRecommendation, getRecommendationById, markRecommendationActedOn, getRecentFeedbackWithReasons } from "./ai/recommendations.js";
export type { RecommendationInput } from "./ai/recommendations.js";

// ── Re-exports: deep-dive ─────────────────────────────────
export { getProgressMetrics, getCategoryPerformance, getEngagementQuality, getSparklineData, getTopicPerformance, getHookPerformance, getImageSubtypePerformance, getPostCountWithMetrics, getPostCountSinceRun } from "./ai/deep-dive.js";

// ── settings ───────────────────────────────────────────────

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function upsertSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(key, value);
}

export function deleteSetting(db: Database.Database, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

// ── writing_prompt_history ─────────────────────────────────

export interface WritingPromptHistoryRow {
  id: number;
  prompt_text: string;
  source: string;
  suggestion_evidence: string | null;
  created_at: string;
}

export function saveWritingPromptHistory(
  db: Database.Database,
  personaId: number,
  input: { prompt_text: string; source: string; evidence: string | null }
): void {
  db.prepare(
    `INSERT INTO writing_prompt_history (persona_id, prompt_text, source, suggestion_evidence)
     VALUES (?, ?, ?, ?)`
  ).run(personaId, input.prompt_text, input.source, input.evidence);
}

export function getWritingPromptHistory(db: Database.Database, personaId: number): WritingPromptHistoryRow[] {
  return db
    .prepare("SELECT * FROM writing_prompt_history WHERE persona_id = ? ORDER BY id DESC")
    .all(personaId) as WritingPromptHistoryRow[];
}
