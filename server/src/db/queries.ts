import type Database from "better-sqlite3";

export function upsertPost(
  db: Database.Database,
  personaId: number,
  post: {
    id: string;
    content_preview?: string | null;
    content_type?: string | null;
    published_at?: string | null;
    url?: string | null;
    full_text?: string | null;
    hook_text?: string | null;
    image_urls?: string[] | null;
    video_url?: string | null;
  }
): void {
  const imageUrlsJson = post.image_urls && post.image_urls.length > 0 ? JSON.stringify(post.image_urls) : null;

  // If the post already exists, do a partial UPDATE (avoids NOT NULL constraint
  // issues when content_type/published_at are omitted in a partial update).
  if (postExists(db, post.id)) {
    db.prepare(
      `UPDATE posts SET
         content_preview = COALESCE(@content_preview, content_preview),
         content_type = COALESCE(@content_type, content_type),
         published_at = COALESCE(@published_at, published_at),
         url = COALESCE(@url, url),
         full_text = COALESCE(@full_text, full_text),
         hook_text = COALESCE(@hook_text, hook_text),
         image_urls = COALESCE(@image_urls, image_urls),
         video_url = COALESCE(@video_url, video_url)
       WHERE id = @id`
    ).run({
      id: post.id,
      content_preview: post.content_preview ?? null,
      content_type: post.content_type ?? null,
      published_at: post.published_at ?? null,
      url: post.url ?? null,
      full_text: post.full_text ?? null,
      hook_text: post.hook_text ?? null,
      image_urls: imageUrlsJson,
      video_url: post.video_url ?? null,
    });
  } else {
    db.prepare(
      `INSERT INTO posts (id, persona_id, content_preview, content_type, published_at, url, full_text, hook_text, image_urls, video_url)
       VALUES (@id, @persona_id, @content_preview, @content_type, @published_at, @url, @full_text, @hook_text, @image_urls, @video_url)`
    ).run({
      id: post.id,
      persona_id: personaId,
      content_preview: post.content_preview ?? null,
      content_type: post.content_type ?? null,
      published_at: post.published_at ?? null,
      url: post.url ?? null,
      full_text: post.full_text ?? null,
      hook_text: post.hook_text ?? null,
      image_urls: imageUrlsJson,
      video_url: post.video_url ?? null,
    });
  }
}

export function insertPostMetrics(
  db: Database.Database,
  metrics: {
    post_id: string;
    impressions?: number | null;
    members_reached?: number | null;
    reactions?: number | null;
    comments?: number | null;
    reposts?: number | null;
    saves?: number | null;
    sends?: number | null;
    video_views?: number | null;
    watch_time_seconds?: number | null;
    avg_watch_time_seconds?: number | null;
    new_followers?: number | null;
    clicks?: number | null;
    click_through_rate?: number | null;
    follows?: number | null;
    engagement_rate?: number | null;
  }
): void {
  db.prepare(
    `INSERT INTO post_metrics
     (post_id, impressions, members_reached, reactions, comments, reposts, saves, sends,
      video_views, watch_time_seconds, avg_watch_time_seconds, new_followers,
      clicks, click_through_rate, follows, engagement_rate)
     VALUES (@post_id, @impressions, @members_reached, @reactions, @comments, @reposts,
             @saves, @sends, @video_views, @watch_time_seconds, @avg_watch_time_seconds, @new_followers,
             @clicks, @click_through_rate, @follows, @engagement_rate)`
  ).run({
    post_id: metrics.post_id,
    impressions: metrics.impressions ?? null,
    members_reached: metrics.members_reached ?? null,
    reactions: metrics.reactions ?? null,
    comments: metrics.comments ?? null,
    reposts: metrics.reposts ?? null,
    saves: metrics.saves ?? null,
    sends: metrics.sends ?? null,
    video_views: metrics.video_views ?? null,
    watch_time_seconds: metrics.watch_time_seconds ?? null,
    avg_watch_time_seconds: metrics.avg_watch_time_seconds ?? null,
    new_followers: metrics.new_followers ?? null,
    clicks: metrics.clicks ?? null,
    click_through_rate: metrics.click_through_rate ?? null,
    follows: metrics.follows ?? null,
    engagement_rate: metrics.engagement_rate ?? null,
  });
}

