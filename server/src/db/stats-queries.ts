import type Database from "better-sqlite3";

// ── PostRow type (shared with stats-report.ts) ────────────

export interface PostRow {
  id: string;
  hook_text: string | null;
  full_text: string | null;
  content_preview: string | null;
  content_type: string;
  published_at: string;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  saves: number | null;
  sends: number | null;
  new_followers: number | null;
}

// ── Data availability counts ──────────────────────────────

export interface DataAvailabilityCounts {
  tagCount: number;
  topicCount: number;
  imageTagCount: number;
  followerDays: number;
}

export function getDataAvailabilityCounts(db: Database.Database): DataAvailabilityCounts {
  const tagCount = (db.prepare("SELECT COUNT(*) as c FROM ai_tags").get() as { c: number }).c;
  const topicCount = (db.prepare("SELECT COUNT(DISTINCT taxonomy_id) as c FROM ai_post_topics").get() as { c: number }).c;
  const imageTagCount = (db.prepare("SELECT COUNT(DISTINCT post_id) as c FROM ai_image_tags").get() as { c: number }).c;
  const followerDays = (db.prepare("SELECT COUNT(*) as c FROM follower_snapshots").get() as { c: number }).c;
  return { tagCount, topicCount, imageTagCount, followerDays };
}

// ── Content gaps ──────────────────────────────────────────

export interface ContentGaps {
  missingTextCount: number;
  totalPostCount: number;
  unclassifiedImageCount: number;
}

export function getContentGaps(db: Database.Database): ContentGaps {
  const missingTextCount = (db.prepare("SELECT COUNT(*) as count FROM posts WHERE full_text IS NULL").get() as { count: number }).count;
  const totalPostCount = (db.prepare("SELECT COUNT(*) as count FROM posts").get() as { count: number }).count;
  const unclassifiedImageCount = (db.prepare(
    `SELECT COUNT(*) as count FROM posts
     WHERE image_local_paths IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM ai_image_tags WHERE post_id = posts.id)`
  ).get() as { count: number }).count;
  return { missingTextCount, totalPostCount, unclassifiedImageCount };
}

// ── Posts with latest metrics ─────────────────────────────

export function loadPostsWithLatestMetrics(db: Database.Database): PostRow[] {
  return db.prepare(
    `SELECT
       p.id, p.hook_text, p.full_text, p.content_preview, p.content_type, p.published_at,
       COALESCE(pm.impressions, 0) as impressions,
       COALESCE(pm.reactions, 0) as reactions,
       COALESCE(pm.comments, 0) as comments,
       COALESCE(pm.reposts, 0) as reposts,
       pm.saves, pm.sends, pm.new_followers
     FROM posts p
     JOIN post_metrics pm ON pm.post_id = p.id
     JOIN (
       SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id
     ) latest ON pm.id = latest.max_id
     WHERE pm.impressions > 0
     ORDER BY p.published_at DESC`
  ).all() as PostRow[];
}

// ── Follower data ─────────────────────────────────────────

export function getLatestFollowerCount(db: Database.Database): number | null {
  const row = db.prepare(
    "SELECT total_followers FROM follower_snapshots ORDER BY date DESC LIMIT 1"
  ).get() as { total_followers: number } | undefined;
  return row?.total_followers ?? null;
}

export function getFollowerSnapshots(db: Database.Database, limit: number): Array<{ date: string; total_followers: number }> {
  return db.prepare(
    "SELECT date, total_followers FROM follower_snapshots ORDER BY date DESC LIMIT ?"
  ).all(limit) as Array<{ date: string; total_followers: number }>;
}

// ── Performance data ──────────────────────────────────────

export interface TopicPerformanceRow {
  topic: string;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  saves: number | null;
  sends: number | null;
}

export function getTopicPerformanceData(db: Database.Database): TopicPerformanceRow[] {
  return db.prepare(
    `SELECT tax.name as topic,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_post_topics apt
     JOIN ai_taxonomy tax ON tax.id = apt.taxonomy_id
     JOIN post_metrics pm ON pm.post_id = apt.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE pm.impressions > 0`
  ).all() as TopicPerformanceRow[];
}

export interface HookPerformanceRow {
  hook_type: string | null;
  format_style: string | null;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  saves: number | null;
  sends: number | null;
}

export function getHookPerformanceData(db: Database.Database): HookPerformanceRow[] {
  return db.prepare(
    `SELECT t.hook_type, t.format_style,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_tags t
     JOIN post_metrics pm ON pm.post_id = t.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE pm.impressions > 0`
  ).all() as HookPerformanceRow[];
}

export interface ImageSubtypeRow {
  subtype: string;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  saves: number | null;
  sends: number | null;
}

export function getImageSubtypePerformanceData(db: Database.Database): ImageSubtypeRow[] {
  return db.prepare(
    `SELECT ait.format as subtype,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_image_tags ait
     JOIN post_metrics pm ON pm.post_id = ait.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE pm.impressions > 0
       AND ait.format IS NOT NULL`
  ).all() as ImageSubtypeRow[];
}
