import type Database from "better-sqlite3";
import { computeWeightedER, median } from "../ai/stats-report.js";
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

import { getLatestCompletedRun } from "./ai/runs.js";

// ── Types ──────────────────────────────────────────────────

export interface InsightInput {
  run_id: number;
  category: string;
  stable_key: string;
  claim: string;
  evidence: string;
  confidence: string | number;
  direction: string;
  first_seen_run_id: number;
  consecutive_appearances?: number;
}

export interface RecommendationInput {
  run_id: number;
  type: string;
  priority: number;
  confidence: string | number;
  headline: string;
  detail: string;
  action: string;
  evidence_json: string;
}

export interface OverviewInput {
  run_id: number;
  summary_text: string;
  top_performer_post_id: string | null;
  top_performer_reason: string | null;
  quick_insights: string;
  prompt_suggestions_json: string | null;
}

// ── insights ───────────────────────────────────────────────

export function insertInsight(
  db: Database.Database,
  input: InsightInput
): number {
  const result = db
    .prepare(
      `INSERT INTO insights (run_id, category, stable_key, claim, evidence, confidence, direction, first_seen_run_id, consecutive_appearances)
       VALUES (@run_id, @category, @stable_key, @claim, @evidence, @confidence, @direction, @first_seen_run_id, @consecutive_appearances)`
    )
    .run({
      ...input,
      consecutive_appearances: input.consecutive_appearances ?? 1,
    });
  return Number(result.lastInsertRowid);
}

export function getActiveInsights(db: Database.Database, personaId: number): any[] {
  return db
    .prepare(
      `SELECT i.* FROM insights i
       JOIN ai_runs ar ON ar.id = i.run_id
       WHERE i.status = 'active' AND ar.persona_id = ?
       ORDER BY i.confidence DESC`
    )
    .all(personaId);
}

export function retireInsight(db: Database.Database, insightId: number): void {
  db.prepare("UPDATE insights SET status = 'retired' WHERE id = ?").run(
    insightId
  );
}

export function insertInsightLineage(
  db: Database.Database,
  insightId: number,
  predecessorId: number,
  relationship: string
): void {
  db.prepare(
    `INSERT INTO insight_lineage (insight_id, predecessor_id, relationship)
     VALUES (?, ?, ?)`
  ).run(insightId, predecessorId, relationship);
}

// ── recommendations ────────────────────────────────────────

export function insertRecommendation(
  db: Database.Database,
  input: RecommendationInput
): number {
  const result = db
    .prepare(
      `INSERT INTO recommendations (run_id, type, priority, confidence, headline, detail, action, evidence_json)
       VALUES (@run_id, @type, @priority, @confidence, @headline, @detail, @action, @evidence_json)`
    )
    .run(input);
  return Number(result.lastInsertRowid);
}

export function getUnresolvedRecommendationHeadlines(
  db: Database.Database,
  personaId: number
): string[] {
  const rows = db
    .prepare(
      `SELECT r.headline FROM recommendations r
       JOIN ai_runs ar ON ar.id = r.run_id
       WHERE ar.persona_id = ? AND r.resolved_at IS NULL`
    )
    .all(personaId) as { headline: string }[];
  return rows.map((r) => r.headline);
}

export function getRecommendations(
  db: Database.Database,
  personaId: number,
  runId?: number
): any[] {
  if (runId != null) {
    return db
      .prepare(
        "SELECT * FROM recommendations WHERE run_id = ? ORDER BY priority ASC"
      )
      .all(runId);
  }
  // Default: latest completed run
  const latest = getLatestCompletedRun(db, personaId);
  if (!latest) return [];
  return db
    .prepare(
      "SELECT * FROM recommendations WHERE run_id = ? ORDER BY priority ASC"
    )
    .all(latest.id);
}