export function upsertCommentStats(
  db: Database.Database,
  postId: string,
  authorReplies: number,
  hasThreads: boolean
): void {
  db.prepare(
    `INSERT INTO post_comment_stats (post_id, author_replies, has_threads, scraped_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(post_id) DO UPDATE SET
       author_replies = excluded.author_replies,
       has_threads = excluded.has_threads,
       scraped_at = excluded.scraped_at`
  ).run(postId, authorReplies, hasThreads ? 1 : 0);
}

export function upsertFollowerSnapshot(
  db: Database.Database,
  personaId: number,
  totalFollowers: number
): void {
  const today = new Date().toISOString().split("T")[0];
  db.prepare(
    `INSERT INTO follower_snapshots (date, persona_id, total_followers)
     VALUES (?, ?, ?)
     ON CONFLICT(date, persona_id) DO UPDATE SET total_followers = ?`
  ).run(today, personaId, totalFollowers, totalFollowers);
}

export function upsertProfileSnapshot(
  db: Database.Database,
  personaId: number,
  profile: {
    profile_views?: number | null;
    search_appearances?: number | null;
    all_appearances?: number | null;
  }
): void {
  const today = new Date().toISOString().split("T")[0];
  db.prepare(
    `INSERT INTO profile_snapshots (date, persona_id, profile_views, search_appearances, all_appearances)
     VALUES (@date, @persona_id, @profile_views, @search_appearances, @all_appearances)
     ON CONFLICT(date, persona_id) DO UPDATE SET
       profile_views = COALESCE(@profile_views, profile_views),
       search_appearances = COALESCE(@search_appearances, search_appearances),
       all_appearances = COALESCE(@all_appearances, all_appearances)`
  ).run({
    date: today,
    persona_id: personaId,
    profile_views: profile.profile_views ?? null,
    search_appearances: profile.search_appearances ?? null,
    all_appearances: profile.all_appearances ?? null,
  });
}

