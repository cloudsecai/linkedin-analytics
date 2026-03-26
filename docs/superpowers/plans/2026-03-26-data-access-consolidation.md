# Data Access Consolidation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate inline `db.prepare()` calls scattered across AI modules by moving them into typed query helpers in the appropriate query files.

**Scope:** 4 AI modules contain 20 total inline `db.prepare()` calls that should be consolidated:
- `server/src/ai/auto-retro.ts` — 5 inline `db.prepare()` calls (plus 2 calls already using helpers: `getUnmatchedGenerations`, `getRules`)
- `server/src/ai/stats-report.ts` — 13 inline `db.prepare()` calls across 8 functions
- `server/src/ai/taxonomy.ts` — 1 inline `db.prepare()` call (conditional query with two branches)
- `server/src/ai/video-transcriber.ts` — 1 inline `db.prepare()` call (writes to `full_text`, not `video_transcript`)

**Architecture:** Each query function lives in the module closest to its domain — generation queries in `server/src/db/generate-queries.ts`, AI pipeline queries in `server/src/db/ai-queries.ts`, post queries in `server/src/db/queries.ts`. There is no `server/src/db/ai/` directory — all AI query helpers live in `server/src/db/ai-queries.ts`.

**IMPORTANT — Circular dependency constraint:** `server/src/db/ai-queries.ts` imports `{ computeWeightedER, median }` from `../ai/stats-report.js`. If `stats-report.ts` then imports from `ai-queries.ts`, you get a cycle: `stats-report.ts` -> `ai-queries.ts` -> `stats-report.ts`. Therefore, the 13 stats-report query helpers go into a **new file** `server/src/db/stats-queries.ts` which does pure SQL queries and has NO imports from any `ai/` module. The `PostRow` type lives in `server/src/db/queries.ts` (where post-related types belong) and is imported by both `stats-queries.ts` and `stats-report.ts`.

**Tech Stack:** Fastify v5, better-sqlite3, TypeScript ESM (`.js` import extensions), Vitest

---

### Task 1: Add `getPostForRetro()` to `queries.ts`

**Why:** `auto-retro.ts` (line 84-89) queries a post with `full_text IS NOT NULL` filter and selects `id`, `full_text`, and `published_at`. This is specific enough to warrant its own helper rather than reusing a generic getter.

**Files:**
- Modify: `server/src/db/queries.ts`
- Modify: test file for queries

**Actual inline SQL being replaced** (from `auto-retro.ts` lines 84-89):
```ts
db.prepare(
  "SELECT id, full_text, published_at FROM posts WHERE id = ? AND full_text IS NOT NULL"
).get(postId) as { id: string; full_text: string; published_at: string } | undefined;
```

- [ ] **Step 1: Add the function.** Append to `server/src/db/queries.ts`:
  ```ts
  export function getPostForRetro(db: Database.Database, postId: string): { id: string; full_text: string; published_at: string } | undefined {
    return db.prepare(
      "SELECT id, full_text, published_at FROM posts WHERE id = ? AND full_text IS NOT NULL"
    ).get(postId) as { id: string; full_text: string; published_at: string } | undefined;
  }
  ```
  Note: The `IS NOT NULL` filter is intentional — auto-retro skips posts without text content. The `published_at` column is selected because it exists in the actual query.

- [ ] **Step 2: Write a test.** Insert a post with `full_text` set and assert `getPostForRetro` returns `{ id, full_text, published_at }`. Insert a post with `full_text = NULL` and assert it returns `undefined`. Assert `undefined` for unknown IDs.

- [ ] **Step 3: Run tests.**
  ```bash
  pnpm test -- --run
  ```

- [ ] **Step 4: Commit.**
  ```
  feat(db): add getPostForRetro to queries
  ```

---

### Task 2: Add `isPostMatchedToGeneration()` to `generate-queries.ts`

**Why:** `auto-retro.ts` (lines 94-97) checks whether a post is already matched to a generation. This is a check-then-write pattern.

**Actual inline SQL being replaced** (from `auto-retro.ts` lines 94-96):
```ts
const alreadyMatched = db
  .prepare("SELECT id FROM generations WHERE matched_post_id = ?")
  .get(post.id);
```

