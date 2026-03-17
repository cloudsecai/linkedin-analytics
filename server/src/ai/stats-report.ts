import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────

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
}

export interface PostWithER extends PostRow {
  er: number | null;
}

// ── Stats helpers ──────────────────────────────────────────

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function iqr(values: number[]): number | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length / 4)]!;
  const q3 = sorted[Math.floor((sorted.length * 3) / 4)]!;
  return q3 - q1;
}

export function cliffsDelta(x: number[], y: number[]): { d: number; label: string } {
  if (x.length === 0 || y.length === 0) return { d: 0, label: "negligible" };
  let dominance = 0;
  for (const xi of x) {
    for (const yj of y) {
      if (xi > yj) dominance++;
      else if (xi < yj) dominance--;
    }
  }
  const d = dominance / (x.length * y.length);
  const absD = Math.abs(d);
  const label =
    absD < 0.147 ? "negligible" : absD < 0.33 ? "small" : absD < 0.474 ? "medium" : "large";
  return { d, label };
}

export function computeER(
  reactions: number,
  comments: number,
  reposts: number,
  impressions: number
): number | null {
  if (impressions <= 0) return null;
  return ((reactions + comments + reposts) / impressions) * 100;
}

// ── Formatters ─────────────────────────────────────────────

export function pct(n: number): string {
  return n.toFixed(1) + "%";
}

export function getPostPreview(post: {
  hook_text: string | null;
  full_text: string | null;
  content_preview: string | null;
}): string {
  const rawText = post.hook_text ?? post.full_text ?? post.content_preview;
  if (!rawText) return "Untitled post";
  return rawText.length > 80 ? rawText.slice(0, 77) + "..." : rawText;
}

export function formatInTimezone(
  date: Date,
  tz: string,
  opts: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(date);
}

export function getLocalHour(isoString: string, tz: string): number {
  const date = new Date(isoString);
  const formatted = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: tz,
  }).format(date);
  return parseInt(formatted, 10) % 24;
}

export function getLocalDayName(isoString: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: tz,
  }).format(new Date(isoString));
}

// ── DB loader ──────────────────────────────────────────────

function loadPostsWithMetrics(db: Database.Database): PostWithER[] {
  const rows = db
    .prepare(
      `SELECT
         p.id, p.hook_text, p.full_text, p.content_preview, p.content_type, p.published_at,
         COALESCE(pm.impressions, 0) as impressions,
         COALESCE(pm.reactions, 0) as reactions,
         COALESCE(pm.comments, 0) as comments,
         COALESCE(pm.reposts, 0) as reposts,
         pm.saves,
         pm.sends
       FROM posts p
       JOIN post_metrics pm ON pm.post_id = p.id
       JOIN (
         SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id
       ) latest ON pm.id = latest.max_id
       WHERE pm.impressions > 0
       ORDER BY p.published_at DESC`
    )
    .all() as PostRow[];

  return rows.map((r) => ({
    ...r,
    er: computeER(r.reactions, r.comments, r.reposts, r.impressions),
  }));
}

// ── Section builders ───────────────────────────────────────

function benchmarkLabel(er: number): string {
  if (er < 2) return "below average (under 2%)";
  if (er < 3.5) return "solid (2–3.5% is average)";
  if (er < 5) return "good (3.5–5% range)";
  return "exceptional (above 5%)";
}