export function logScrape(
  db: Database.Database,
  personaId: number,
  log: {
    posts_status: string;
    followers_status: string;
    profile_status: string;
    posts_count: number;
    error_details?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO scrape_log (persona_id, completed_at, posts_status, followers_status, profile_status, posts_count, error_details)
     VALUES (@persona_id, CURRENT_TIMESTAMP, @posts_status, @followers_status, @profile_status, @posts_count, @error_details)`
  ).run({
    persona_id: personaId,
    posts_status: log.posts_status,
    followers_status: log.followers_status,
    profile_status: log.profile_status,
    posts_count: log.posts_count,
    error_details: log.error_details ?? null,
  });
}

export function postExists(db: Database.Database, postId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM posts WHERE id = ?")
    .get(postId);
  return !!row;
}

export interface PostsQueryParams {
  content_type?: string;
  since?: string;
  until?: string;
  min_impressions?: number;
  sort_by?: string;
  sort_order?: string;
  offset?: number;
  limit?: number;
}

export function queryPosts(db: Database.Database, personaId: number, params: PostsQueryParams) {
  const conditions: string[] = ["p.persona_id = ?"];
  const values: any[] = [personaId];

  if (params.content_type) {
    conditions.push("p.content_type = ?");
    values.push(params.content_type);
  }
  if (params.since) {
    conditions.push("p.published_at >= ?");
    values.push(params.since);
  }
  if (params.until) {
    conditions.push("p.published_at <= ?");
    values.push(params.until);
  }
  if (params.min_impressions != null) {
    conditions.push("m.impressions >= ?");
    values.push(params.min_impressions);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const allowedSortColumns: Record<string, string> = {
    published_at: "p.published_at",
    impressions: "m.impressions",
    engagement_rate: "engagement_rate",
    weighted_engagement: "weighted_engagement",
    reactions: "m.reactions",
    comments: "m.comments",
  };

  const sortCol = allowedSortColumns[params.sort_by || "published_at"] || "p.published_at";
  const sortOrder = params.sort_order === "asc" ? "ASC" : "DESC";
  const limit = Math.min(params.limit || 20, 100);
  const offset = params.offset || 0;

  const countSql = `
    SELECT COUNT(*) as total
    FROM posts p
    LEFT JOIN post_metrics m ON m.post_id = p.id
      AND m.id = (SELECT MAX(id) FROM post_metrics WHERE post_id = p.id)
    ${where}
  `;

  const querySql = `
    SELECT p.id, p.content_preview, p.hook_text, p.full_text, p.image_local_paths,
      p.content_type, p.published_at, p.url,
      m.impressions, m.reactions, m.comments, m.reposts, m.saves, m.sends,
      CASE WHEN m.impressions > 0
        THEN CAST(COALESCE(m.reactions, 0) + COALESCE(m.comments, 0) + COALESCE(m.reposts, 0) AS REAL) / m.impressions
        ELSE NULL
      END AS engagement_rate,
      COALESCE(m.reactions, 0) + COALESCE(m.comments, 0) * 3 + COALESCE(m.reposts, 0) * 4
        + COALESCE(m.saves, 0) * 5 + COALESCE(m.sends, 0) * 4 AS weighted_engagement,
      t.post_category,
      (SELECT GROUP_CONCAT(tax.name, ',') FROM ai_post_topics apt JOIN ai_taxonomy tax ON tax.id = apt.taxonomy_id WHERE apt.post_id = p.id) AS topics
    FROM posts p
    LEFT JOIN post_metrics m ON m.post_id = p.id
      AND m.id = (SELECT MAX(id) FROM post_metrics WHERE post_id = p.id)
    LEFT JOIN ai_tags t ON t.post_id = p.id
    ${where}
    ORDER BY ${sortCol} ${sortOrder}
    LIMIT ? OFFSET ?
  `;

  const total = (db.prepare(countSql).get(...values) as any).total;
  const posts = db.prepare(querySql).all(...values, limit, offset);

  return { posts, total, offset, limit };
}

export function queryMetrics(db: Database.Database, postId: string) {
  return db
    .prepare(
      `SELECT id, post_id, scraped_at, impressions, members_reached,
              reactions, comments, reposts, saves, sends,
              video_views, watch_time_seconds, avg_watch_time_seconds
       FROM post_metrics
       WHERE post_id = ?
       ORDER BY scraped_at ASC`
    )
    .all(postId);
}

export function queryOverview(
  db: Database.Database,
  personaId: number,
  params?: { since?: string; until?: string }
) {
  const conditions: string[] = ["p.persona_id = ?"];
  const values: any[] = [personaId];

  if (params?.since) {
    conditions.push("p.published_at >= ?");
    values.push(params.since);
  }
  if (params?.until) {
    conditions.push("p.published_at <= ?");
    values.push(params.until);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const metrics = db
    .prepare(
      `SELECT
        SUM(m.impressions) as total_impressions,
        AVG(
          CASE WHEN m.impressions > 0
            THEN CAST(COALESCE(m.reactions,0) + COALESCE(m.comments,0) + COALESCE(m.reposts,0) AS REAL) / m.impressions
            ELSE NULL
          END
        ) as avg_engagement_rate,
        COUNT(DISTINCT p.id) as posts_count
      FROM posts p
      LEFT JOIN post_metrics m ON m.post_id = p.id
        AND m.id = (SELECT MAX(id) FROM post_metrics WHERE post_id = p.id)
      ${where}`
    )
    .get(...values) as any;

  const followers = db
    .prepare(
      "SELECT total_followers FROM follower_snapshots WHERE persona_id = ? ORDER BY date DESC LIMIT 1"
    )
    .get(personaId) as any;

  const profile = db
    .prepare(
      "SELECT profile_views FROM profile_snapshots WHERE persona_id = ? ORDER BY date DESC LIMIT 1"
    )
    .get(personaId) as any;

  return {
    total_impressions: metrics?.total_impressions ?? 0,
    avg_engagement_rate: metrics?.avg_engagement_rate ?? null,
    total_followers: followers?.total_followers ?? null,
    profile_views: profile?.profile_views ?? null,
    posts_count: metrics?.posts_count ?? 0,
  };
}

export function queryTiming(db: Database.Database, personaId: number) {
  return db
    .prepare(
      `SELECT
        CAST(strftime('%w', p.published_at) AS INTEGER) as day,
        CAST(strftime('%H', p.published_at) AS INTEGER) as hour,
        AVG(
          CASE WHEN m.impressions > 0
            THEN CAST(COALESCE(m.reactions,0) + COALESCE(m.comments,0) + COALESCE(m.reposts,0) AS REAL) / m.impressions
            ELSE NULL
          END
        ) as avg_engagement_rate,
        COUNT(*) as post_count
      FROM posts p
      LEFT JOIN post_metrics m ON m.post_id = p.id
        AND m.id = (SELECT MAX(id) FROM post_metrics WHERE post_id = p.id)
      WHERE p.published_at IS NOT NULL AND p.persona_id = ?
      GROUP BY day, hour
      ORDER BY day, hour`
    )
    .all(personaId);
}

export function queryFollowers(db: Database.Database, personaId: number) {
  return db
    .prepare(
      `SELECT date, total_followers,
        total_followers - LAG(total_followers) OVER (ORDER BY date) AS new_followers
      FROM follower_snapshots
      WHERE persona_id = ?
      ORDER BY date ASC`
    )
    .all(personaId);
}

export function queryProfile(db: Database.Database, personaId: number) {
  return db
    .prepare(
      `SELECT date, profile_views, search_appearances, all_appearances
      FROM profile_snapshots
      WHERE persona_id = ?
      ORDER BY date ASC`
    )
    .all(personaId);
}

export function queryHealth(db: Database.Database, personaId: number) {
  const lastLog = db
    .prepare(
      "SELECT * FROM scrape_log WHERE persona_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(personaId) as any;

  if (!lastLog) {
    return {
      last_sync_at: null,
      sources: {
        posts: { status: "ok" as const, last_success: null },
        followers: { status: "ok" as const, last_success: null },
        profile: { status: "ok" as const, last_success: null },
      },
    };
  }

  const getLastSuccess = (field: string) => {
    const row = db
      .prepare(
        `SELECT completed_at FROM scrape_log WHERE persona_id = ? AND ${field} = 'success' ORDER BY id DESC LIMIT 1`
      )
      .get(personaId) as any;
    return row?.completed_at ?? null;
  };

  const mapStatus = (s: string) => (s === "error" ? "error" : "ok") as "ok" | "error";

  return {
    last_sync_at: lastLog.completed_at,
    sources: {
      posts: {
        status: mapStatus(lastLog.posts_status),
        last_success: getLastSuccess("posts_status"),
        ...(lastLog.posts_status === "error" && lastLog.error_details
          ? { error: JSON.parse(lastLog.error_details)?.posts }
          : {}),
      },
      followers: {
        status: mapStatus(lastLog.followers_status),
        last_success: getLastSuccess("followers_status"),
        ...(lastLog.followers_status === "error" && lastLog.error_details
          ? { error: JSON.parse(lastLog.error_details)?.followers }
          : {}),
      },
      profile: {
        status: mapStatus(lastLog.profile_status),
        last_success: getLastSuccess("profile_status"),
        ...(lastLog.profile_status === "error" && lastLog.error_details
          ? { error: JSON.parse(lastLog.error_details)?.profile }
          : {}),
      },
    },
  };
}

export function getPostIdsNeedingMetrics(db: Database.Database, personaId: number): string[] {
  return (db.prepare(
    `SELECT p.id FROM posts p
     LEFT JOIN post_metrics m ON m.post_id = p.id
     WHERE m.id IS NULL
       AND p.published_at > datetime('now', '-14 days')
       AND p.persona_id = ?
     ORDER BY p.published_at DESC`
  ).all(personaId) as { id: string }[]).map(r => r.id);
}

// ── Post-needs queries (used by ingest and extension endpoints) ──

export function getPostsNeedingContent(db: Database.Database, personaId: number): string[] {
  return (db.prepare(
    "SELECT id FROM posts WHERE full_text IS NULL AND persona_id = ? ORDER BY published_at DESC"
  ).all(personaId) as { id: string }[]).map(r => r.id);
}

export function getPostsNeedingImages(db: Database.Database, personaId: number): string[] {
  return (db.prepare(
    `SELECT id FROM posts
     WHERE persona_id = ?
       AND content_type IN ('image', 'carousel')
       AND (image_local_paths IS NULL OR image_local_paths = '[]')
       AND (image_urls IS NULL OR image_urls = '[]')
     ORDER BY published_at DESC`
  ).all(personaId) as { id: string }[]).map(r => r.id);
}

export function getPostsNeedingVideoUrl(db: Database.Database, personaId: number): string[] {
  return (db.prepare(
    "SELECT id FROM posts WHERE persona_id = ? AND content_type = 'video' AND video_url IS NULL ORDER BY published_at DESC"
  ).all(personaId) as { id: string }[]).map(r => r.id);
}

export function getPostsWithRecentMetrics(db: Database.Database, personaId: number): string[] {
  return (db.prepare(
    `SELECT DISTINCT pm.post_id FROM post_metrics pm
     JOIN posts p ON p.id = pm.post_id
     WHERE pm.scraped_at > datetime('now', '-12 hours')
       AND p.persona_id = ?`
  ).all(personaId) as { post_id: string }[]).map(r => r.post_id);
}

export function getImageLocalPaths(db: Database.Database, postId: string): string | null {
  const row = db.prepare("SELECT image_local_paths FROM posts WHERE id = ?").get(postId) as { image_local_paths: string | null } | undefined;
  return row?.image_local_paths ?? null;
}

export function setImageLocalPaths(db: Database.Database, postId: string, paths: string): void {
  db.prepare("UPDATE posts SET image_local_paths = ? WHERE id = ?").run(paths, postId);
}

// ── Sync health queries ─────────────────────────────────

export function getAvgScrapedPostCount(db: Database.Database, personaId: number): number | null {
  const row = db.prepare(
    `SELECT AVG(posts_count) as avg_count FROM (
       SELECT posts_count FROM scrape_log
       WHERE posts_count > 0 AND persona_id = ?
       ORDER BY id DESC LIMIT 10
     )`
  ).get(personaId) as { avg_count: number | null };
  return row.avg_count;
}

export function getPostCountInWindow(db: Database.Database, personaId: number, days: number): number {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM posts WHERE published_at > datetime('now', '-' || ? || ' days') AND persona_id = ?"
  ).get(days, personaId) as { count: number };
  return row.count;
}

export function getTopExamplePosts(db: Database.Database, personaId: number, limit: number): any[] {
  return db.prepare(
    `SELECT p.id, p.full_text, p.published_at, p.content_type,
      m.impressions, m.reactions, m.comments, m.reposts,
      CASE WHEN m.impressions > 0
        THEN CAST(COALESCE(m.reactions, 0) + COALESCE(m.comments, 0) + COALESCE(m.reposts, 0) AS REAL) / m.impressions
        ELSE NULL
      END AS engagement_rate
    FROM posts p
    LEFT JOIN post_metrics m ON m.post_id = p.id
      AND m.id = (SELECT MAX(id) FROM post_metrics WHERE post_id = p.id)
    LEFT JOIN ai_tags t ON t.post_id = p.id
    WHERE p.persona_id = ?
      AND p.full_text IS NOT NULL
      AND LENGTH(p.full_text) >= 200
      AND m.impressions IS NOT NULL
      AND (t.post_category IS NULL OR t.post_category != 'announcement')
    ORDER BY m.impressions DESC
    LIMIT ?`
  ).all(personaId, limit);
}

export function getPostsNeedingImageDownload(db: Database.Database): { id: string; image_urls: string }[] {
  return db.prepare(
    `SELECT id, image_urls FROM posts
     WHERE image_urls IS NOT NULL AND image_urls != '[]'
       AND (image_local_paths IS NULL OR image_local_paths = '[]')`
  ).all() as { id: string; image_urls: string }[];
}

// ── Scrape health tracking ──────────────────────────────────

export interface ScrapeError {
  error_type: string;
  page_type: string;
  selector: string | null;
  message: string;
  consecutive_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export function upsertScrapeError(db: Database.Database, input: {
  persona_id: number;
  error_type: string;
  page_type: string;
  selector?: string;
  message: string;
}): void {
  db.prepare(
    `INSERT INTO scrape_errors (persona_id, error_type, page_type, selector, message)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(persona_id, error_type, page_type) DO UPDATE SET
       consecutive_count = consecutive_count + 1,
       last_seen_at = CURRENT_TIMESTAMP,
       message = excluded.message,
       selector = excluded.selector,
       resolved_at = NULL`
  ).run(input.persona_id, input.error_type, input.page_type, input.selector ?? null, input.message);
}

export function getActiveScrapeErrors(db: Database.Database, personaId: number): ScrapeError[] {
  return db.prepare(
    "SELECT error_type, page_type, selector, message, consecutive_count, first_seen_at, last_seen_at FROM scrape_errors WHERE persona_id = ? AND resolved_at IS NULL ORDER BY last_seen_at DESC"
  ).all(personaId) as ScrapeError[];
}

export function resolveScrapeErrors(db: Database.Database, personaId: number, pageType: string): void {
  db.prepare(
    "UPDATE scrape_errors SET resolved_at = CURRENT_TIMESTAMP, consecutive_count = 0 WHERE persona_id = ? AND page_type = ? AND resolved_at IS NULL"
  ).run(personaId, pageType);
}
