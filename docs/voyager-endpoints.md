# LinkedIn Analytics — API & Page Discovery Spike

**Date:** 2026-03-16
**Method:** Chrome DevTools on live LinkedIn session

## Key Finding

LinkedIn's creator analytics pages are **server-side rendered** — the analytics data is baked into the HTML, not loaded via separate Voyager API calls. The most reliable collection approach is **DOM scraping on these analytics pages**, supplemented by Voyager API calls for profile/identity data.

## Analytics Pages (Primary Data Sources)

### 1. Creator Dashboard (`/dashboard/`)
High-level summary cards, server-rendered:
- Post impressions (7-day total + % change)
- Follower count (+ % change)
- Profile viewers (90-day total)
- Search appearances (previous week)

### 2. Content Analytics (`/analytics/creator/content/?timeRange=past_7_days&metricType=IMPRESSIONS`)
**Tabs:** "Posts Analytics" (default), "Audience Analytics"
**Controls:** Time range dropdown, metric type dropdown, cumulative toggle

**Page contains:**

**Content performance section:**
- Total impressions for period + % change vs prior period
- Time series chart (daily impressions, cumulative or daily)
- Members reached + % change

**Top performing posts section:**
- List of posts sorted by impressions (3 visible, "Show more" link)
- Per post: content text preview, post age, reactions count, comments count, impressions
- Post URLs contain activity IDs: `urn:li:activity:{id}`
- "View analytics" link per post → `/analytics/post-summary/urn:li:activity:{id}`

**"Show more" link:** `/analytics/creator/top-posts?timeRange=past_7_days&metricType=IMPRESSIONS&startDate=2026-03-11&endDate=2026-03-17`

### 3. Individual Post Analytics (`/analytics/post-summary/urn:li:activity:{id}/`)
Most detailed view — per-post deep dive:

**Discovery:**
- Impressions (exact number)
- Members reached (exact number)

**Profile activity:**
- Profile viewers from this post
- Followers gained from this post

**Social engagement:**
- Reactions (count)
- Comments (count)
- Reposts (count)
- Saves (count)
- Sends on LinkedIn (count)

**Link engagement:**
- Premium custom button interactions

**Post viewers demographics:**
- Experience level breakdown (% by seniority)
- Industry breakdown (% by industry)
- Company size breakdown (% by employee count)

**Who viewed your profile since this post:**
- Actual profile viewers with names, titles, connection degree

### 4. Top Posts — Full List (`/analytics/creator/top-posts?timeRange=past_365_days&metricType=IMPRESSIONS`)
Paginated view of all posts for a given time range, sorted by selected metric.

**Observed:** 50 posts returned on `past_365_days` view — **no pagination controls**. All posts appear on a single page.

**Per post:**
- Content text preview
- Post age
- Reactions count, comments count
- Impressions count
- Link to detailed analytics: `/analytics/post-summary/urn:li:activity:{id}/`
- Link to feed post: `/feed/update/urn:li:activity:{id}/`

**Available time ranges:** `past_7_days`, `past_30_days`, `past_90_days`, `past_365_days`
**Available metric types:** `IMPRESSIONS` (others likely available)

**Collection note:** For backfill, scrape `past_365_days`. For daily syncs, scrape `past_30_days` only — posts older than ~30 days have plateaued and don't need re-scraping.

### 5. Audience Analytics (`/analytics/creator/audience`)
Follower demographics and growth data, server-rendered.

**Page contains:**
- **Total followers** (exact count) + % change vs prior 7 days
- **New followers chart** — daily line chart (7 data points for past_7_days)
  - Controls: Time range dropdown, Cumulative toggle
- **Top demographics of followers:**
  - Experience level (e.g., "Senior — 34%")
  - Industry (e.g., "IT Services and IT Consulting — 24%")
  - Location (e.g., "San Francisco Bay Area — 20%")
  - "Show all" link for full breakdown

**URL redirects:** `/me/profile-views` → `/analytics/profile-views/`

### 6. Profile Viewers (`/analytics/profile-views/`)
Profile view data over time with individual viewer details.

**Page contains:**
- **Total profile views** (e.g., 1,023 past 90 days) + % change vs previous week
- **Time series chart** (line chart spanning ~90 days)
- **"Show more Premium analytics"** link (some data behind LinkedIn Premium paywall)
- **Individual viewer list** (paginated with "Show more results"):
  - Viewer name, title, company
  - Connection degree (1st, 2nd, 3rd)
  - When they viewed (e.g., "Viewed 1h ago")
  - Action button (Message / Connect / Search)
- **Recruiter viewers section** (e.g., "12 recruiters viewed your profile" + "View all recruiters")
- Sort control: "Sort by most recent"

### 7. Search Appearances (`/analytics/search-appearances/`)
How your profile appears across LinkedIn.

**URL redirects:** `/me/search-appearances/` → `/analytics/search-appearances/`

**Page contains:**

**Profile appearances (top section):**
- Total appearances (e.g., 8,042) + % change past 7 days
- Search appearances (e.g., 300) + % change past 7 days
- **Where you appeared breakdown:**
  - Post (70.9%)
  - Comments (21%)
  - Network recommendations (4.3%)
  - Search (3.7%)

**Recent profile viewers** (same list as profile-views page)