**Files:**
- Modify: `server/src/db/generate-queries.ts`
- Modify: `server/src/db/generate-queries.test.ts` (or create if absent)

- [ ] **Step 1: Add the function.** Append to `server/src/db/generate-queries.ts`:
  ```ts
  export function isPostMatchedToGeneration(db: Database.Database, postId: string): boolean {
    const row = db.prepare("SELECT id FROM generations WHERE matched_post_id = ?").get(postId);
    return row !== undefined;
  }
  ```

  **Note on race condition (check-then-write):** This checks if a post is matched, then the caller later calls `updateGeneration` to set `matched_post_id`. In SQLite with WAL mode, there is only ever a single writer — concurrent write transactions are serialized by SQLite's locking, so a TOCTOU race between check and write cannot occur. Two concurrent `runAutoRetro` calls would execute their write transactions sequentially. If we ever move to a multi-writer database (e.g., Postgres), this pattern would need a `UPDATE generations SET matched_post_id = ? WHERE id = ? AND matched_post_id IS NULL` guard to make the match atomic.

- [ ] **Step 2: Write a test.** Insert a generation row with `matched_post_id` set and assert `isPostMatchedToGeneration` returns `true`. Assert `false` for an unmatched post ID.

- [ ] **Step 3: Run tests.**
  ```bash
  pnpm test -- --run
  ```

- [ ] **Step 4: Commit.**
  ```
  feat(db): add isPostMatchedToGeneration to generate-queries
  ```

---

### Task 3: Extend `updateGeneration()` to support `published_text` and fix `prompt_snapshot` type

**Why:** `auto-retro.ts` (lines 117-119) writes `published_text` using raw SQL because `updateGeneration` doesn't allow it. The function uses a runtime `ALLOWED_COLUMNS` whitelist (a `Set`), so adding the field to the TypeScript type alone is insufficient. Additionally, `prompt_snapshot` is already in the `ALLOWED_COLUMNS` Set but is missing from the TypeScript type — fix both at once.

**Actual inline SQL being replaced** (from `auto-retro.ts` lines 117-119):
```ts
db.prepare(
  "UPDATE generations SET published_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
).run(post.full_text, matchId);
```

**Current `updateGeneration` implementation details:**
- Signature: `updateGeneration(db: Database, id: number, updates: Partial<{...}>): void`
- Uses a dynamic SET clause built from an `ALLOWED_COLUMNS` `Set` (line 263-268 of `generate-queries.ts`)
- Current `ALLOWED_COLUMNS` Set: `selected_draft_indices`, `combining_guidance`, `final_draft`, `quality_gate_json`, `status`, `matched_post_id`, `total_input_tokens`, `total_output_tokens`, `total_cost_cents`, `prompt_snapshot`
- Current TypeScript type is missing `prompt_snapshot` (present in Set but not in type) — this means callers can pass `prompt_snapshot` at runtime but get no type-checking
- Keys not in the `Set` are silently dropped at runtime

**Files:**
- Modify: `server/src/db/generate-queries.ts`
- Modify: test file

- [ ] **Step 1: Add `published_text` and `prompt_snapshot` to the TypeScript type, and add `published_text` to `ALLOWED_COLUMNS`.** In `updateGeneration`:
  - Add `published_text: string;` to the `Partial<{...}>` type parameter
  - Add `prompt_snapshot: string;` to the `Partial<{...}>` type parameter (already in Set, missing from type)
  - Add `"published_text"` to the `ALLOWED_COLUMNS` `Set` initializer

- [ ] **Step 2: Write a test.** Call `updateGeneration(db, id, { published_text: "hello" })` and assert the row reflects the new value and that `updated_at` was bumped.

- [ ] **Step 3: Run tests.**
  ```bash
  pnpm test -- --run
  ```

- [ ] **Step 4: Commit.**
  ```
  feat(db): support published_text in updateGeneration, add prompt_snapshot to type
  ```

---

### Task 4: Add `updatePostTranscript()` and replace inline call in `video-transcriber.ts`

**Why:** `video-transcriber.ts` (lines 178-180) writes the transcript to the `full_text` column (NOT a `video_transcript` column — that column does not exist). The UPDATE is conditional, only overwriting when the existing `full_text` is null, matches `hook_text`, or is short.

