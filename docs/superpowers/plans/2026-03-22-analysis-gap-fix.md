# Analysis Gap Fix & Coach Restructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate phantom analysis gaps by enriching the stats report with existing data, add new data collection (per-post followers, comment stats), build cross-analysis API endpoints, and restructure the Coach tab to follow analytics dashboard best practices.

**Architecture:** The stats report (`stats-report.ts`) gets new sections that join AI tags, topics, image subtypes, and follower growth from existing DB tables. A DB migration adds `new_followers` to `post_metrics`, creates `post_comment_stats`, and clears stale gaps. Three new deep-dive API endpoints power the Breakdowns tab. The Coach tab is restructured: Overview (KPIs + sparklines + recommendations) → Insights (unchanged) → Breakdowns (existing + new cross-analysis tables).

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Fastify, React, Zod, Chrome Extension (Manifest V3)

**Spec:** `docs/superpowers/specs/2026-03-22-analysis-gap-fix-design.md`

---

## Chunk 1: DB Migration + Stats Report Enrichment

### Task 1: DB Migration

**Files:**
- Create: `server/src/db/migrations/013-analysis-enrichment.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add new_followers to post_metrics
ALTER TABLE post_metrics ADD COLUMN new_followers INTEGER;

-- Create post_comment_stats table
CREATE TABLE IF NOT EXISTS post_comment_stats (
  post_id TEXT PRIMARY KEY REFERENCES posts(id),
  author_replies INTEGER NOT NULL DEFAULT 0,
  has_threads INTEGER NOT NULL DEFAULT 0,
  scraped_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Clear stale analysis gaps (phantom gaps from before enrichment)
DELETE FROM ai_analysis_gaps;
```

- [ ] **Step 2: Verify migration runs**

Run: `cd /Users/nate/code/linkedin/server && npx tsx src/db/migrate.ts`

If there's no standalone migrate script, the migration runs automatically on server start. Start the server and check the logs for migration output.

- [ ] **Step 3: Commit**

```bash
git add server/src/db/migrations/013-analysis-enrichment.sql
git commit -m "feat: add migration for analysis enrichment (new_followers, post_comment_stats, clear stale gaps)"
```

---

### Task 2: Stats Report — Section 0 (Data Available Preamble)

**Files:**
- Modify: `server/src/ai/stats-report.ts:674-701` (buildStatsReport function)

- [ ] **Step 1: Add preamble builder function**

Add before `buildStatsReport()` (around line 672):

```typescript
function buildDataAvailablePreamble(db: Database.Database): string {
  const tagCount = (db.prepare("SELECT COUNT(*) as c FROM ai_tags").get() as { c: number }).c;
  const topicCount = (db.prepare("SELECT COUNT(DISTINCT taxonomy_id) as c FROM ai_post_topics").get() as { c: number }).c;
  const imageTagCount = (db.prepare("SELECT COUNT(DISTINCT post_id) as c FROM ai_image_tags").get() as { c: number }).c;
  const followerDays = (db.prepare("SELECT COUNT(*) as c FROM follower_snapshots").get() as { c: number }).c;

  const lines = ["## 0. Data Available in This Report"];
  lines.push("This report includes the following enrichment data. Do NOT flag these as data or tool gaps:");
  if (tagCount > 0) lines.push(`- AI tags (hook_type, tone, format_style, post_category) for ${tagCount} posts`);
  if (topicCount > 0) lines.push(`- Topic taxonomy mapping (${topicCount} topics) via ai_post_topics`);
  if (imageTagCount > 0) lines.push(`- Image subtype classification for ${imageTagCount} image posts`);
  if (followerDays > 0) lines.push(`- Daily follower snapshots (${followerDays} days of data)`);
  lines.push("- Hook text + closing text included for top/bottom performers");
  lines.push("- Full post metrics including saves, sends, weighted engagement");
  return lines.join("\n");
}
```

- [ ] **Step 2: Add preamble to sections array**

In `buildStatsReport()`, add `buildDataAvailablePreamble(db)` as the first entry in the `sections` array (before `buildOverviewSection`):

```typescript
const sections = [
  buildDataAvailablePreamble(db),
  buildOverviewSection(db, posts, globalMedianER, globalMedianWER, globalIQR, timezone),
  // ... rest unchanged
];
```