export function updateRecommendationFeedback(
  db: Database.Database,
  id: number,
  feedback: string
): void {
  db.prepare(
    `UPDATE recommendations SET feedback = ?, feedback_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(feedback, id);
}

// ── ai_overview ────────────────────────────────────────────

export function upsertOverview(
  db: Database.Database,
  input: OverviewInput
): void {
  db.transaction(() => {
    db.prepare("DELETE FROM ai_overview WHERE run_id = ?").run(input.run_id);
    db.prepare(
      `INSERT INTO ai_overview
         (run_id, summary_text, top_performer_post_id, top_performer_reason, quick_insights, prompt_suggestions_json)
       VALUES
         (@run_id, @summary_text, @top_performer_post_id, @top_performer_reason, @quick_insights, @prompt_suggestions_json)`
    ).run(input);
  })();
}

export function getLatestOverview(db: Database.Database, personaId: number): any | null {
  const latest = getLatestCompletedRun(db, personaId);
  if (!latest) return null;
  return (
    db
      .prepare("SELECT * FROM ai_overview WHERE run_id = ? LIMIT 1")
      .get(latest.id) ?? null
  );
}

// ── helpers ────────────────────────────────────────────────

export function getChangelog(db: Database.Database, personaId: number): {
  confirmed: any[];
  new_signal: any[];
  reversed: any[];
  retired: any[];
} {
  const latestRun = getLatestCompletedRun(db, personaId);

  if (!latestRun) return { confirmed: [], new_signal: [], reversed: [], retired: [] };

  const confirmed = db
    .prepare(
      `SELECT * FROM insights
       WHERE status = 'active' AND run_id = ? AND consecutive_appearances > 1
       ORDER BY confidence DESC`
    )
    .all(latestRun.id);

  const new_signal = db
    .prepare(
      `SELECT * FROM insights
       WHERE status = 'active' AND run_id = ? AND first_seen_run_id = ?
       ORDER BY confidence DESC`
    )
    .all(latestRun.id, latestRun.id);

  const reversed = db
    .prepare(
      `SELECT * FROM insights
       WHERE run_id = ? AND direction = 'reversed'
       ORDER BY confidence DESC`
    )
    .all(latestRun.id);

  const retired = db
    .prepare(
      `SELECT i.* FROM insights i
       JOIN ai_runs ar ON ar.id = i.run_id
       WHERE i.status = 'retired' AND ar.persona_id = ?
         AND i.run_id = (
           SELECT MAX(i2.run_id) FROM insights i2
           JOIN ai_runs ar2 ON ar2.id = i2.run_id
           WHERE i2.status = 'retired' AND ar2.persona_id = ?
         )
       ORDER BY i.confidence DESC`
    )
    .all(personaId, personaId);

  return { confirmed, new_signal, reversed, retired };
}

export function getPostCountWithMetrics(db: Database.Database, personaId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT pm.post_id) as count
       FROM post_metrics pm
       JOIN posts p ON p.id = pm.post_id
       WHERE p.persona_id = ?`
    )
    .get(personaId) as { count: number };
  return row.count;
}