**Actual inline SQL being replaced** (from `video-transcriber.ts` lines 178-180):
```ts
db.prepare(
  `UPDATE posts SET full_text = ? WHERE id = ? AND (full_text IS NULL OR full_text = hook_text OR length(full_text) < 100)`
).run(transcript, postId);
```

**Files:**
- Modify: `server/src/db/queries.ts` (post mutations live here)
- Modify: `server/src/ai/video-transcriber.ts`
- Modify: relevant test file

- [ ] **Step 1: Add the function.** In `server/src/db/queries.ts`:
  ```ts
  export function updatePostTranscript(db: Database.Database, postId: string, transcript: string): void {
    db.prepare(
      "UPDATE posts SET full_text = ? WHERE id = ? AND (full_text IS NULL OR full_text = hook_text OR length(full_text) < 100)"
    ).run(transcript, postId);
  }
  ```
  Note: This writes to `full_text`, not `video_transcript`. The conditional WHERE clause prevents overwriting manually-entered full text.

- [ ] **Step 2: Replace inline call in `video-transcriber.ts`.** Import `updatePostTranscript` from `../db/queries.js` (ESM `.js` extension) and replace the `db.prepare(...)` call at line 178 with `updatePostTranscript(db, postId, transcript)`.

- [ ] **Step 3: Write a test.** Insert a post with `full_text = NULL`, call `updatePostTranscript`, assert `full_text` is set. Insert a post with `full_text` set to a long string (>100 chars), call `updatePostTranscript`, assert it was NOT overwritten.

- [ ] **Step 4: Run tests.**
  ```bash
  pnpm test -- --run
  ```

- [ ] **Step 5: Commit.**
  ```
  feat(db): add updatePostTranscript (writes to full_text), remove inline SQL from video-transcriber
  ```

---

### Task 5: Move `PostRow` to `queries.ts`; create `stats-queries.ts` with stats report query helpers; replace calls in `stats-report.ts`

**Why:** `stats-report.ts` contains 13 inline `db.prepare()` calls spread across 8 functions. These need to be extracted, but they CANNOT go into `ai-queries.ts` due to a circular dependency: `ai-queries.ts` imports `{ computeWeightedER, median }` from `stats-report.ts`. If `stats-report.ts` then imports from `ai-queries.ts`, ESM will fail at runtime with partially-initialized modules.

**Solution:** Create a new file `server/src/db/stats-queries.ts` that contains pure SQL query helpers with no imports from `ai/` modules. Move `PostRow` from `stats-report.ts` to `queries.ts` (where post types belong) so both `stats-queries.ts` and `stats-report.ts` can import it without cycles.

**Full inventory of inline `db.prepare()` calls in `stats-report.ts`:**

| # | Function | Line(s) | Query Description |
|---|----------|---------|-------------------|
| 1 | `loadPostsWithMetrics` | 156 | Big SELECT joining posts + post_metrics with latest-metric subquery |
| 2 | `buildOverviewSection` | 212 | SELECT total_followers FROM follower_snapshots (latest) |
| 3 | `buildContentGapsSection` | 634 | COUNT posts WHERE full_text IS NULL |
| 4 | `buildContentGapsSection` | 637 | COUNT all posts |
| 5 | `buildContentGapsSection` | 640 | COUNT image posts without ai_image_tags |
| 6 | `buildDataAvailablePreamble` | 677 | COUNT ai_tags |
| 7 | `buildDataAvailablePreamble` | 678 | COUNT DISTINCT taxonomy_id in ai_post_topics |
| 8 | `buildDataAvailablePreamble` | 679 | COUNT DISTINCT post_id in ai_image_tags |
| 9 | `buildDataAvailablePreamble` | 680 | COUNT follower_snapshots |
| 10 | `buildTopicPerformanceSection` | 694 | JOIN ai_post_topics + ai_taxonomy + post_metrics |
| 11 | `buildHookPerformanceSection` | 746 | JOIN ai_tags + post_metrics |
| 12 | `buildImageSubtypeSection` | 804 | JOIN ai_image_tags + post_metrics |
| 13 | `buildFollowerGrowthSection` | 843 | SELECT follower_snapshots LIMIT 90 |

