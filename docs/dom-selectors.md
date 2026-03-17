# LinkedIn Analytics — DOM Selector Reference

Documented from live Chrome DevTools exploration on 2026-03-16. These selectors drive the content script's DOM scrapers.

**Important:** LinkedIn uses a mix of stable BEM-style class names (`member-analytics-addon__*`) and randomized/obfuscated classes. Scrapers should rely on the stable `member-analytics-addon__*` and `analytics-libra-*` prefixes. Avoid selecting by randomized classes (e.g., `mAOCGrRlAlzrmIRFhqWqYWAfhQkILTEvdenF`).

## Page Load Behavior

- Analytics pages are server-side rendered but content may lazy-load on scroll. The scraper should wait for key elements to appear (e.g., `.member-analytics-addon__mini-update-item`) before extracting, with a timeout.
- LinkedIn is an SPA — navigating between analytics pages triggers client-side routing, not full page reloads. Content scripts must detect URL changes via `chrome.webNavigation.onHistoryStateUpdated`.

---

## 1. Top Posts List (`/analytics/creator/top-posts?timeRange=...&metricType=IMPRESSIONS`)

The primary post discovery page. Shows up to 50 posts on `past_365_days`, no pagination.

Also reachable via the "Show more" link on the content analytics page:
```
a.member-analytics-addon__cta-list-item-content[href*="top-posts"]
```

### Post Item Container

```
Selector: .member-analytics-addon__mini-update-item
Tag: A (anchor element)
Parent: li.list-style-none
```

Each post item is an `<a>` tag. The `href` contains the activity ID:
```
href="/feed/update/urn:li:activity:{activityId}/"
```

Extract activity ID:
```js
const activityId = href.match(/activity[:-](\d+)/)?.[1];
```

### Post Content Preview

The post text is in the `aria-label` of the content link inside the post item:
```
Selector: .member-analytics-addon__mini-update-item a[aria-label]:not([aria-label*="posted this"]):not([aria-label="Image"])
```

The `aria-label` attribute contains the full post text (up to ~200 chars). This is more reliable than scraping the collapsed text body. Alternatively, the text body is in:
```
Selector: .inline-show-more-text span (inside the post item)
```

### Post Impressions + Analytics Link

Each post has a companion CTA element with the impression count and a link to the post detail page:

```
Selector: .member-analytics-addon__cta-item-with-secondary-anchor
Tag: A
href: https://www.linkedin.com/analytics/post-summary/urn:li:activity:{activityId}
aria-label: "Increased  Impressions" (or similar)
```

**Impression count:**
```
Selector (within CTA): .member-analytics-addon__cta-item-with-secondary-list-item-title
Example text: "2,002"
```

**Metric label:**
```
Selector (within CTA): .member-analytics-addon__cta-item-with-secondary-list-item-text
Example text: "Impressions"
```

### Social Counts (Reactions, Comments — inline on post list)

```
Reactions:  .social-details-social-counts__reactions
            Text: "26" (number only)
            Or via aria-label: "260 reactions" on child button

Comments:   .social-details-social-counts__comments
            Text: "4 comments"
```

### Published Date

**Not available in the DOM as an exact timestamp.** The contextual description shows only relative age:
```
Selector: .feed-mini-update-contextual-description__text
Example text: "Nate Lee posted this • 5d"
```

**Solution: Derive from activity ID.** LinkedIn activity IDs encode the creation timestamp using a snowflake-like scheme with Unix epoch (no offset):
```js
function activityIdToDate(activityId: string): Date {
  return new Date(Number(BigInt(activityId) >> BigInt(22)));
}
```

Verified against live data:
| Activity ID | Derived Date | Relative Label |
|---|---|---|
| 7437529606678802433 | 2026-03-11T16:07:20.850Z | 5d |
| 7436834189745983488 | 2026-03-09T18:04:00.533Z | 1w |
| 7363913952889589764 | 2025-08-20T12:45:01.274Z | 7mo |

### Content Type Detection

No explicit content type field in the DOM at the **post list level**. Must be inferred:

**On the top-posts list page:**
```
Image post:  aria-label="Image" on a child element AND/OR has .ivm-image-view-model

Video post:  ALSO shows aria-label="Image" (uses thumbnail). Distinguishable by
             <img> src URL containing "videocover" (e.g., src="...videocover-low/...")

Text post:   No media aria-label, no .ivm-image-view-model

Carousel:    Expected aria-label="Document" or "Carousel" (not confirmed)

Article:     Expected aria-label="Article" (not confirmed)
```

**On the post detail page (more reliable):**
```
Video post:  Has a "Video performance" card header
             (.member-analytics-addon-header__title text === "Video performance")

Image post:  Has .ivm-image-view-model but NO "Video performance" card

Text post:   No media elements
```

