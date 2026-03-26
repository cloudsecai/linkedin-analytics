import type Database from "better-sqlite3";
import type {
  MetricsSummary,
  CategoryPerformance,
  SparklinePoint,
  EngagementQuality,
  TopicPerformance,
  HookPerformance,
  ImageSubtypePerformance,
} from "@reachlab/shared";
import { computeWeightedER, median } from "../../ai/stats-report.js";

// ── deep dive: progress ───────────────────────────────────

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

// ── deep dive: topic performance ─────────────────────────

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

// ── post count helpers ────────────────────────────────────

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