**The 3 complex JOIN queries (exact SQL):**

Query #10 — Topic performance (line 694):
```sql
SELECT tax.name as topic,
        pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
 FROM ai_post_topics apt
 JOIN ai_taxonomy tax ON tax.id = apt.taxonomy_id
 JOIN post_metrics pm ON pm.post_id = apt.post_id
 JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
   ON pm.id = latest.max_id
 WHERE pm.impressions > 0
```

Query #11 — Hook/style performance (line 746):
```sql
SELECT t.hook_type, t.format_style,
        pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
 FROM ai_tags t
 JOIN post_metrics pm ON pm.post_id = t.post_id
 JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
   ON pm.id = latest.max_id
 WHERE pm.impressions > 0
```

Query #12 — Image subtype performance (line 804):
```sql
SELECT ait.format as subtype,
        pm.impressions, pm.reactions, pm.comments, pm.reposts, pm.saves, pm.sends
 FROM ai_image_tags ait
 JOIN post_metrics pm ON pm.post_id = ait.post_id
 JOIN (SELECT post_id, MAX(id) as max_id FROM post_metrics GROUP BY post_id) latest
   ON pm.id = latest.max_id
 WHERE pm.impressions > 0
   AND ait.format IS NOT NULL
```

**Files:**
- Create: `server/src/db/stats-queries.ts` (new file — pure SQL, no `ai/` imports)
- Modify: `server/src/db/queries.ts` (add `PostRow` type here)
- Modify: `server/src/ai/stats-report.ts` (remove `PostRow` definition, import from queries; import helpers from stats-queries)
- Modify: `server/src/db/ai-queries.ts` (update import of `PostRow` if it was using it from stats-report — currently it does not, but verify)
- Modify: relevant test file

- [ ] **Step 1: Move `PostRow` to `queries.ts`.** Cut the `PostRow` interface from `stats-report.ts` (lines 5-19) and add it to `server/src/db/queries.ts`. Update `stats-report.ts` to import `PostRow` from `../db/queries.js`. Keep `PostWithER` in `stats-report.ts` (it extends `PostRow` with computed fields and is only used there).

- [ ] **Step 2: Create `server/src/db/stats-queries.ts`.** This file imports ONLY `better-sqlite3` types and `PostRow` from `./queries.js`. It has NO imports from any `ai/` module. Add:

  ```ts
  import type Database from "better-sqlite3";
  import type { PostRow } from "./queries.js";

  // Data availability counts (for buildDataAvailablePreamble)
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

  // Content gaps (for buildContentGapsSection)
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

  // Posts with latest metrics (for loadPostsWithMetrics)
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

  // Latest follower count (for buildOverviewSection)
  export function getLatestFollowerCount(db: Database.Database): number | null {
    const row = db.prepare(
      "SELECT total_followers FROM follower_snapshots ORDER BY date DESC LIMIT 1"
    ).get() as { total_followers: number } | undefined;
    return row?.total_followers ?? null;
  }

  // Follower snapshots (for buildFollowerGrowthSection)
  export function getFollowerSnapshots(db: Database.Database, limit: number): Array<{ date: string; total_followers: number }> {
    return db.prepare(
      "SELECT date, total_followers FROM follower_snapshots ORDER BY date DESC LIMIT ?"
    ).all(limit) as Array<{ date: string; total_followers: number }>;
  }
  ```

- [ ] **Step 3: Add topic performance query helper.** In `server/src/db/stats-queries.ts`:
  ```ts
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
  ```

- [ ] **Step 4: Add hook/style performance query helper.** In `server/src/db/stats-queries.ts`:
  ```ts
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
  ```

- [ ] **Step 5: Add image subtype performance query helper.** In `server/src/db/stats-queries.ts`:
  ```ts
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
  ```

- [ ] **Step 6: Replace all 13 inline calls in `stats-report.ts`.** Import the new helpers from `../db/stats-queries.js` (ESM `.js` extension) and swap each `db.prepare(...)` block. Functions that currently accept `db` as a parameter and only used it for these queries can have `db` replaced with the pre-fetched data.

- [ ] **Step 7: Write tests** for each new helper in `stats-queries.ts`.

- [ ] **Step 8: Run tests.**
  ```bash
  pnpm test -- --run
  ```