export function getPostCountSinceRun(
  db: Database.Database,
  personaId: number,
  runId: number
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM posts p
       WHERE p.persona_id = ?
         AND p.published_at > (
           SELECT completed_at FROM ai_runs WHERE id = ?
         )`
    )
    .get(personaId, runId) as { count: number };
  return row.count;
}

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

// ── ai_analysis_gaps ───────────────────────────────────────

export interface AnalysisGapInput {
  run_id: number | null;
  gap_type: string;
  stable_key: string;
  description: string;
  impact: string;
}

export interface AnalysisGapRow {
  id: number;
  run_id: number | null;
  gap_type: string;
  stable_key: string;
  description: string;
  impact: string;
  times_flagged: number;
  first_seen_at: string;
  last_seen_at: string;
}

export function upsertAnalysisGap(db: Database.Database, input: AnalysisGapInput): void {
  db.prepare(
    `INSERT INTO ai_analysis_gaps (run_id, gap_type, stable_key, description, impact)
     VALUES (@run_id, @gap_type, @stable_key, @description, @impact)
     ON CONFLICT(gap_type, stable_key) DO UPDATE SET
       description = excluded.description,
       impact = excluded.impact,
       times_flagged = times_flagged + 1,
       last_seen_at = CURRENT_TIMESTAMP,
       run_id = excluded.run_id`
  ).run(input);
}

export function getLatestAnalysisGaps(db: Database.Database, personaId: number): AnalysisGapRow[] {
  return db
    .prepare(
      `SELECT ag.* FROM ai_analysis_gaps ag
       LEFT JOIN ai_runs ar ON ar.id = ag.run_id
       WHERE ar.persona_id = ? OR ag.run_id IS NULL
       ORDER BY ag.times_flagged DESC, ag.last_seen_at DESC`
    )
    .all(personaId) as AnalysisGapRow[];
}

// ── prompt suggestions (stored in ai_overview) ─────────────

// PromptSuggestion, PromptSuggestions — imported from @reachlab/shared

export function getLatestPromptSuggestions(db: Database.Database, personaId: number): PromptSuggestions | null {
  const latest = getLatestCompletedRun(db, personaId);
  if (!latest) return null;
  const row = db
    .prepare("SELECT prompt_suggestions_json FROM ai_overview WHERE run_id = ? LIMIT 1")
    .get(latest.id) as { prompt_suggestions_json: string | null } | undefined;
  if (!row?.prompt_suggestions_json) return null;
  try {
    return JSON.parse(row.prompt_suggestions_json) as PromptSuggestions;
  } catch {
    return null;
  }
}

// ── recommendation lifecycle ──────────────────────────────

export function resolveRecommendation(
  db: Database.Database,
  id: number,
  type: "accepted" | "dismissed"
): void {
  db.prepare(
    `UPDATE recommendations SET resolved_at = CURRENT_TIMESTAMP, resolved_type = ? WHERE id = ?`
  ).run(type, id);
}

export function getRecommendationsWithCooldown(
  db: Database.Database,
  personaId: number,
  runId?: number
): { active: any[]; resolved: any[] } {
  const latest = runId ?? getLatestCompletedRun(db, personaId)?.id;
  if (!latest) return { active: [], resolved: [] };

  const allRecs = db
    .prepare("SELECT * FROM recommendations WHERE run_id = ? ORDER BY priority ASC")
    .all(latest);

  // Get recently resolved stable_keys with their cooldown windows
  // Scope to persona through ai_runs
  const recentlyResolved = db
    .prepare(
      `SELECT r.stable_key, r.resolved_type, r.resolved_at, r.headline
       FROM recommendations r
       JOIN ai_runs ar ON ar.id = r.run_id
       WHERE ar.persona_id = ?
         AND r.resolved_at IS NOT NULL
         AND (
           (r.resolved_type = 'accepted' AND r.resolved_at > datetime('now', '-6 months'))
           OR (r.resolved_type = 'dismissed' AND r.resolved_at > datetime('now', '-3 months'))
         )`
    )
    .all(personaId) as { stable_key: string | null; resolved_type: string; resolved_at: string; headline: string }[];

  const cooldownKeys = new Set(
    recentlyResolved.map((r) => r.stable_key ?? r.headline)
  );

  const active: any[] = [];
  const resolved: any[] = [];

  for (const rec of allRecs as any[]) {
    if (rec.resolved_at) {
      resolved.push(rec);
    } else {
      const key = rec.stable_key ?? rec.headline;
      if (cooldownKeys.has(key)) {
        // Skip — in cooldown from a previous resolution
        continue;
      }
      active.push(rec);
    }
  }

  // Also include recently resolved from any run for the resolved section
  const resolvedFromOtherRuns = db
    .prepare(
      `SELECT r.* FROM recommendations r
       JOIN ai_runs ar ON ar.id = r.run_id
       WHERE ar.persona_id = ?
         AND r.resolved_at IS NOT NULL AND r.run_id != ?
       ORDER BY r.resolved_at DESC LIMIT 10`
    )
    .all(personaId, latest) as any[];

  const resolvedIds = new Set(resolved.map((r: any) => r.id));
  for (const r of resolvedFromOtherRuns) {
    if (!resolvedIds.has(r.id)) resolved.push(r);
  }

  return { active, resolved };
}

// ── deep dive: progress ───────────────────────────────────

// MetricsSummary — imported from @reachlab/shared

export function getProgressMetrics(
  db: Database.Database,
  personaId: number,
  days: number = 30
): { current: MetricsSummary; previous: MetricsSummary } {
  const computeSummary = (sinceDays: number, untilDays: number): MetricsSummary => {
    const rows = db
      .prepare(
        `SELECT pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
         FROM posts p
         JOIN post_metrics pm ON pm.post_id = p.id
         WHERE p.persona_id = ?
           AND p.published_at > datetime('now', ? || ' days')
           AND p.published_at <= datetime('now', ? || ' days')
           AND pm.impressions > 0`
      )
      .all(personaId, String(-sinceDays), String(-untilDays)) as {
      impressions: number;
      reactions: number;
      comments: number;
      reposts: number;
      saves: number | null;
      sends: number | null;
    }[];

    if (rows.length === 0) {
      return { median_er: null, median_impressions: null, total_posts: 0, avg_comments: null };
    }

    // Use weighted ER as primary metric
    const ers = rows
      .map((r) => ((r.comments * 5 + r.reposts * 3 + (r.saves ?? 0) * 3 + (r.sends ?? 0) * 3 + r.reactions * 1) / r.impressions) * 100)
      .sort((a, b) => a - b);
    const impressions = rows.map((r) => r.impressions).sort((a, b) => a - b);
    const comments = rows.map((r) => r.comments);

    const med = (arr: number[]) => {
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    };

    return {
      median_er: Math.round(med(ers) * 100) / 100,
      median_impressions: Math.round(med(impressions)),
      total_posts: rows.length,
      avg_comments: Math.round((comments.reduce((a, b) => a + b, 0) / comments.length) * 10) / 10,
    };
  };

  return {
    current: computeSummary(days, 0),
    previous: computeSummary(days * 2, days),
  };
}

// ── deep dive: category performance ───────────────────────

// CategoryPerformance — imported from @reachlab/shared

export function getCategoryPerformance(db: Database.Database, personaId: number): CategoryPerformance[] {
  const rows = db
    .prepare(
      `SELECT t.post_category as category,
              pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
       FROM ai_tags t
       JOIN posts p ON p.id = t.post_id
       JOIN post_metrics pm ON pm.post_id = t.post_id
       WHERE t.post_category IS NOT NULL
         AND p.persona_id = ?
         AND pm.impressions > 0`
    )
    .all(personaId) as {
    category: string;
    impressions: number;
    reactions: number;
    comments: number;
    reposts: number;
    saves: number | null;
    sends: number | null;
  }[];

  // Group by category — use weighted ER as primary metric
  const groups: Record<string, { ers: number[]; impressions: number[]; interactions: number[] }> = {};
  for (const r of rows) {
    if (!groups[r.category]) groups[r.category] = { ers: [], impressions: [], interactions: [] };
    const wer = ((r.comments * 5 + r.reposts * 3 + (r.saves ?? 0) * 3 + (r.sends ?? 0) * 3 + r.reactions * 1) / r.impressions) * 100;
    groups[r.category].ers.push(wer);
    groups[r.category].impressions.push(r.impressions);
    groups[r.category].interactions.push(r.reactions + r.comments + r.reposts);
  }

  // Compute overall median weighted ER for status classification
  const allErs = rows
    .map((r) => ((r.comments * 5 + r.reposts * 3 + (r.saves ?? 0) * 3 + (r.sends ?? 0) * 3 + r.reactions * 1) / r.impressions) * 100)
    .sort((a, b) => a - b);
  const overallMedianEr =
    allErs.length > 0
      ? allErs.length % 2
        ? allErs[Math.floor(allErs.length / 2)]
        : (allErs[Math.floor(allErs.length / 2) - 1] + allErs[Math.floor(allErs.length / 2)]) / 2
      : 0;

  const med = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const results: CategoryPerformance[] = [];
  for (const [category, data] of Object.entries(groups)) {
    const medianEr = Math.round(med(data.ers) * 100) / 100;
    const medianImpressions = Math.round(med(data.impressions));
    const medianInteractions = Math.round(med(data.interactions));
    const postCount = data.ers.length;

    let status: CategoryPerformance["status"] = "normal";
    if (postCount < 3 && medianEr > overallMedianEr) {
      status = "underexplored_high";
    } else if (postCount >= 3 && medianEr > overallMedianEr) {
      status = "reliable";
    } else if (postCount >= 3 && medianEr < overallMedianEr * 0.7) {
      status = "declining";
    }

    results.push({
      category,
      post_count: postCount,
      median_er: medianEr,
      median_impressions: medianImpressions,
      median_interactions: medianInteractions,
      status,
    });
  }

  return results.sort((a, b) => (b.median_er ?? 0) - (a.median_er ?? 0));
}

// ── deep dive: engagement quality ─────────────────────────

// EngagementQuality — imported from @reachlab/shared

export function getEngagementQuality(db: Database.Database, personaId: number): EngagementQuality {
  const rows = db
    .prepare(
      `SELECT pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
       FROM post_metrics pm
       JOIN posts p ON p.id = pm.post_id
       WHERE p.persona_id = ?
         AND pm.impressions > 0`
    )
    .all(personaId) as {
    impressions: number;
    reactions: number;
    comments: number;
    reposts: number;
    saves: number | null;
    sends: number | null;
  }[];

  if (rows.length === 0) {
    return { comment_ratio: null, save_rate: null, repost_rate: null, weighted_er: null, standard_er: null, total_posts: 0 };
  }

  let totalReactions = 0, totalComments = 0, totalReposts = 0;
  let totalSaves = 0, totalSends = 0, totalImpressions = 0;

  for (const r of rows) {
    totalReactions += r.reactions;
    totalComments += r.comments;
    totalReposts += r.reposts;
    totalSaves += r.saves ?? 0;
    totalSends += r.sends ?? 0;
    totalImpressions += r.impressions;
  }

  const commentRatio = totalReactions > 0
    ? Math.round((totalComments / totalReactions) * 100) / 100
    : null;
  const saveRate = totalImpressions > 0
    ? Math.round((totalSaves / totalImpressions) * 10000) / 100
    : null;
  const repostRate = totalImpressions > 0
    ? Math.round((totalReposts / totalImpressions) * 10000) / 100
    : null;
  const standardEr = totalImpressions > 0
    ? Math.round(((totalReactions + totalComments + totalReposts) / totalImpressions) * 10000) / 100
    : null;
  const weightedEr = totalImpressions > 0
    ? Math.round(
        ((totalComments * 5 + totalReposts * 3 + totalSaves * 3 + totalSends * 3 + totalReactions * 1) /
          totalImpressions) *
          10000
      ) / 100
    : null;

  return {
    comment_ratio: commentRatio,
    save_rate: saveRate,
    repost_rate: repostRate,
    weighted_er: weightedEr,
    standard_er: standardEr,
    total_posts: rows.length,
  };
}

// ── sparkline data: per-post time series ─────────────────

// SparklinePoint — imported from @reachlab/shared

export function getSparklineData(
  db: Database.Database,
  personaId: number,
  days: number = 90
): SparklinePoint[] {
  const rows = db
    .prepare(
      `SELECT p.published_at, pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
       FROM posts p
       JOIN post_metrics pm ON pm.post_id = p.id
       WHERE p.persona_id = ?
         AND p.published_at > datetime('now', ? || ' days')
         AND pm.impressions > 0
       ORDER BY p.published_at ASC`
    )
    .all(personaId, String(-days)) as {
    published_at: string;
    impressions: number;
    reactions: number;
    comments: number;
    reposts: number;
    saves: number | null;
    sends: number | null;
  }[];

  return rows.map((r) => ({
    date: r.published_at,
    // Use weighted ER as primary sparkline metric
    er: Math.round(((r.comments * 5 + r.reposts * 3 + (r.saves ?? 0) * 3 + (r.sends ?? 0) * 3 + r.reactions * 1) / r.impressions) * 10000) / 100,
    impressions: r.impressions,
    comments: r.comments,
    comment_ratio: r.reactions > 0 ? Math.round((r.comments / r.reactions) * 100) / 100 : 0,
    save_rate: r.impressions > 0 ? Math.round(((r.saves ?? 0) / r.impressions) * 10000) / 100 : 0,
  }));
}

export function getRecentFeedbackWithReasons(
  db: Database.Database,
  personaId: number
): { headline: string; feedback: string; reason: string | null }[] {
  const rows = db
    .prepare(
      `SELECT r.headline, r.feedback FROM recommendations r
       JOIN ai_runs ar ON ar.id = r.run_id
       WHERE ar.persona_id = ?
         AND r.feedback IS NOT NULL
       ORDER BY r.feedback_at DESC
       LIMIT 20`
    )
    .all(personaId) as { headline: string; feedback: string }[];

  return rows.map((row) => {
    try {
      const parsed = JSON.parse(row.feedback);
      return {
        headline: row.headline,
        feedback: parsed.rating ?? row.feedback,
        reason: parsed.reason ?? null,
      };
    } catch {
      return { headline: row.headline, feedback: row.feedback, reason: null };
    }
  });
}

// ── deep dive: topic performance ─────────────────────────

// TopicPerformance — imported from @reachlab/shared

export function getTopicPerformance(db: Database.Database, personaId: number, days?: number): TopicPerformance[] {
  const params: any[] = [personaId];
  if (days) params.push(days);

  const rows = db.prepare(
    `SELECT tax.name as topic,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_post_topics apt
     JOIN ai_taxonomy tax ON tax.id = apt.taxonomy_id
     JOIN posts p ON p.id = apt.post_id
     JOIN post_metrics pm ON pm.post_id = apt.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE p.persona_id = ?
       AND pm.impressions > 0
       ${days ? `AND p.published_at > datetime('now', '-' || ? || ' days')` : ""}`
  ).all(...params) as Array<{
    topic: string; impressions: number; reactions: number;
    comments: number; reposts: number; saves: number | null; sends: number | null;
  }>;

  const groups: Record<string, { wers: number[]; impressions: number[]; comments: number[] }> = {};
  for (const r of rows) {
    if (!groups[r.topic]) groups[r.topic] = { wers: [], impressions: [], comments: [] };
    const wer = computeWeightedER(r.reactions, r.comments, r.reposts, r.saves, r.sends, r.impressions);
    if (wer !== null) groups[r.topic].wers.push(wer);
    groups[r.topic].impressions.push(r.impressions);
    groups[r.topic].comments.push(r.comments);
  }

  return Object.entries(groups)
    .map(([topic, data]) => ({
      topic,
      post_count: data.wers.length,
      median_wer: Math.round((median(data.wers) ?? 0) * 100) / 100,
      median_impressions: Math.round(median(data.impressions) ?? 0),
      median_comments: Math.round(median(data.comments) ?? 0),
    }))
    .sort((a, b) => b.median_wer - a.median_wer);
}

// ── deep dive: hook type performance ─────────────────────

// HookPerformance — imported from @reachlab/shared

export function getHookPerformance(db: Database.Database, personaId: number, days?: number): {
  by_hook_type: HookPerformance[];
  by_format_style: HookPerformance[];
} {
  const params: any[] = [personaId];
  if (days) params.push(days);

  const rows = db.prepare(
    `SELECT t.hook_type, t.format_style,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_tags t
     JOIN posts p ON p.id = t.post_id
     JOIN post_metrics pm ON pm.post_id = t.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE p.persona_id = ?
       AND pm.impressions > 0
       ${days ? `AND p.published_at > datetime('now', '-' || ? || ' days')` : ""}`
  ).all(...params) as Array<{
    hook_type: string | null; format_style: string | null;
    impressions: number; reactions: number; comments: number;
    reposts: number; saves: number | null; sends: number | null;
  }>;

  const hookGroups: Record<string, { wers: number[]; impressions: number[]; comments: number[] }> = {};
  const styleGroups: Record<string, { wers: number[]; impressions: number[]; comments: number[] }> = {};

  for (const r of rows) {
    const wer = computeWeightedER(r.reactions, r.comments, r.reposts, r.saves, r.sends, r.impressions);
    if (wer === null) continue;
    if (r.hook_type) {
      if (!hookGroups[r.hook_type]) hookGroups[r.hook_type] = { wers: [], impressions: [], comments: [] };
      hookGroups[r.hook_type].wers.push(wer);
      hookGroups[r.hook_type].impressions.push(r.impressions);
      hookGroups[r.hook_type].comments.push(r.comments);
    }
    if (r.format_style) {
      if (!styleGroups[r.format_style]) styleGroups[r.format_style] = { wers: [], impressions: [], comments: [] };
      styleGroups[r.format_style].wers.push(wer);
      styleGroups[r.format_style].impressions.push(r.impressions);
      styleGroups[r.format_style].comments.push(r.comments);
    }
  }

  const toList = (groups: Record<string, { wers: number[]; impressions: number[]; comments: number[] }>): HookPerformance[] =>
    Object.entries(groups)
      .map(([name, data]) => ({
        name,
        post_count: data.wers.length,
        median_wer: Math.round((median(data.wers) ?? 0) * 100) / 100,
        median_impressions: Math.round(median(data.impressions) ?? 0),
        median_comments: Math.round(median(data.comments) ?? 0),
      }))
      .sort((a, b) => b.median_wer - a.median_wer);

  return { by_hook_type: toList(hookGroups), by_format_style: toList(styleGroups) };
}

// ── deep dive: image subtype performance ─────────────────

// ImageSubtypePerformance — imported from @reachlab/shared

export function getImageSubtypePerformance(db: Database.Database, personaId: number, days?: number): ImageSubtypePerformance[] {
  const params: any[] = [personaId];
  if (days) params.push(days);

  const rows = db.prepare(
    `SELECT ait.format,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_image_tags ait
     JOIN posts p ON p.id = ait.post_id
     JOIN post_metrics pm ON pm.post_id = ait.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE p.persona_id = ?
       AND pm.impressions > 0
       AND ait.format IS NOT NULL
       ${days ? `AND p.published_at > datetime('now', '-' || ? || ' days')` : ""}`
  ).all(...params) as Array<{
    format: string; impressions: number; reactions: number;
    comments: number; reposts: number; saves: number | null; sends: number | null;
  }>;

  if (rows.length === 0) return [];

  const groups: Record<string, { wers: number[]; impressions: number[]; comments: number[] }> = {};
  for (const r of rows) {
    const wer = computeWeightedER(r.reactions, r.comments, r.reposts, r.saves, r.sends, r.impressions);
    if (wer === null) continue;
    if (!groups[r.format]) groups[r.format] = { wers: [], impressions: [], comments: [] };
    groups[r.format].wers.push(wer);
    groups[r.format].impressions.push(r.impressions);
    groups[r.format].comments.push(r.comments);
  }

  return Object.entries(groups)
    .map(([format, data]) => ({
      format,
      post_count: data.wers.length,
      median_wer: Math.round((median(data.wers) ?? 0) * 100) / 100,
      median_impressions: Math.round(median(data.impressions) ?? 0),
      median_comments: Math.round(median(data.comments) ?? 0),
    }))
    .sort((a, b) => b.median_wer - a.median_wer);
}

export function getRecommendationById(db: Database.Database, id: number): { id: number } | undefined {
  return db.prepare("SELECT id FROM recommendations WHERE id = ?").get(id) as { id: number } | undefined;
}

export function markRecommendationActedOn(db: Database.Database, id: number, actedOn: boolean): void {
  db.prepare("UPDATE recommendations SET acted_on = ?, acted_on_at = CURRENT_TIMESTAMP WHERE id = ?").run(actedOn ? 1 : 0, id);
}

export function clearPromptSuggestions(db: Database.Database): void {
  db.prepare(
    "UPDATE ai_overview SET prompt_suggestions_json = NULL WHERE id = (SELECT MAX(id) FROM ai_overview)"
  ).run();
}

export function deleteSetting(db: Database.Database, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}