- [ ] **Step 3: Verify report builds**

Run: `cd /Users/nate/code/linkedin/server && npx tsx -e "
import Database from 'better-sqlite3';
import { buildStatsReport } from './src/ai/stats-report.js';
const db = Database(process.env.DB_PATH || '../data/linkedin.db');
const report = buildStatsReport(db, 'America/New_York', null);
console.log(report.substring(0, 500));
"`

Expected: Report starts with "## 0. Data Available" section.

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/stats-report.ts
git commit -m "feat: add data-available preamble to stats report"
```

---

### Task 3: Stats Report — Section 14 (Topic Performance)

**Files:**
- Modify: `server/src/ai/stats-report.ts`

- [ ] **Step 1: Add topic performance builder**

Add before `buildStatsReport()`:

```typescript
function buildTopicPerformanceSection(db: Database.Database): string {
  const rows = db.prepare(
    `SELECT tax.name as topic,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_post_topics apt
     JOIN ai_taxonomy tax ON tax.id = apt.taxonomy_id
     JOIN post_metrics pm ON pm.post_id = apt.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE pm.impressions > 0`
  ).all() as Array<{
    topic: string; impressions: number; reactions: number;
    comments: number; reposts: number; saves: number | null; sends: number | null;
  }>;

  if (rows.length === 0) return "";

  const groups: Record<string, { wers: number[]; impressions: number[]; comments: number[] }> = {};
  for (const r of rows) {
    if (!groups[r.topic]) groups[r.topic] = { wers: [], impressions: [], comments: [] };
    const wer = computeWeightedER(r.reactions, r.comments, r.reposts, r.saves, r.sends, r.impressions);
    if (wer !== null) groups[r.topic].wers.push(wer);
    groups[r.topic].impressions.push(r.impressions);
    groups[r.topic].comments.push(r.comments);
  }

  const lines = ["## 14. Topic Performance"];
  const sorted = Object.entries(groups)
    .map(([topic, data]) => ({
      topic,
      count: data.wers.length,
      medWER: median(data.wers),
      medImpr: median(data.impressions),
      medComments: median(data.comments),
    }))
    .filter((t) => t.medWER !== null)
    .sort((a, b) => b.medWER! - a.medWER!);

  for (const t of sorted) {
    const flag = t.count < 3 ? " ⚠ small sample" : "";
    lines.push(`- ${t.topic} (n=${t.count}): ${pct(t.medWER!)} median weighted ER, ${t.medImpr?.toLocaleString() ?? "N/A"} median impressions, ${t.medComments?.toFixed(0) ?? "N/A"} median comments${flag}`);
  }

  const totalPosts = sorted.reduce((sum, t) => sum + t.count, 0);
  const top3Posts = sorted.slice(0, 3).reduce((sum, t) => sum + t.count, 0);
  if (totalPosts > 0) {
    lines.push(`\nTopic concentration: top 3 topics cover ${Math.round((top3Posts / totalPosts) * 100)}% of posts`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Add to sections array**

Add `buildTopicPerformanceSection(db)` after `buildWritingPromptSection` in the sections array.

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/stats-report.ts
git commit -m "feat: add topic performance section to stats report"
```

---

### Task 4: Stats Report — Section 15 (Hook Type & Structure Performance)

**Files:**
- Modify: `server/src/ai/stats-report.ts`

- [ ] **Step 1: Add hook/structure performance builder**

```typescript
function buildHookPerformanceSection(db: Database.Database): string {
  const rows = db.prepare(
    `SELECT t.hook_type, t.format_style,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_tags t
     JOIN post_metrics pm ON pm.post_id = t.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE pm.impressions > 0`
  ).all() as Array<{
    hook_type: string | null; format_style: string | null;
    impressions: number; reactions: number; comments: number;
    reposts: number; saves: number | null; sends: number | null;
  }>;

  if (rows.length === 0) return "";

  const hookGroups: Record<string, number[]> = {};
  const styleGroups: Record<string, number[]> = {};

  for (const r of rows) {
    const wer = computeWeightedER(r.reactions, r.comments, r.reposts, r.saves, r.sends, r.impressions);
    if (wer === null) continue;
    if (r.hook_type) {
      if (!hookGroups[r.hook_type]) hookGroups[r.hook_type] = [];
      hookGroups[r.hook_type].push(wer);
    }
    if (r.format_style) {
      if (!styleGroups[r.format_style]) styleGroups[r.format_style] = [];
      styleGroups[r.format_style].push(wer);
    }
  }

  const lines = ["## 15. Hook Type & Structure Performance"];

  lines.push("By hook type:");
  const hookSorted = Object.entries(hookGroups)
    .map(([type, wers]) => ({ type, count: wers.length, medWER: median(wers) }))
    .filter((h) => h.medWER !== null)
    .sort((a, b) => b.medWER! - a.medWER!);
  for (const h of hookSorted) {
    const best = h === hookSorted[0] ? " — best performer" : "";
    const worst = h === hookSorted[hookSorted.length - 1] && hookSorted.length > 2 ? " — weakest" : "";
    lines.push(`  - ${h.type} (n=${h.count}): ${pct(h.medWER!)} median weighted ER${best}${worst}`);
  }

  lines.push("By format style:");
  const styleSorted = Object.entries(styleGroups)
    .map(([style, wers]) => ({ style, count: wers.length, medWER: median(wers) }))
    .filter((s) => s.medWER !== null)
    .sort((a, b) => b.medWER! - a.medWER!);
  for (const s of styleSorted) {
    lines.push(`  - ${s.style} (n=${s.count}): ${pct(s.medWER!)} median weighted ER`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Add to sections array after topic section**

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/stats-report.ts
git commit -m "feat: add hook type & structure performance section to stats report"
```

---

### Task 5: Stats Report — Section 16 (Image Subtype Performance)

**Files:**
- Modify: `server/src/ai/stats-report.ts`

- [ ] **Step 1: Add image subtype performance builder**

```typescript
function buildImageSubtypeSection(db: Database.Database): string {
  const rows = db.prepare(
    `SELECT ait.format as subtype,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_image_tags ait
     JOIN post_metrics pm ON pm.post_id = ait.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE pm.impressions > 0
       AND ait.format IS NOT NULL`
  ).all() as Array<{
    subtype: string; impressions: number; reactions: number;
    comments: number; reposts: number; saves: number | null; sends: number | null;
  }>;

  if (rows.length === 0) return "";

  const groups: Record<string, number[]> = {};
  for (const r of rows) {
    const wer = computeWeightedER(r.reactions, r.comments, r.reposts, r.saves, r.sends, r.impressions);
    if (wer === null) continue;
    if (!groups[r.subtype]) groups[r.subtype] = [];
    groups[r.subtype].push(wer);
  }

  const lines = ["## 16. Image Subtype Performance"];
  const sorted = Object.entries(groups)
    .map(([subtype, wers]) => ({ subtype, count: wers.length, medWER: median(wers) }))
    .filter((s) => s.medWER !== null)
    .sort((a, b) => b.medWER! - a.medWER!);

  for (const s of sorted) {
    const flag = s.count < 3 ? " (small sample)" : "";
    lines.push(`- ${s.subtype} (n=${s.count}): ${pct(s.medWER!)} median weighted ER${flag}`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Add to sections array**

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/stats-report.ts
git commit -m "feat: add image subtype performance section to stats report"
```

---

### Task 6: Stats Report — Section 17 (Follower Growth)

**Files:**
- Modify: `server/src/ai/stats-report.ts`

- [ ] **Step 1: Add follower growth builder**

```typescript
function buildFollowerGrowthSection(db: Database.Database): string {
  const snapshots = db.prepare(
    `SELECT date, total_followers FROM follower_snapshots
     ORDER BY date DESC LIMIT 90`
  ).all() as Array<{ date: string; total_followers: number }>;

  if (snapshots.length === 0) return "";

  const current = snapshots[0];
  const lines = ["## 17. Follower Growth"];
  lines.push(`Current: ${current.total_followers.toLocaleString()} (as of ${current.date})`);

  // Find closest snapshot to 30 days ago
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const snap30 = snapshots.find((s) => new Date(s.date) <= thirtyDaysAgo);
  if (snap30) {
    const delta = current.total_followers - snap30.total_followers;
    const pctGrowth = ((delta / snap30.total_followers) * 100).toFixed(1);
    lines.push(`30 days ago: ${snap30.total_followers.toLocaleString()} (+${delta}, +${pctGrowth}%)`);
  }

  // Find closest snapshot to 90 days ago
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const snap90 = snapshots.find((s) => new Date(s.date) <= ninetyDaysAgo);
  if (snap90) {
    const delta = current.total_followers - snap90.total_followers;
    const pctGrowth = ((delta / snap90.total_followers) * 100).toFixed(1);
    lines.push(`90 days ago: ${snap90.total_followers.toLocaleString()} (+${delta}, +${pctGrowth}%)`);
  }

  // Average new followers per week (last 30 days)
  if (snap30) {
    const daysBetween = Math.max(1, Math.round((new Date(current.date).getTime() - new Date(snap30.date).getTime()) / 86400000));
    const delta = current.total_followers - snap30.total_followers;
    const perWeek = Math.round((delta / daysBetween) * 7);
    lines.push(`Avg new followers/week (last 30d): ${perWeek}`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Add to sections array**

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/stats-report.ts
git commit -m "feat: add follower growth section to stats report"
```

---

### Task 7: Stats Report — Expand Top/Bottom Post Detail

**Files:**
- Modify: `server/src/ai/stats-report.ts:96-104` (getPostPreview) and `server/src/ai/stats-report.ts:407-419` (formatPostLine)

The goal: for top 10 / bottom 10 post listings, show hook text (~2 sentences) + closing sentence instead of 80-char truncation. Other sections keep the 80-char preview.

- [ ] **Step 1: Add a detailed post formatter**

Add near the existing `formatPostLine` function:

```typescript
function getPostDetailedPreview(post: {
  hook_text: string | null;
  full_text: string | null;
  content_preview: string | null;
}): string {
  const text = post.full_text ?? post.hook_text ?? post.content_preview;
  if (!text) return "Untitled post";

  // Extract first ~2 sentences as hook
  const sentences = text.split(/(?<=[.!?])\s+/);
  const hook = sentences.slice(0, 2).join(" ");
  const hookPart = hook.length > 200 ? hook.slice(0, 197) + "..." : hook;

  // Extract closing sentence
  const closing = sentences.length > 2 ? sentences[sentences.length - 1] : "";
  const closingPart = closing.length > 150 ? closing.slice(0, 147) + "..." : closing;

  if (closingPart && closingPart !== hookPart) {
    return `"${hookPart}" [...] closing: "${closingPart}"`;
  }
  return `"${hookPart}"`;
}

function formatPostLineDetailed(p: PostWithER, tz: string): string {
  const preview = getPostDetailedPreview(p);
  const date = formatInTimezone(new Date(p.published_at), tz, {
    month: "short",
    day: "numeric",
  });
  const werStr = p.wer !== null ? pct(p.wer) : "N/A";
  const erStr = p.er !== null ? pct(p.er) : "N/A";
  const saves = p.saves ? `, ${p.saves} saves` : "";
  const sends = p.sends ? `, ${p.sends} sends` : "";
  const quad = p.quadrant ? ` ${QUADRANT_LABELS[p.quadrant]}` : "";
  return `- ${preview} (${date}, ${p.content_type}) — ${p.impressions.toLocaleString()} impressions, ${werStr} weighted ER, ${erStr} standard ER, ${p.reactions} reactions, ${p.comments} comments${saves}${sends}${quad}`;
}
```

- [ ] **Step 2: Use `formatPostLineDetailed` in `buildTopBottomSection`**

In `buildTopBottomSection()`, replace calls to `formatPostLine(p, timezone)` with `formatPostLineDetailed(p, timezone)` for the top 10 and bottom 10 lists (sections 4, 5, 5b, 6, 6b). Keep `formatPostLine` unchanged for other sections (format breakdown, recent standouts, etc.).

- [ ] **Step 3: Verify report still builds correctly**

Run the server and trigger an insights refresh, or use the inline script from Task 2 Step 3 to verify the report generates without errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/stats-report.ts
git commit -m "feat: expand top/bottom post detail with hook + closing text"
```

---

### Task 8: Update `insertPostMetrics` for `new_followers`

**Files:**
- Modify: `server/src/db/queries.ts:78-95` (insertPostMetrics)
- Modify: `server/src/schemas.ts:17-29` (postMetricsSchema)

- [ ] **Step 1: Add `new_followers` to Zod schema**

In `server/src/schemas.ts`, add to `postMetricsSchema`:

```typescript
new_followers: z.number().int().nullable().optional(),
```

- [ ] **Step 2: Add `new_followers` to INSERT query**

In `server/src/db/queries.ts`, update `insertPostMetrics` to include `new_followers` in both the column list and VALUES:

Add `new_followers` after `avg_watch_time_seconds` in the INSERT and VALUES clauses, and add `new_followers: metrics.new_followers ?? null` to the `.run()` parameter object.

- [ ] **Step 3: Update `loadPostsWithMetrics` in stats-report.ts**

In `server/src/ai/stats-report.ts:153-172`, add `pm.new_followers` to the SELECT statement in `loadPostsWithMetrics()`. Add `new_followers: number | null;` to the `PostRow` interface.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/queries.ts server/src/schemas.ts server/src/ai/stats-report.ts
git commit -m "feat: support new_followers in post_metrics ingest and stats report"
```

---

## Chunk 2: New API Endpoints

### Task 9: Topic Performance Endpoint

**Files:**
- Modify: `server/src/db/ai-queries.ts` (add query function)
- Modify: `server/src/routes/insights.ts:185` (add route)

- [ ] **Step 1: Add query function**

In `server/src/db/ai-queries.ts`, import shared helpers from stats-report and add after the existing `getCategoryPerformance` function:

```typescript
import { computeWeightedER, median } from "../ai/stats-report.js";

export interface TopicPerformance {
  topic: string;
  post_count: number;
  median_wer: number;
  median_impressions: number;
  median_comments: number;
}

export function getTopicPerformance(db: Database.Database, days?: number): TopicPerformance[] {
  const dateFilter = days ? `AND p.published_at > datetime('now', '-' || ? || ' days')` : "";
  const rows = db.prepare(
    `SELECT tax.name as topic,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_post_topics apt
     JOIN ai_taxonomy tax ON tax.id = apt.taxonomy_id
     JOIN posts p ON p.id = apt.post_id
     JOIN post_metrics pm ON pm.post_id = apt.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE pm.impressions > 0 ${dateFilter}`
  ).all(...(days ? [days] : [])) as Array<{
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
```

- [ ] **Step 2: Add route**

In `server/src/routes/insights.ts`, add after the sparkline endpoint (line ~185):

```typescript
app.get("/api/insights/deep-dive/topics", async (request) => {
  const q = request.query as { days?: string };
  const days = q.days ? parseInt(q.days, 10) || undefined : undefined;
  return { topics: getTopicPerformance(db, days) };
});
```

Add `getTopicPerformance` to the imports from `../db/ai-queries.js`.

- [ ] **Step 3: Test endpoint**

Run: `curl http://localhost:3210/api/insights/deep-dive/topics | jq .`

Expected: JSON with `topics` array containing topic names, post_count, median_wer, etc.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/ai-queries.ts server/src/routes/insights.ts
git commit -m "feat: add topic performance deep-dive endpoint"
```

---

### Task 10: Hook Type Performance Endpoint

**Files:**
- Modify: `server/src/db/ai-queries.ts`
- Modify: `server/src/routes/insights.ts`

- [ ] **Step 1: Add query function**

Uses `computeWeightedER` and `median` imported at top of file (from Task 9 Step 1).

```typescript
export interface HookPerformance {
  name: string;
  post_count: number;
  median_wer: number;
  median_impressions: number;
  median_comments: number;
}

export function getHookPerformance(db: Database.Database, days?: number): {
  by_hook_type: HookPerformance[];
  by_format_style: HookPerformance[];
} {
  const dateFilter = days ? `AND p.published_at > datetime('now', '-' || ? || ' days')` : "";
  const rows = db.prepare(
    `SELECT t.hook_type, t.format_style,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_tags t
     JOIN posts p ON p.id = t.post_id
     JOIN post_metrics pm ON pm.post_id = t.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE pm.impressions > 0 ${dateFilter}`
  ).all(...(days ? [days] : [])) as Array<{
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
```

- [ ] **Step 2: Add route**

```typescript
app.get("/api/insights/deep-dive/hooks", async (request) => {
  const q = request.query as { days?: string };
  const days = q.days ? parseInt(q.days, 10) || undefined : undefined;
  return getHookPerformance(db, days);
});
```

- [ ] **Step 3: Test and commit**

```bash
curl http://localhost:3210/api/insights/deep-dive/hooks | jq .
git add server/src/db/ai-queries.ts server/src/routes/insights.ts
git commit -m "feat: add hook type performance deep-dive endpoint"
```

---

### Task 11: Image Subtype Performance Endpoint

**Files:**
- Modify: `server/src/db/ai-queries.ts`
- Modify: `server/src/routes/insights.ts`

- [ ] **Step 1: Add query function**

Uses `computeWeightedER` and `median` imported at top of file (from Task 9 Step 1).

```typescript
export interface ImageSubtypePerformance {
  format: string;
  post_count: number;
  median_wer: number;
  median_impressions: number;
  median_comments: number;
}

export function getImageSubtypePerformance(db: Database.Database, days?: number): ImageSubtypePerformance[] {
  const dateFilter = days ? `AND p.published_at > datetime('now', '-' || ? || ' days')` : "";
  const rows = db.prepare(
    `SELECT ait.format,
            pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
     FROM ai_image_tags ait
     JOIN posts p ON p.id = ait.post_id
     JOIN post_metrics pm ON pm.post_id = ait.post_id
     JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
       ON pm.id = latest.max_id
     WHERE pm.impressions > 0
       AND ait.format IS NOT NULL ${dateFilter}`
  ).all(...(days ? [days] : [])) as Array<{
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
```

- [ ] **Step 2: Add route**

```typescript
app.get("/api/insights/deep-dive/image-subtypes", async (request) => {
  const q = request.query as { days?: string };
  const days = q.days ? parseInt(q.days, 10) || undefined : undefined;
  return { subtypes: getImageSubtypePerformance(db, days) };
});
```

- [ ] **Step 3: Test and commit**

```bash
curl http://localhost:3210/api/insights/deep-dive/image-subtypes | jq .
git add server/src/db/ai-queries.ts server/src/routes/insights.ts
git commit -m "feat: add image subtype performance deep-dive endpoint"
```

---

## Chunk 3: Chrome Extension Scraping

### Task 12: Chrome DevTools Inspection

This task must be done interactively using Chrome DevTools MCP tools.

- [ ] **Step 1: Inspect post detail analytics page for "New followers" field**

Navigate to a LinkedIn post's analytics detail page (the page that shows impressions, reactions, saves, sends, etc.). Use Chrome DevTools to identify:
- The exact text label for follower gains (e.g., "New followers", "Followers gained")
- The DOM selector path to this element
- Document the selector in a comment in the scraper code

- [ ] **Step 2: Inspect post page for comment section structure**

Navigate to a LinkedIn post's full page view. Use Chrome DevTools to identify:
- How author comments are distinguished (look for the author's name/profile link in comment elements)
- How threaded/nested replies are structured in the DOM (nested `.comments-comment-item` or similar)
- Document selectors

- [ ] **Step 3: Document findings**

Create a brief note in the PR or commit message with the selectors found. These will be used in the next task.

---

### Task 13: Extension — Scrape `new_followers` from Detail Page

**Files:**
- Modify: `extension/src/shared/types.ts:19-30` (scrapedPostMetricsSchema)
- Modify: `extension/src/content/scrapers.ts:118` (scrapePostDetail function)

- [ ] **Step 1: Add `new_followers` to Zod schema**

In `extension/src/shared/types.ts`, add to `scrapedPostMetricsSchema`:

```typescript
new_followers: z.number().int().nullable(),
```

- [ ] **Step 2: Add scraping logic to `scrapePostDetail()`**

In `extension/src/content/scrapers.ts`, inside `scrapePostDetail()`, add logic to find and parse the "New followers" metric using the selector identified in Task 12. Pattern will be similar to how saves/sends are scraped — find the label text, then extract the adjacent number.

- [ ] **Step 3: Verify extension builds**

Run: `cd /Users/nate/code/linkedin/extension && pnpm build`

- [ ] **Step 4: Commit**

```bash
git add extension/src/shared/types.ts extension/src/content/scrapers.ts
git commit -m "feat: scrape new_followers from LinkedIn post detail page"
```

---

### Task 14: Extension — Scrape Comment Stats from Post Page

**Files:**
- Modify: `extension/src/shared/types.ts:45-50` (scrapedPostContentSchema)
- Modify: `extension/src/content/scrapers.ts:195` (scrapePostPage function)
- Modify: `server/src/app.ts` (handle new fields in ingest or content endpoint)
- Create or modify: `server/src/db/queries.ts` (add upsertCommentStats function)

- [ ] **Step 1: Add fields to Zod schema**

In `extension/src/shared/types.ts`, add to `scrapedPostContentSchema`:

```typescript
author_replies: z.number().int().nullable().optional(),
has_threads: z.boolean().nullable().optional(),
```

- [ ] **Step 2: Add scraping logic to `scrapePostPage()`**

In `extension/src/content/scrapers.ts`, inside `scrapePostPage()`, add logic to:
1. Count comment elements where the author name matches the page author
2. Check for any nested/threaded reply elements

Use selectors identified in Task 12.

- [ ] **Step 3: Add `upsertCommentStats` to server queries**

In `server/src/db/queries.ts`, add:

```typescript
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
```

- [ ] **Step 4: Update service worker to extract and send comment stats**

The comment stats flow through the extension's service worker, NOT directly to the server. In `extension/src/background/service-worker.ts`, in the `scrapePostContent()` function (~line 410-484), after the full_text scrape, extract `author_replies` and `has_threads` from the scrape result and include them in the `ScrapedContent` return. Then in the caller that sends content to the server, include the comment stats in the API payload.

Also add a new server endpoint (or extend the existing upsert post endpoint) in `server/src/app.ts` to accept and persist comment stats using `upsertCommentStats`.

- [ ] **Step 5: Verify extension and server build**

```bash
cd /Users/nate/code/linkedin/extension && pnpm build
cd /Users/nate/code/linkedin/server && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add extension/src/shared/types.ts extension/src/content/scrapers.ts extension/src/background/service-worker.ts server/src/db/queries.ts server/src/app.ts server/src/schemas.ts
git commit -m "feat: scrape comment threading stats from LinkedIn post pages"
```

---

## Chunk 4: Coach Tab Restructure

### Task 15: Client API Types + Fetch Functions

**Files:**
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add types for new endpoints**

```typescript
export interface TopicPerformance {
  topic: string;
  post_count: number;
  median_wer: number;
  median_impressions: number;
  median_comments: number;
}

export interface HookPerformance {
  name: string;
  post_count: number;
  median_wer: number;
  median_impressions: number;
  median_comments: number;
}

export interface ImageSubtypePerformance {
  format: string;
  post_count: number;
  median_wer: number;
  median_impressions: number;
  median_comments: number;
}
```

- [ ] **Step 2: Add fetch functions**

```typescript
deepDiveTopics: (days?: number) =>
  fetch(`${BASE}/api/insights/deep-dive/topics${days ? `?days=${days}` : ""}`)
    .then((r) => r.json() as Promise<{ topics: TopicPerformance[] }>),

deepDiveHooks: (days?: number) =>
  fetch(`${BASE}/api/insights/deep-dive/hooks${days ? `?days=${days}` : ""}`)
    .then((r) => r.json() as Promise<{ by_hook_type: HookPerformance[]; by_format_style: HookPerformance[] }>),

deepDiveImageSubtypes: (days?: number) =>
  fetch(`${BASE}/api/insights/deep-dive/image-subtypes${days ? `?days=${days}` : ""}`)
    .then((r) => r.json() as Promise<{ subtypes: ImageSubtypePerformance[] }>),
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add client types and fetch functions for new deep-dive endpoints"
```

---

### Task 16: Coach Tab — Rename Tabs + Move Sparklines to Overview

**Files:**
- Modify: `dashboard/src/pages/Coach.tsx:894-898` (tab definitions)
- Modify: `dashboard/src/pages/Coach.tsx` (Overview tab content)

- [ ] **Step 1: Rename tabs**

Change the tab definitions at line ~894:

```typescript
const tabs: { key: CoachTab; label: string; count?: number }[] = [
  { key: "actions", label: "Overview", count: activeRecs.length || undefined },
  { key: "insights", label: "Insights" },
  { key: "deep-dive", label: "Breakdowns" },
];
```

The `CoachTab` type and state keys stay the same internally — only the user-facing labels change.

- [ ] **Step 2: Add KPI cards + sparklines to the Overview (actions) tab**

The `ActionsTab` component currently only shows recommendations. Refactor it to show:
1. A KPI row at the top using progress data (move from DeepDiveTab)
2. Top 3 recent posts (using sparkline data sorted by weighted ER)
3. 1-3 surfaced insights (first 3 from insights array)
4. Existing recommendations below

This requires passing `progress`, `sparklinePoints`, and `insights` data to the ActionsTab (or the Overview section).

- [ ] **Step 3: Remove sparklines from DeepDiveTab**

Since progress sparklines moved to Overview, remove them from the DeepDiveTab to avoid duplication.

- [ ] **Step 4: Verify dashboard renders**

Run: `cd /Users/nate/code/linkedin/dashboard && pnpm dev`

Check that the Coach page loads with "Overview", "Insights", "Breakdowns" tabs and that the Overview tab shows KPIs + recommendations.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/Coach.tsx
git commit -m "feat: rename Coach tabs and add KPI overview with sparklines"
```

---

### Task 17: Breakdowns Tab — Add Cross-Analysis Tables

**Files:**
- Modify: `dashboard/src/pages/Coach.tsx` (DeepDiveTab section)

- [ ] **Step 1: Load new data in Coach component**

Add state and useEffect calls to load topic, hook, and image subtype data:

```typescript
const [topics, setTopics] = useState<TopicPerformance[]>([]);
const [hooks, setHooks] = useState<{ by_hook_type: HookPerformance[]; by_format_style: HookPerformance[] }>({ by_hook_type: [], by_format_style: [] });
const [imageSubtypes, setImageSubtypes] = useState<ImageSubtypePerformance[]>([]);
```

Fetch in the existing useEffect alongside other data loads.

- [ ] **Step 2: Add Topic Performance table to DeepDiveTab**

A simple sorted table: Topic | Posts | Median WER | Median Impressions | Median Comments. Best performer row highlighted. Use existing table styling from the categories table.

- [ ] **Step 3: Add Hook Type Performance table**

Two sub-tables: "By hook type" and "By format style". Same column structure as topics.

- [ ] **Step 4: Add Image Subtype Performance table (conditional)**

Only render if `imageSubtypes.length > 0`. Same table format.

- [ ] **Step 5: Add Timing Grid**

A simple day × time-window grid using existing timing data from `queryTiming`. Each cell shows median WER with background color intensity based on value (simple inline style, not a complex chart library). Days as rows, time windows as columns.

- [ ] **Step 6: Verify all tables render**

Check the Breakdowns tab shows all new tables populated with data.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/pages/Coach.tsx dashboard/src/api/client.ts
git commit -m "feat: add cross-analysis breakdown tables to Coach Breakdowns tab"
```

---

### Task 18: Final Verification

- [ ] **Step 1: Run full type check**

```bash
cd /Users/nate/code/linkedin/server && npx tsc --noEmit
cd /Users/nate/code/linkedin/dashboard && npx tsc --noEmit
cd /Users/nate/code/linkedin/extension && pnpm build
```

All should pass with no errors.

- [ ] **Step 2: Trigger insights refresh and verify gaps cleared**

1. Open the dashboard
2. Go to Coach → Insights tab
3. Click "Refresh AI"
4. After refresh completes, check the Analysis Gaps section
5. Verify phantom gaps about "truncated post text", "no topic tagging", "no hook classification", "no image subtype data", "no follower growth data" are gone

- [ ] **Step 3: Verify new sections in stats report**

Check the AI logs (Coach → Insights → look at latest run) to confirm the stats report now includes sections 0, 14, 15, 16, 17 with real data.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for analysis gap fix"
```