- [ ] **Step 9: Commit.**
  ```
  feat(db): create stats-queries.ts, move PostRow to queries.ts, remove 13 inline SQL calls from stats-report
  ```

---

### Task 6: Add `getPostsForTaxonomy()` to `ai-queries.ts`; replace inline call in `taxonomy.ts`

**Why:** `taxonomy.ts` (line 29) has one `db.prepare()` call, but it's a conditional query with two branches — one for incremental updates (untagged posts only) and one for full discovery (all posts). This query does NOT touch `stats-report.ts` exports, so it is safe to place in `ai-queries.ts` without creating a circular dependency.

**Actual inline SQL being replaced** (from `taxonomy.ts` lines 20-29):
```ts
const query = existingTaxonomy && existingTaxonomy.length > 0
  ? `SELECT p.id, COALESCE(SUBSTR(p.full_text, 1, 300), p.content_preview) as summary
     FROM posts p
     LEFT JOIN ai_post_topics apt ON apt.post_id = p.id
     WHERE apt.post_id IS NULL
     ORDER BY p.published_at DESC`
  : `SELECT id, COALESCE(SUBSTR(full_text, 1, 300), content_preview) as summary
     FROM posts ORDER BY published_at DESC`;

const posts = db.prepare(query).all() as { id: string; summary: string | null }[];
```

**Important:** This query does NOT take a `personaId` parameter. Neither branch filters by persona.

**Files:**
- Modify: `server/src/db/ai-queries.ts`
- Modify: `server/src/ai/taxonomy.ts`
- Modify: relevant test file

- [ ] **Step 1: Add the function.** In `server/src/db/ai-queries.ts`:
  ```ts
  export function getPostsForTaxonomy(
    db: Database.Database,
    incrementalOnly: boolean
  ): Array<{ id: string; summary: string | null }> {
    const query = incrementalOnly
      ? `SELECT p.id, COALESCE(SUBSTR(p.full_text, 1, 300), p.content_preview) as summary
         FROM posts p
         LEFT JOIN ai_post_topics apt ON apt.post_id = p.id
         WHERE apt.post_id IS NULL
         ORDER BY p.published_at DESC`
      : `SELECT id, COALESCE(SUBSTR(full_text, 1, 300), content_preview) as summary
         FROM posts ORDER BY published_at DESC`;
    return db.prepare(query).all() as Array<{ id: string; summary: string | null }>;
  }
  ```
  Note: No `personaId` parameter — the actual query doesn't filter by persona.

- [ ] **Step 2: Replace inline call in `taxonomy.ts`.** Import `getPostsForTaxonomy` from `../db/ai-queries.js` and replace lines 20-29 with:
  ```ts
  const incrementalOnly = !!(existingTaxonomy && existingTaxonomy.length > 0);
  const posts = getPostsForTaxonomy(db, incrementalOnly);
  ```

- [ ] **Step 3: Write a test.** Insert posts, assert `getPostsForTaxonomy(db, false)` returns all. Insert topic mappings for some posts, assert `getPostsForTaxonomy(db, true)` returns only unmapped ones.

- [ ] **Step 4: Run tests.**
  ```bash
  pnpm test -- --run
  ```

- [ ] **Step 5: Commit.**
  ```
  feat(db): add getPostsForTaxonomy, remove inline SQL from taxonomy
  ```

---

### Task 7: Refactor `auto-retro.ts` — replace all inline queries with helpers

**Why:** After Tasks 1-3, all the helpers needed by `auto-retro.ts` exist. This task wires them in.

**Current inline `db.prepare()` calls in `auto-retro.ts`:**

| # | Line(s) | Query | Replacement |
|---|---------|-------|-------------|
| 1 | 77-81 | `SELECT value FROM settings WHERE key = 'writing_prompt'` | `getSetting(db, "writing_prompt")` from `ai-queries.ts` — already exists |
| 2 | 84-89 | `SELECT id, full_text, published_at FROM posts WHERE id = ? AND full_text IS NOT NULL` | `getPostForRetro(db, postId)` from Task 1 |
| 3 | 94-96 | `SELECT id FROM generations WHERE matched_post_id = ?` | `isPostMatchedToGeneration(db, post.id)` from Task 2 |
| 4 | 117-119 | `UPDATE generations SET published_text = ? ... WHERE id = ?` | `updateGeneration(db, matchId, { published_text: post.full_text })` — works after Task 3 |
| 5 | 130-132 | `UPDATE generations SET retro_json = ?, retro_at = ... WHERE id = ?` | `completeRetro(db, matchId, JSON.stringify(analysis))` — already exists |