**Premium section — Profile engagement (past 90 days):**
- Impressions (e.g., 4,564, +86.8% past week)
- Clicks (e.g., 1,049, +90% past week)
- Avg view time (e.g., 1h 24m, +81.8% past week)
- **Impressions per section breakdown:**
  - About: 900 (10.2%)
  - Services: 787 (17.8%)
  - Featured: 756 (16.9%)
  - Activity: 734 (16.4%)
  - Experience: 619 (13.1%)
  - "Show all" for more sections

## Voyager API Calls (Observed)

These are the API calls LinkedIn's frontend makes when loading the analytics pages:

### Profile Identity
```
GET /voyager/api/graphql?includeWebMetadata=true
  &variables=(memberIdentity:ACoAAAB-QDMBj6BvJgAs281xVSeqgWxDvB58tK4)
  &queryId=voyagerIdentityDashProfiles.b5c27c04968c409fc0ed3546575b9b7a
```

### Full Profile (with decoration)
```
GET /voyager/api/identity/dash/profiles/urn:li:fsd_profile:ACoAAAB-QDMBj6BvJgAs281xVSeqgWxDvB58tK4
  ?decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfile-76
```
- Returns full profile data including follower count, connection count, etc.

### Profile with Analytics Context
```
GET /voyager/api/graphql?includeWebMetadata=true
  &variables=(profileUrn:urn%3Ali%3Afsd_profile%3AACoAAAB-QDMBj6BvJgAs281xVSeqgWxDvB58tK4)
  &queryId=voyagerIdentityDashProfiles.da93c92bffce3da586a992376e42a305
```

### Other Observed Calls
- `voyagerGlobalAlerts` — global notification alerts
- `voyagerMessagingDashMessagingSettings` — messaging settings
- `voyagerDashMySettings` — user settings
- `voyagerJobsDashJobSeekerPreferences` — job seeker preferences
- `voyagerLegoDashPageContents` — page layout/content config
- `voyagerPremiumDashFeatureAccess` — premium feature access checks

## Authentication

All requests include these headers:
```
csrf-token: ajax:3873311793579523357
Cookie: JSESSIONID="ajax:3873311793579523357"; li_at=AQEDAQB-QDM...
accept: application/vnd.linkedin.normalized+json+2.1
x-restli-protocol-version: 2.0.0
x-li-lang: en_US
```

The `csrf-token` value matches the `JSESSIONID` cookie value (with quotes stripped).

## User Identity

Profile URN: `urn:li:fsd_profile:ACoAAAB-QDMBj6BvJgAs281xVSeqgWxDvB58tK4`
Member Identity: `ACoAAAB-QDMBj6BvJgAs281xVSeqgWxDvB58tK4`
Public identifier: `natetrustmind`

## Recommended Collection Strategy

### Approach: Hybrid DOM Scraping + Voyager API

1. **DOM scraping for analytics data** (most reliable — server-rendered):
   - Navigate to `/analytics/creator/top-posts?timeRange=past_365_days&metricType=IMPRESSIONS` → scrape full post list with impressions, reactions, comments (backfill: 365d, daily: 30d)
   - For each recent post (<30 days old), navigate to `/analytics/post-summary/urn:li:activity:{id}/` → scrape detailed metrics (impressions, reach, reactions, comments, reposts, saves, sends, demographics)
   - Navigate to `/analytics/creator/audience` → scrape total followers, new follower chart, demographics
   - Navigate to `/analytics/profile-views/` → scrape total profile views + chart
   - Navigate to `/analytics/search-appearances/` → scrape appearance count, search count, breakdown

2. **Voyager API for identity/profile data** (stable, well-understood):
   - Full profile endpoint for follower count
   - Profile identity for user resolution

3. **Metric decay strategy:**
   - Posts <30 days old: scrape per-post detail page on every sync
   - Posts >30 days old: stop re-scraping (metrics have plateaued)
   - Backfill on first install: scrape `past_365_days` top-posts page + detail pages for all posts

### Why DOM scraping over pure Voyager API:
- Analytics data is server-rendered — no separate API call to reverse-engineer
- LinkedIn changes API endpoints frequently but analytics page structure is more stable
- The DOM contains richer data (demographics, profile viewers) than any single API endpoint
- We can validate data integrity by cross-referencing DOM data with page structure

### Trade-offs:
- DOM scraping requires opening tabs (background tab approach from original spec works)
- CSS selectors can change — need health monitoring (already in spec)
- Slower than pure API calls — but daily sync frequency makes this acceptable

## Discovery Status

All primary analytics pages have been explored:
- [x] `/dashboard/` — summary cards
- [x] `/analytics/creator/content/` — content performance + top 3 posts
- [x] `/analytics/creator/top-posts?timeRange=...` — full post list (50 posts on 365d)
- [x] `/analytics/post-summary/urn:li:activity:{id}/` — per-post deep dive
- [x] `/analytics/creator/audience` — follower count, growth chart, demographics
- [x] `/analytics/profile-views/` — profile view count, chart, individual viewers
- [x] `/analytics/search-appearances/` — appearance count, breakdown, premium engagement data

### Not captured (Premium-only or lower priority):
- Premium profile engagement details (behind paywall on search-appearances page)
- Full viewer list pagination (individual viewer names — privacy concern, low value for analytics)
- Audience "Show all" demographics breakdown