function buildOverviewSection(
  db: Database.Database,
  posts: PostWithER[],
  globalMedianER: number | null,
  globalIQR: number | null,
  timezone: string
): string {
  const validERs = posts.filter((p) => p.er !== null).map((p) => p.er!);
  const followerRow = db
    .prepare(
      "SELECT total_followers FROM follower_snapshots ORDER BY date DESC LIMIT 1"
    )
    .get() as { total_followers: number } | undefined;

  const dates = posts.map((p) => p.published_at).sort();
  const earliest = dates[0]
    ? formatInTimezone(new Date(dates[0]), timezone, { month: "short", day: "numeric", year: "numeric" })
    : "N/A";
  const latest = dates[dates.length - 1]
    ? formatInTimezone(new Date(dates[dates.length - 1]), timezone, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "N/A";

  const lines = [
    "## 1. Overview",
    `Total posts with metrics: ${posts.length}`,
    `Date range: ${earliest} to ${latest}`,
  ];

  if (globalMedianER !== null) {
    const iqrStr = globalIQR !== null ? ` (IQR: ${pct(globalIQR)})` : "";
    lines.push(`Median engagement rate: ${pct(globalMedianER)}${iqrStr} — ${benchmarkLabel(globalMedianER)}`);
  } else {
    lines.push("Median engagement rate: N/A (no posts with impressions)");
  }

  if (followerRow) {
    lines.push(`Current followers: ${followerRow.total_followers.toLocaleString()}`);
  }

  lines.push(`Total posts analyzed: ${validERs.length}`);
  return lines.join("\n");
}

function buildRecentVsBaselineSection(posts: PostWithER[], timezone: string): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);

  const recent = posts.filter((p) => new Date(p.published_at) >= cutoff);
  const baseline = posts.filter((p) => new Date(p.published_at) < cutoff);

  const recentERs = recent.filter((p) => p.er !== null).map((p) => p.er!);
  const baselineERs = baseline.filter((p) => p.er !== null).map((p) => p.er!);

  const recentMedian = median(recentERs);
  const baselineMedian = median(baselineERs);

  const lines = [
    "## 2. Recent vs Baseline (last 14 days vs all-time)",
    `Last 14 days: ${recent.length} posts`,
    `All-time baseline: ${baseline.length} posts`,
  ];

  if (recentMedian !== null && baselineMedian !== null) {
    const direction = recentMedian > baselineMedian ? "above" : "below";
    lines.push(
      `Recent median ER: ${pct(recentMedian)} — ${direction} all-time median of ${pct(baselineMedian)}`
    );
  } else if (recentMedian !== null) {
    lines.push(`Recent median ER: ${pct(recentMedian)} (no baseline yet)`);
  } else {
    lines.push("Insufficient data for comparison.");
  }

  const topRecent = [...recent]
    .filter((p) => p.er !== null)
    .sort((a, b) => b.er! - a.er!)
    .slice(0, 3);
  if (topRecent.length > 0) {
    lines.push("Standout recent posts:");
    for (const p of topRecent) {
      const preview = getPostPreview(p);
      const date = formatInTimezone(new Date(p.published_at), timezone, {
        month: "short",
        day: "numeric",
      });
      lines.push(`  - "${preview}" (${date}) — ${pct(p.er!)} ER`);
    }
  }

  return lines.join("\n");
}

function buildFormatSection(posts: PostWithER[]): string {
  const byType = new Map<string, number[]>();
  for (const p of posts) {
    if (p.er === null) continue;
    const arr = byType.get(p.content_type) ?? [];
    arr.push(p.er);
    byType.set(p.content_type, arr);
  }

  const allERs = posts.filter((p) => p.er !== null).map((p) => p.er!);
  const lines = ["## 3. Format Comparison"];

  for (const [type, ers] of byType) {
    const med = median(ers);
    if (med === null) continue;
    if (ers.length < 5) {
      lines.push(`- ${type} (n=${ers.length}): too few posts for reliable comparison — ${pct(med)} median ER`);
      continue;
    }
    const delta = cliffsDelta(ers, allERs);
    lines.push(
      `- ${type} (n=${ers.length}): ${pct(med)} median ER — ${delta.label} difference vs overall (Cliff's δ=${delta.d.toFixed(2)})`
    );
  }

  if (byType.size === 0) lines.push("No format data available.");
  return lines.join("\n");
}

function formatPostLine(p: PostWithER, tz: string): string {
  const preview = getPostPreview(p);
  const date = formatInTimezone(new Date(p.published_at), tz, {
    month: "short",
    day: "numeric",
  });
  const erStr = p.er !== null ? pct(p.er) : "N/A";
  const saves = p.saves ? `, ${p.saves} saves` : "";
  const sends = p.sends ? `, ${p.sends} sends` : "";
  return `- "${preview}" (${date}, ${p.content_type}) — ${p.impressions.toLocaleString()} impressions, ${erStr} ER, ${p.reactions} reactions, ${p.comments} comments${saves}${sends}`;
}