**Critical detail on `completeRetro`:** The existing `completeRetro` function (line 605-608 of `generate-queries.ts`) expects `retroJson` as a **string** (pre-serialized JSON), not an object. The caller must pass `JSON.stringify(analysis)`, not `analysis` directly.

**Files:**
- Modify: `server/src/ai/auto-retro.ts`

- [ ] **Step 1: Update imports in `auto-retro.ts`.** Add imports for:
  - `getPostForRetro` from `../db/queries.js`
  - `isPostMatchedToGeneration` from `../db/generate-queries.js`
  - `completeRetro` from `../db/generate-queries.js` (already imports `updateGeneration` and `getUnmatchedGenerations`)
  - `getSetting` from `../db/ai-queries.js`

- [ ] **Step 2: Replace query 1 — writing prompt** (lines 77-81).
  Replace:
  ```ts
  const writingPrompt = (
    db
      .prepare("SELECT value FROM settings WHERE key = 'writing_prompt'")
      .get() as { value: string } | undefined
  )?.value;
  ```
  With:
  ```ts
  const writingPrompt = getSetting(db, "writing_prompt");
  ```
  Note: `getSetting` already returns `string | null`, which matches the existing usage.

- [ ] **Step 3: Replace query 2 — post with text** (lines 84-89).
  Replace the `db.prepare("SELECT id, full_text, published_at ...")` block with:
  ```ts
  const post = getPostForRetro(db, postId);
  ```

- [ ] **Step 4: Replace query 3 — already matched check** (lines 94-96).
  Replace:
  ```ts
  const alreadyMatched = db
    .prepare("SELECT id FROM generations WHERE matched_post_id = ?")
    .get(post.id);
  if (alreadyMatched) continue;
  ```
  With:
  ```ts
  if (isPostMatchedToGeneration(db, post.id)) continue;
  ```

- [ ] **Step 5: Replace query 4 — update published_text** (lines 117-119).
  Replace:
  ```ts
  db.prepare(
    "UPDATE generations SET published_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(post.full_text, matchId);
  ```
  With:
  ```ts
  updateGeneration(db, matchId, { published_text: post.full_text });
  ```
  This works because Task 3 added `published_text` to both the type and the `ALLOWED_COLUMNS` Set.

- [ ] **Step 6: Replace query 5 — store retro** (lines 130-132).
  Replace:
  ```ts
  db.prepare(
    "UPDATE generations SET retro_json = ?, retro_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(JSON.stringify(analysis), matchId);
  ```
  With:
  ```ts
  completeRetro(db, matchId, JSON.stringify(analysis));
  ```
  **Important:** Pass `JSON.stringify(analysis)`, not `analysis`. The `completeRetro` signature is `(db, generationId: number, retroJson: string)` — it expects a pre-serialized JSON string.

- [ ] **Step 7: Run tests.**
  ```bash
  pnpm test -- --run
  ```

- [ ] **Step 8: Commit.**
  ```
  refactor: replace all inline SQL in auto-retro with query helpers
  ```

---

### Task 8: Final full test suite run and type-check

**Files:** None modified.

- [ ] **Step 1: Run full test suite.**
  ```bash
  pnpm test -- --run
  ```
  All tests must pass.

- [ ] **Step 2: Run server type-check.**
  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  ```
  Zero errors.

- [ ] **Step 3: Verify no remaining inline db.prepare calls in target files.** Spot-check `auto-retro.ts`, `video-transcriber.ts`, `stats-report.ts`, and `taxonomy.ts` to confirm no stray `db.prepare(` lines remain (except in `video-transcriber.ts`'s `getPostsNeedingTranscription` which is already a properly-scoped exported function, not an inline call in business logic).

- [ ] **Step 4: Commit.**
  ```
  chore: data access consolidation complete — all inline SQL moved to query helpers
  ```
