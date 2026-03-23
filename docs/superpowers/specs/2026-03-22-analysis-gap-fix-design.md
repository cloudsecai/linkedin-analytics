# Analysis Gap Fix & Coach Restructure

**Date:** 2026-03-22
**Status:** Approved

## Problem

The AI insights pipeline generates ~25 analysis gaps (data_gap, tool_gap, knowledge_gap) that flag missing data. ~70% of these are phantom gaps — the data exists in the database but isn't included in the stats report sent to the LLM. The remaining gaps are either genuinely missing data or unfixable LinkedIn API limitations.

Additionally, the Coach tab structure doesn't follow analytics dashboard best practices: the landing view shows only recommendations, with no scannable KPIs, trends, or top posts.

## Scope

1. **Stats report enrichment** — Feed existing AI tags, topics, image subtypes, and follower growth into the LLM analysis prompt
2. **Stale gap cleanup** — Clear phantom gaps from the database after enrichment
3. **New data collection** — Chrome extension scrapes per-post follower gains and comment threading stats
4. **New API endpoints** — Topic, hook type, and image subtype performance breakdowns
5. **Coach tab restructure** — Rename tabs, add KPI overview, add breakdown tables

## Non-goals

- See-more click rates (LinkedIn doesn't expose)
- Repost source quality / commenter seniority (not exposed)
- Full comment scraper with individual commenter profiles
- Complex visualization charts (scatter plots, heatmaps beyond simple tables)

---

## Design

### 1. Stats Report Enrichment

Add four new sections to `buildStatsReport()` in `server/src/ai/stats-report.ts`:

**Section 14 — Topic Performance**
- Join `ai_post_topics` + `ai_taxonomy` + `post_metrics`
- For each topic: name, post count, median weighted ER, median impressions
- Include topic concentration metric (% of posts covered by top 3 topics)

**Section 15 — Hook Type & Structure Performance**
- Join `ai_tags` + `post_metrics`
- Group by `hook_type`: post count, median weighted ER, median impressions
- Group by `format_style`: same metrics
- Flag best/worst performers

**Section 16 — Image Subtype Performance**
- Join `ai_image_tags` + `post_metrics` (image posts only)
- Group by `ai_image_tags.format`: post count, median weighted ER
- Only include if image posts with tags exist

**Section 17 — Follower Growth Trend**
- Query `follower_snapshots` for last 90 days
- Show: current, 30-day-ago, 90-day-ago with deltas
- Average new followers per week (last 30 days)
- Handle non-consecutive dates gracefully (diff between available snapshots, not assumed daily)

**Section 0 — Data Available preamble**
- Add a preamble at the top of the report listing what data is available
- Explicitly tells the LLM not to flag these as gaps:
  - AI tags (hook_type, tone, format_style, post_category) for all posts
  - Topic taxonomy mapping via ai_post_topics
  - Image subtype classification via ai_image_tags
  - Daily follower snapshots
  - Hook text and closing text for top/bottom performers

**Expand post detail for top/bottom 10:**
- Change `formatPostLine()` for top 10 and bottom 10 sections to include hook text (first ~2 sentences) + closing sentence
- Keep 80-char preview for all other sections (format breakdown, day/time, etc.)
- This gives the LLM enough to analyze hook patterns and ending quality without token bloat

### 2. Stale Gap Cleanup

**Migration:** Add a SQL migration that deletes all existing `analysis_gaps` rows:
```sql
DELETE FROM ai_analysis_gaps;
```

**Ongoing behavior:** The existing `upsertAnalysisGap` with `times_flagged` tracking continues to work. After the enriched report runs, the LLM will only flag genuinely missing data. Phantom gaps won't recur because the LLM now sees the data.

### 3. New Data Collection (Chrome Extension)

**Per-post follower gains:**
- The detail page scraper already visits LinkedIn post analytics pages for saves/sends
- Add scraping for "New followers" metric from the same page
- Use Chrome DevTools to identify exact selectors/labels before implementation
- Add `new_followers` INTEGER column to `post_metrics` table
- Update `loadPostsWithMetrics()` in stats-report.ts to SELECT `new_followers`
- Include in stats report top/bottom post lines

**Comment threading stats:**
- When the extension visits a post's full page (already done for full_text scraping), also capture:
  - Number of author replies (comments where author name matches)
  - Whether threaded replies exist (nested reply elements present)
- Use Chrome DevTools to identify exact comment section selectors
- New table: `post_comment_stats` (post_id TEXT PK, author_replies INTEGER, has_threads BOOLEAN, scraped_at DATETIME)
- NOT capturing: individual commenter identity, reply timestamps, commenter seniority
- Update `ScrapedPostContent` type and Zod schema in `extension/src/shared/types.ts` to include new fields
- Server-side handler that receives `post-content` messages must persist to `post_comment_stats`

### 4. New API Endpoints

Three new endpoints following existing pattern in `server/src/routes/insights.ts`. All accept optional `?days=N` query parameter (default: all time) matching existing deep-dive endpoints:

**`GET /api/insights/deep-dive/topics`**
- Join `ai_post_topics` + `ai_taxonomy` + `post_metrics`
- Return: topic name, post_count, median_wer, median_impressions, median_comments

**`GET /api/insights/deep-dive/hooks`**
- Join `ai_tags` + `post_metrics`
- Return two arrays: by_hook_type and by_format_style
- Each: type/style name, post_count, median_wer, median_impressions, median_comments

**`GET /api/insights/deep-dive/image-subtypes`**
- Join `ai_image_tags` + `post_metrics` (image posts only)
- Return: format name, post_count, median_wer, median_impressions, median_comments

### 5. Coach Tab Restructure

**Tab rename and reorder:**
- "Actions" → **"Overview"** (landing tab)
- "Insights" → stays as-is
- "Deep Dive" → **"Breakdowns"**

**Overview tab (redesigned):**
1. KPI row — 4-5 cards with sparklines: Median ER (trend), Total Impressions (trend), Followers (trend), Post Count, Avg Comments. Progress sparklines move here from current Deep Dive.
2. Top 3 recent posts — ranked by weighted ER, click-to-expand for full text
3. 1-3 surfaced insights — plain-language callouts from existing insights data
4. Recommendations — existing recommendation cards move below KPIs

**Insights tab (unchanged):**
- Quick insights, changelog, analysis gaps, timing recommendations

**Breakdowns tab (expanded):**
Existing:
- Content opportunities table
- Engagement quality metrics

New additions:
- Topic × Performance table — topic, post count, median WER, median impressions, trend direction
- Hook Type × Performance table — hook_type, post count, median WER
- Image Subtype × Performance table — format, post count, median WER (conditional on data existing)
- Timing grid — day × time window matrix showing median WER (simple colored grid, not a complex chart)

Each table: simple sorted list, best performer highlighted, click row to see posts in that segment. Clean tables matching existing design language.

---

## Implementation Order

1. DB migration — add `new_followers` to post_metrics, create `post_comment_stats`, clear `ai_analysis_gaps`
2. Stats report enrichment (server) — new sections 0, 14-17, expanded post detail
3. New API endpoints (server) — topic/hook/image-subtype performance breakdowns
4. Chrome DevTools inspection — identify LinkedIn selectors for new scraping targets
5. Extension scraping additions — per-post followers + comment stats (DB already ready from step 1)
6. Coach tab restructure (dashboard) — Overview redesign + Breakdowns expansion
7. Client API types + wiring

## Files Changed

**Server:**
- `server/src/ai/stats-report.ts` — new sections 0, 14-17, expanded post detail
- `server/src/db/migrations/` — new migration: add `new_followers` to post_metrics, create `post_comment_stats`, clear analysis_gaps
- `server/src/routes/insights.ts` — three new deep-dive endpoints
- `server/src/db/ai-queries.ts` — new query functions for topic/hook/image performance
- `server/src/app.ts` — update ingest handler to persist `new_followers` and `post_comment_stats` from extension data

**Extension:**
- `extension/src/content/scrapers.ts` — add `new_followers` parsing to `scrapePostDetail()`, add comment stats parsing to `scrapePostPage()`
- `extension/src/shared/types.ts` — update `ScrapedPostMetrics` and `ScrapedPostContent` types + Zod schemas
- `extension/src/content/index.ts` — may need changes if return types expand

**Dashboard:**
- `dashboard/src/pages/Coach.tsx` — tab rename, Overview redesign, Breakdowns expansion
- `dashboard/src/api/client.ts` — new API types and fetch functions