function buildTopBottomSection(posts: PostWithER[], timezone: string): string {
  const sorted = [...posts]
    .filter((p) => p.er !== null)
    .sort((a, b) => b.er! - a.er!);
  const top = sorted.slice(0, 10);
  const bottom = sorted.slice(-10).reverse();

  const lines = ["## 4. Top 10 Posts (by engagement rate)"];
  if (top.length === 0) {
    lines.push("No data.");
  } else {
    for (const p of top) lines.push(formatPostLine(p, timezone));
  }

  lines.push("", "## 5. Bottom 10 Posts (by engagement rate)");
  if (bottom.length === 0) {
    lines.push("No data.");
  } else {
    for (const p of bottom) lines.push(formatPostLine(p, timezone));
  }

  return lines.join("\n");
}

function buildDaySection(posts: PostWithER[], timezone: string): string {
  const byDay = new Map<string, number[]>();
  const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  for (const p of posts) {
    if (p.er === null) continue;
    const day = getLocalDayName(p.published_at, timezone);
    const arr = byDay.get(day) ?? [];
    arr.push(p.er);
    byDay.set(day, arr);
  }

  const lines = ["## 6. Day-of-Week Breakdown"];
  for (const day of dayOrder) {
    const ers = byDay.get(day);
    if (!ers || ers.length === 0) {
      lines.push(`- ${day}: no posts`);
      continue;
    }
    const med = median(ers)!;
    lines.push(`- ${day} (n=${ers.length}): ${pct(med)} median ER`);
  }

  return lines.join("\n");
}

function getTimeWindow(hour: number): string {
  if (hour >= 6 && hour < 10) return "morning (6–10am)";
  if (hour >= 10 && hour < 14) return "midday (10am–2pm)";
  if (hour >= 14 && hour < 18) return "afternoon (2–6pm)";
  if (hour >= 18 && hour < 22) return "evening (6–10pm)";
  return "off-hours (10pm–6am)";
}

function buildTimeSection(posts: PostWithER[], timezone: string): string {
  const byWindow = new Map<string, number[]>();

  for (const p of posts) {
    if (p.er === null) continue;
    const hour = getLocalHour(p.published_at, timezone);
    const window = getTimeWindow(hour);
    const arr = byWindow.get(window) ?? [];
    arr.push(p.er);
    byWindow.set(window, arr);
  }

  const lines = ["## 7. Time-of-Day Breakdown"];
  const windowOrder = [
    "morning (6–10am)",
    "midday (10am–2pm)",
    "afternoon (2–6pm)",
    "evening (6–10pm)",
    "off-hours (10pm–6am)",
  ];

  for (const window of windowOrder) {
    const ers = byWindow.get(window);
    if (!ers || ers.length === 0) {
      lines.push(`- ${window}: no posts`);
      continue;
    }
    lines.push(`- ${window} (n=${ers.length}): ${pct(median(ers)!)} median ER`);
  }

  return lines.join("\n");
}

function buildCommentQualitySection(posts: PostWithER[]): string {
  const buckets = [
    { label: "0–4 comments", min: 0, max: 4 },
    { label: "5–14 comments", min: 5, max: 14 },
    { label: "15–29 comments", min: 15, max: 29 },
    { label: "30+ comments", min: 30, max: Infinity },
  ];

  const lines = ["## 8. Comment Volume Breakdown"];

  for (const bucket of buckets) {
    const inBucket = posts.filter(
      (p) => p.comments >= bucket.min && p.comments <= bucket.max && p.er !== null
    );
    if (inBucket.length === 0) {
      lines.push(`- ${bucket.label}: no posts`);
      continue;
    }
    const medReposts = median(inBucket.map((p) => p.reposts)) ?? 0;
    const medSaves = median(inBucket.filter((p) => p.saves !== null).map((p) => p.saves!));
    const savesStr = medSaves !== null ? `, ${medSaves.toFixed(1)} median saves` : "";
    lines.push(
      `- ${bucket.label} (n=${inBucket.length}): ${medReposts.toFixed(1)} median reposts${savesStr}`
    );
  }

  return lines.join("\n");
}

