# LinkedIn Analytics — Implementation Plan

Repo: https://github.com/cloudsecai/linkedin-analytics (private)

## Phase 0: Discovery Spike (COMPLETE)

Done manually via Chrome DevTools on a live LinkedIn session. Findings in `docs/voyager-endpoints.md`.

**Key discovery:** LinkedIn analytics data is server-side rendered into HTML. Collection strategy is DOM scraping of analytics pages, not Voyager API calls. Voyager API used only for identity resolution.

## Phase 1: Project Scaffolding

1. Init npm workspace with three packages: `extension/`, `server/`, `dashboard/`
2. Set up TypeScript config (root `tsconfig.json` + per-package)
3. Set up Vite configs (separate for extension and dashboard)
4. Create `extension/manifest.json` with required permissions
5. Create `data/.gitkeep`, add `data/*.db` to `.gitignore`
6. Add `.superpowers/` to `.gitignore`
7. Create `start.sh` convenience script

## Phase 2: Local Server + Database

1. Set up Fastify server in `server/src/index.ts`
2. Implement SQLite schema initialization with WAL mode (`server/src/db/schema.sql`)
3. Implement migration runner (`schema_version` table + sequential `.sql` files)
4. Implement `POST /api/ingest` with Zod validation (updated schema includes `members_reached`, `saves`, `sends`)
5. Implement `GET /api/health`
6. Implement `GET /api/posts` with filtering, sorting, pagination
7. Implement `GET /api/metrics/:postId`
8. Implement `GET /api/overview` (KPI aggregates)
9. Implement `GET /api/timing` (day/hour heatmap data)
10. Implement `GET /api/followers`
11. Implement `GET /api/profile`
12. Configure CORS for `chrome-extension://` origins
13. Write tests for ingest deduplication logic and query endpoints

## Phase 3: Chrome Extension — Core

1. Create manifest.json with all permissions
2. Build service worker (`background/`):
   - `chrome.alarms` registration (re-register on every worker start)
   - Alarm handler: check health endpoint, determine if sync needed
   - Message listener for content script relay
   - POST to localhost `/api/ingest`
   - Sync state management (`chrome.storage.local` for timestamps, `chrome.storage.session` for transient state)
3. Build content script (`content/`):
   - **DOM scrapers** for each analytics page (the primary data collection method):
     - Top posts scraper: `/analytics/creator/top-posts?timeRange=past_30_days&metricType=IMPRESSIONS` → extract post IDs, content previews, reactions, comments, impressions
     - Post detail scraper: `/analytics/post-summary/urn:li:activity:{id}/` → extract impressions, members reached, reactions, comments, reposts, saves, sends, demographics
     - Audience scraper: `/analytics/creator/audience` → extract total followers, new follower data
     - Profile views scraper: `/analytics/profile-views/` → extract profile view count
     - Search appearances scraper: `/analytics/search-appearances/` → extract appearance count, breakdown
   - **Voyager API client** (identity resolution only): resolve user profile URN via `/voyager/api/me`
   - Zod schema validation on every scraped data set
   - Relay collected data to service worker via `chrome.runtime.sendMessage`
4. Handle SPA navigation via `chrome.webNavigation.onHistoryStateUpdated`
5. Implement sync chunking (batches of 25 post detail pages, follow-up alarms)
6. Implement offline queue in `chrome.storage.local` with 5MB cap
7. **Metric decay logic:** Only scrape post detail pages for posts <30 days old. On first install (backfill), scrape `past_365_days` for all available posts.

## Phase 4: Extension Popup

1. Simple HTML/CSS popup (no framework needed — it's tiny)
2. Display last sync time
3. Display per-source health status
4. "Sync Now" button
5. "Open Dashboard" button
6. Auth status indicator

## Phase 5: Dashboard

1. Set up React + TailwindCSS + Chart.js in `dashboard/`
2. Build layout: dark theme, top nav with tab switching, date range selector
3. **Overview tab:**
   - KPI cards with period comparison
   - Impressions over time bar chart
   - Engagement by content type horizontal bars
   - Recent posts sortable table
4. **Posts tab:**
   - Full sortable/filterable post table
   - Post detail view with metric history chart (impression velocity)
5. **Timing tab:**
   - Day-of-week × hour-of-day heatmap
6. **Followers tab:**
   - Follower growth line chart
   - Net new followers per period
   - Profile views + search appearances trends
   - Post publish date markers overlaid
7. Alert banner for sync errors
8. Configure Fastify to serve dashboard build as static files

## Phase 6: Integration Testing + Polish

1. End-to-end test: extension → server → database → dashboard
2. Verify sync chunking and worker restart recovery
3. Test offline queue behavior (server down → server back up)
4. Test error scenarios (DOM structure changes, expired session)
5. Write README with setup instructions