**Recommended approach:** On the post list, check `<img>` `src` for `videocover` to distinguish video from image. On the post detail page, check for the "Video performance" card header. Default to `"text"` if no media indicators found.

```js
function detectContentType(postItem: Element): string {
  const img = postItem.querySelector('img.feed-mini-update-commentary__image');
  if (img?.getAttribute('src')?.includes('videocover')) return 'video';
  if (postItem.querySelector('.ivm-image-view-model')) return 'image';
  return 'text';
}
```

---

## 2. Post Detail (`/analytics/post-summary/urn:li:activity:{id}/`)

Per-post deep dive. Organized into cards with a consistent structure.

### Card Structure

```
Card container:  .member-analytics-addon-card__base-card (tag: SECTION)
Card header:     .member-analytics-addon-header__title (tag: H2)
Subcomponents:   .member-analytics-addon-card__subcomponent-container
```

Cards on this page (in order):
1. **Discovery** — Impressions, Members reached
2. **Profile activity** — Profile viewers from post, Followers gained
3. **Video performance** — (video posts only) Video Views, Watch time, Avg watch time
4. **Social engagement** — Reactions, Comments, Reposts, Saves, Sends
5. **Link engagement** — Premium custom button interactions
6. **Post viewers demographics** / **Video viewer demographics** — Experience level, Industry, Company size
7. **Who's viewed your profile since this post** — Viewer list

### Discovery & Social Engagement Metrics

These cards use the "cta-list-item" pattern:

```
List container:  ul.list-style-none (aria-labelledby="member-analytics-addon-card-{n}")
List item:       li.member-analytics-addon__cta-list-item
```

Within each list item:
```
Metric label:    span.text-body-small.t-black--light
                 Example: "Impressions", "Reactions", "Saves"

Metric value:    .member-analytics-addon__cta-list-item-text strong
                 Example: "2,003", "26", "1"
```

**Discovery card metrics:**
- Impressions (label: "Impressions")
- Members reached (label: "Members reached")

**Social engagement card metrics:**
- Reactions (label: "Reactions")
- Comments (label: "Comments")
- Reposts (label: "Reposts")
- Saves (label: "Saves")
- Sends on LinkedIn (label: "Sends on LinkedIn")

### Video Performance Metrics (video posts only)

Present only on video posts. Uses the **summary KPI pattern** (same as audience/profile views pages):

```
Container:  .member-analytics-addon-summary (inside the "Video performance" card)
Items:      li.member-analytics-addon-summary__list-item
```

**Metrics:**
- Video Views (value: "608", label: "Video Views")
- Watch time (value: "3h 14m 9s", label: "Watch time")
- Average watch time (value: "19s", label: "Average watch time")

The header "Video performance" also serves as the definitive content type signal — if this card exists, the post is a video.

### Profile Activity Metrics

Uses a **different layout** — the "metric-row-list" pattern:

```
List item:       li.member-analytics-addon-metric-row-list__item
Label:           .member-analytics-addon-metric-row-list-item__title-container span
Value:           .member-analytics-addon-metric-row-list-item__value
```

**Metrics:**
- Profile viewers from this post
- Followers gained from this post

### Extraction Strategy

To reliably extract metrics by name (not position), iterate over list items and match on the label text:

```js
function extractMetrics(card: Element): Record<string, string> {
  const metrics: Record<string, string> = {};

  // Pattern 1: cta-list-item (Discovery, Social engagement)
  for (const li of card.querySelectorAll('.member-analytics-addon__cta-list-item')) {
    const label = li.querySelector('.text-body-small')?.textContent?.trim();
    const value = li.querySelector('strong')?.textContent?.trim();
    if (label && value) metrics[label] = value;
  }

  // Pattern 2: metric-row-list-item (Profile activity)
  for (const li of card.querySelectorAll('.member-analytics-addon-metric-row-list__item')) {
    const label = li.querySelector('.member-analytics-addon-metric-row-list-item__title-container span')?.textContent?.trim();
    const value = li.querySelector('.member-analytics-addon-metric-row-list-item__value')?.textContent?.trim();
    if (label && value) metrics[label] = value;
  }

  return metrics;
}
```

---

## 3. Content Analytics Overview (`/analytics/creator/content/`)

Tabs: "Posts" (default), "Audience". Contains summary KPIs, chart, and top 3 posts.

### Tabs

```
Active tab:   button.artdeco-tab.active.creator-analytics__tab
Inactive tab: button.artdeco-tab.creator-analytics__tab
```

### Time Range and Metric Filters

```
Filter group: .analytics-libra-analytics-filter-group
```