function buildSavesSendsSection(posts: PostWithER[]): string {
  const withSaves = posts.filter((p) => p.saves !== null && p.saves > 0);
  const withSends = posts.filter((p) => p.sends !== null && p.sends > 0);
  const allSaves = withSaves.map((p) => p.saves!);
  const allSends = withSends.map((p) => p.sends!);
  const medSaves = median(allSaves);
  const medSends = median(allSends);

  const lines = ["## 9. Saves & Sends Highlights"];

  if (medSaves !== null) {
    lines.push(`Median saves: ${medSaves.toFixed(1)} (across ${withSaves.length} posts with save data)`);
    const outliers = withSaves.filter((p) => p.saves! > medSaves * 2);
    for (const p of outliers.slice(0, 5)) {
      lines.push(`  - "${getPostPreview(p)}" — ${p.saves} saves (${(p.saves! / medSaves).toFixed(1)}x median)`);
    }
  } else {
    lines.push("No saves data available.");
  }

  if (medSends !== null) {
    lines.push(`Median sends: ${medSends.toFixed(1)} (across ${withSends.length} posts with send data)`);
  } else {
    lines.push("No sends data available.");
  }

  return lines.join("\n");
}

function buildFrequencySection(posts: PostWithER[]): string {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const recent = posts.filter((p) => new Date(p.published_at) >= ninetyDaysAgo);
  const postsPerWeek = (recent.length / 90) * 7;

  const lines = [
    "## 10. Posting Frequency",
    `Posts in last 90 days: ${recent.length}`,
    `Average: ${postsPerWeek.toFixed(1)} posts/week`,
  ];

  return lines.join("\n");
}

function buildContentGapsSection(db: Database.Database): string {
  const missingText = db
    .prepare("SELECT COUNT(*) as count FROM posts WHERE full_text IS NULL")
    .get() as { count: number };
  const totalPosts = db
    .prepare("SELECT COUNT(*) as count FROM posts")
    .get() as { count: number };
  const missingImages = db
    .prepare(
      `SELECT COUNT(*) as count FROM posts
       WHERE image_local_paths IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ai_image_tags WHERE post_id = posts.id)`
    )
    .get() as { count: number };

  const lines = ["## 11. Content Gaps (data quality notes)"];

  if (missingText.count > 0) {
    lines.push(
      `- ${missingText.count} of ${totalPosts.count} posts have no full text content (open LinkedIn with extension active to backfill)`
    );
  } else {
    lines.push("- All posts have text content ✓");
  }

  if (missingImages.count > 0) {
    lines.push(`- ${missingImages.count} image posts not yet classified`);
  }

  return lines.join("\n");
}

function buildWritingPromptSection(writingPrompt: string | null): string {
  const lines = ["## 12. Author's Writing Prompt"];
  if (writingPrompt) {
    lines.push(writingPrompt);
  } else {
    lines.push("(none set — user can add a writing prompt in Settings)");
  }
  return lines.join("\n");
}

// ── Main export ────────────────────────────────────────────

export function buildStatsReport(
  db: Database.Database,
  timezone: string,
  writingPrompt: string | null
): string {
  const posts = loadPostsWithMetrics(db);
  const validERs = posts.filter((p) => p.er !== null).map((p) => p.er!);
  const globalMedianER = median(validERs);
  const globalIQR = iqr(validERs);

  const sections = [
    buildOverviewSection(db, posts, globalMedianER, globalIQR, timezone),
    buildRecentVsBaselineSection(posts, timezone),
    buildFormatSection(posts),
    buildTopBottomSection(posts, timezone),
    buildDaySection(posts, timezone),
    buildTimeSection(posts, timezone),
    buildCommentQualitySection(posts),
    buildSavesSendsSection(posts),
    buildFrequencySection(posts),
    buildContentGapsSection(db),
    buildWritingPromptSection(writingPrompt),
  ];

  return sections.join("\n\n---\n\n");
}