Currently the page loads with `Past 7 days` / `Impressions` defaults. The scraper navigates directly to the top-posts page rather than using this overview, so these filters are informational.

### Summary KPI Cards

```
Container:   ul.member-analytics-addon-summary
Item:        li.member-analytics-addon-summary__list-item
```

Within each summary item:
```
Value:       p.text-heading-large (or .text-body-medium-bold.text-heading-large)
             Example: "5,756"

Label:       p.member-analytics-addon-list-item__description
             Example: "Impressions"

Trend:       span.text-body-xsmall (contains trend arrow + percentage)
             Example: "23.1% vs. prior 7 days"

Trend class: .analytics-tools-shared-trend-text__value--decrease-caret-lead (decrease)
             .analytics-tools-shared-trend-text__value--increase-caret-lead (increase)
```

### "Show More" Link (to top-posts page)

```
Selector: a.member-analytics-addon__cta-list-item-content[href*="top-posts"]
href:     /analytics/creator/top-posts?timeRange=past_7_days&metricType=IMPRESSIONS&startDate=...&endDate=...
Text:     "Show more"
```

---

## 4. Audience Analytics (`/analytics/creator/audience`)

### Total Followers

Uses the summary KPI pattern:

```
Container:  li.member-analytics-addon-summary__list-item
Value:      p.text-heading-large
            Example: "4,848"

Label:      p.member-analytics-addon-list-item__description
            Example: "Total followers"

Trend:      span.text-body-xsmall
            Example: "0.5% vs. prior 7 days"
```

### New Followers Chart

A line chart with daily data points. Chart data is rendered via Highcharts/SVG — extracting values from the chart is fragile. The total follower count is the reliable metric to scrape; `new_followers` is computed at query time via SQL `LAG()`.

### Demographics

Demographics data exists on the page ("Senior — 34%", "IT Services and IT Consulting — 24%") but is not captured in v1 schema. Future consideration.

---

## 5. Profile Views (`/analytics/profile-views/`)

### Profile View Count

Uses the summary KPI pattern:

```
Container:  li.member-analytics-addon-summary__list-item
Value:      p.text-heading-large
            Example: "1,023"

Label:      p.member-analytics-addon-list-item__description
            Example: "Profile viewers"

Trend:      span.text-body-xsmall
            Example: "50% previous week"
```

Note: The value is "past 90 days" total, not a daily count. The time range header says "Past 90 days".

---

## 6. Search Appearances (`/analytics/search-appearances/`)

### Appearance Counts

Two summary KPI items, same pattern:

```
Item 1:
  Value: "8,042"
  Label: "All appearances"

Item 2:
  Value: "300"
  Label: "Search appearances"
```

Both include trend indicators (e.g., "44% past 7 days").

### Where You Appeared Breakdown

Text content on the page, not structured as list items. Example:
```
Post  70.9%
Comments  21%
Network recommendations  4.3%
Search  3.7%
```

Not captured in v1 schema.

---

## Shared Patterns Summary

| Pattern | Selector | Used On |
|---|---|---|
| Summary KPI | `.member-analytics-addon-summary__list-item` → `.text-heading-large` + `.member-analytics-addon-list-item__description` | Content overview, Audience, Profile views, Search appearances |
| CTA list metric | `.member-analytics-addon__cta-list-item` → `.text-body-small` + `strong` | Post detail (Discovery, Social engagement) |
| Metric row | `.member-analytics-addon-metric-row-list__item` → `span` + `.member-analytics-addon-metric-row-list-item__value` | Post detail (Profile activity) |
| Post list item | `.member-analytics-addon__mini-update-item` | Content overview, Top posts |
| Post CTA/metric | `.member-analytics-addon__cta-item-with-secondary-anchor` | Content overview, Top posts |
| Card header | `.member-analytics-addon-header__title` | Post detail |

## Value Parsing

All numeric values are formatted with commas (e.g., "2,003", "8,042"). Parse with:
```js
function parseMetricValue(text: string): number | null {
  const cleaned = text?.replace(/,/g, '').trim();
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
}
```

## Resilience Notes

- **Stable selectors:** The `member-analytics-addon__*` prefix is used consistently across all analytics pages and appears to be a stable component library. These are safe to rely on.
- **Unstable selectors:** Randomized class names like `mAOCGrRlAlzrmIRFhqWqYWAfhQkILTEvdenF` change between builds. Never use these.
- **Health monitoring:** If any of the key selectors return 0 results when results are expected, the scraper should mark that data source as broken (likely a LinkedIn UI update) and log the full page HTML for debugging.
- **Two metric patterns:** Post detail pages use two different list-item layouts (`cta-list-item` vs `metric-row-list-item`). The scraper must handle both.
