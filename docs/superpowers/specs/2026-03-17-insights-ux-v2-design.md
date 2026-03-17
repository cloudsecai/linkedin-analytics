# AI Insights UX v2 — Full Text, Image Analysis, and Output Quality

## Goal

Make AI insights immediately actionable and human-readable by: capturing full post content and images, classifying images for performance correlation, eliminating jargon from AI output, and adding feedback loops so the AI learns user preferences.

## Problem Statement

The v1 AI insights system produces data-backed analysis but suffers from:
- Jargon ("WER", post IDs instead of topics, unexplained scores)
- Missing content (most posts show "(no preview)", no image data captured)
- No image analysis (can't correlate visual style with performance)
- Vague actionability ("image posts do better" vs "posts with photos of you get 2.3x more comments")
- Feedback buttons with no "why" — user can't explain what would be more useful
- "vs prior" without specifying prior what

## Architecture Overview

Three layers of changes:

1. **Scraper** — visit actual post pages to capture full text, hook text, and image URLs
2. **Server** — download images, classify them with vision model, store in DB
3. **Prompts + Dashboard** — rewrite prompts for plain language, fix display issues, add settings page

---

## 1. Scraper Enhancement: Full Text + Images

### 1.1 New Scraping Step

Currently the extension visits:
1. Top posts list page → post IDs, content type, impressions
2. Post analytics detail page → metrics (reactions, comments, etc.)

**Add a third step** between these two: visit the **actual post page** (`/feed/update/urn:li:activity:{id}/`).

This step runs **only for posts that don't yet have `full_text` populated** in the database. During initial backfill, all posts are visited. On daily sync, only new posts.

### 1.2 Data Captured from Post Page

- **`full_text`** — complete post body text. Extracted from the post's text container element after expanding "...see more" if present.
- **`hook_text`** — the text visible before "...see more". Extracted from the DOM's truncated view before expansion. This is what users actually see in their feed and is the most critical piece for hook analysis.
- **`image_urls`** — JSON array of image source URLs from the post. For single images, array of one. For carousels, all slide images in order. For text-only posts, empty array.

### 1.3 DOM Extraction Strategy

**Hook text:** LinkedIn renders a truncated view with a "see more" button. Grab the text content of the post body element *before* clicking "see more". The visible text IS the hook — no need to guess the character count algorithm.

**Full text:** After capturing hook text, either:
- Click the "see more" button and grab the expanded text, OR
- Look for the full text in the underlying DOM/data attributes (LinkedIn sometimes renders the full text hidden)

**Image URLs:** Query for `img` elements within the post's media container. LinkedIn CDN URLs follow patterns like `media.licdn.com/dms/image/...`. For carousels, iterate through all slides.

### 1.4 Schema Changes

```sql
ALTER TABLE posts ADD COLUMN full_text TEXT;
ALTER TABLE posts ADD COLUMN hook_text TEXT;
ALTER TABLE posts ADD COLUMN image_urls TEXT;  -- JSON array of CDN URLs
```

### 1.5 Ingest API Changes

Content data is sent via the existing `POST /api/ingest` endpoint. The extension sends a **separate ingest call** after visiting each post page, with a partial post object containing only the fields it captured:

```json
{
  "posts": [{
    "id": "urn:li:activity:123",
    "full_text": "...",
    "hook_text": "...",
    "image_urls": ["https://media.licdn.com/..."]
  }]
}
```

The `postSchema` is extended to make `content_type` and `published_at` optional (they're already set from the initial scrape). New optional fields:
- `full_text: string`
- `hook_text: string`
- `image_urls: string[]`

The upsert logic merges: if a post already exists, only null fields are updated (never overwrite existing content).

### 1.6 "See More" Timing

The "see more" button may require a short delay after page load before it's clickable. Wait up to 3 seconds for the button to appear, click it, then wait up to 2 seconds for the full text to render before capturing.

### 1.7 Backfill

For existing posts missing `full_text`: the extension's next sync identifies posts with `full_text IS NULL` (via a new `GET /api/posts/needs-content` endpoint) and queues them for post-page visits.

**Endpoint response format:**
```json
{
  "post_ids": ["urn:li:activity:123", "urn:li:activity:456"]
}
```

**Backfill runs as a separate phase** after the normal sync completes (not interleaved). This avoids interference with the regular scraping flow. Paced at 2-5s between page visits.

---

## 2. Image Download + Storage

### 2.1 Server-Side Download

LinkedIn CDN URLs expire, so images must be downloaded promptly after scraping. The server handles this, not the extension.

**Flow:**
1. Ingest receives `image_urls` for a post
2. Server queues a background download job
3. Images saved to `data/images/{post_id}/{index}.jpg` (0-indexed)
4. `image_local_paths` column updated on the post record

**New column:**
```sql
ALTER TABLE posts ADD COLUMN image_local_paths TEXT;  -- JSON array of local paths
```

### 2.2 Download Implementation

- Simple fetch of each URL, write to disk
- Runs **immediately** after ingest (in the same request handler, after sending the response) — not queued
- Retries up to 3 times with exponential backoff (1s, 3s, 10s) over ~30 seconds total
- Failures logged with post ID and URL but do not block the ingest response
- Skips posts that already have local paths
- Serves images via `GET /api/images/{post_id}/{index}` for the dashboard

### 2.3 Storage Considerations

- LinkedIn images are typically 500KB-2MB each
- 50 posts × average 1.5 images × 1MB = ~75MB — manageable for local storage
- No cleanup needed for now; revisit if storage grows past 1GB

---

## 3. Image Classification System

### 3.1 Approach

Same pattern as text tagging: pre-computed before analysis, stored in DB, runs once per image on first encounter.

Uses **Haiku with vision** — cheapest vision-capable model. Each image sent individually WITH its post's hook text for context.

### 3.2 Classification Taxonomy

Five orthogonal dimensions, each answering a different question:

**Format** — *What kind of image is this?*
| Value | Description |
|---|---|
| `photo` | Real photograph (camera/phone) |
| `screenshot` | Screen capture (app, tweet, article, DM) |
| `designed-graphic` | Intentionally created visual (quote card, branded graphic) |
| `chart-or-data` | Graph, table, data visualization |
| `meme` | Humor/reaction format |
| `slide` | Presentation-style carousel slide |

**People** — *Who's in it?*
| Value | Description |
|---|---|
| `author-solo` | The post author only |
| `author-with-others` | Author plus other people |
| `others-only` | People visible but not the author |
| `no-people` | No humans visible |

The classifier receives a **reference photo of the author** (uploaded via settings page) to identify the author in images.

**Setting** — *What's the context?*
| Value | Description |
|---|---|
| `stage-or-event` | Speaking, conference, panel, meetup |
| `office-or-workspace` | Professional/work setting |
| `casual-or-personal` | Informal, outdoor, lifestyle |
| `digital-only` | Screenshot, graphic, no physical setting |

**Text Density** — *How much readable text is in the image?*
| Value | Description |
|---|---|
| `text-heavy` | Text is the primary content |
| `text-light` | Some text/labels, image is primary |
| `no-text` | Purely visual |

**Energy** — *What's the vibe?*
| Value | Description |
|---|---|
| `polished` | Professional, clean, high production value |
| `raw` | Authentic, unfiltered, casual |
| `bold` | High contrast, attention-grabbing |
| `informational` | Educational, structured, neutral |

### 3.3 Database Schema

```sql
CREATE TABLE ai_image_tags (
  post_id TEXT NOT NULL REFERENCES posts(id),
  image_index INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL,
  people TEXT NOT NULL,
  setting TEXT NOT NULL,
  text_density TEXT NOT NULL,
  energy TEXT NOT NULL,
  tagged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  model TEXT,
  PRIMARY KEY (post_id, image_index)
);
```

### 3.4 Classifier Prompt

System prompt includes:
- The taxonomy definitions above
- The author's reference photo (from settings)
- Instruction: "Given this LinkedIn post image and its caption, classify along each dimension. Return JSON."

User message includes:
- The image to classify
- The post's `hook_text` for context

Returns structured JSON:
```json
{
  "format": "photo",
  "people": "author-with-others",
  "setting": "stage-or-event",
  "text_density": "no-text",
  "energy": "raw"
}
```

### 3.5 Processing Flow

- Runs in the orchestrator pipeline, after text tagging and before analysis
- Queries for posts with images (`image_local_paths IS NOT NULL`) that have no `ai_image_tags` rows
- Processes each image individually (not batched — vision calls need individual images)
- Stores results in `ai_image_tags`
- The orchestrator's `runPipeline()` function gets a new step between tagging and analysis: `await classifyImages(client, db, logger)`

---

## 4. Prompt and Output Quality Fixes

### 4.1 System Prompt Additions (All Stages)

Add to every analysis system prompt:

> **Language rules:**
> - Never use abbreviations or internal metric names. Say "engagement rate" not "WER". Say "shares" not "reposts".
> - When referencing specific posts, describe them by their topic/hook text (e.g., "your post about due diligence questions for investors") and include the date. Never reference posts by ID number.
> - All numbers must have plain-English context. Don't say "WER 0.0608" — say "6.1% engagement rate".
> - Don't just identify what works — explain WHY it works and give a specific next action the author can take this week.

### 4.2 Prompt Data Enrichment

The data summary passed to prompts now includes:
- `hook_text` for each post (so the LLM can reference posts by topic)
- Image classification data from `ai_image_tags` (so the LLM can correlate visual style with performance)

The **posts** schema description in `patternDetectionPrompt` must be updated to include the new columns:
```
- **posts**: id (TEXT PK), content_preview (TEXT), full_text (TEXT), hook_text (TEXT),
  image_urls (TEXT), image_local_paths (TEXT), content_type (TEXT), published_at (DATETIME),
  url (TEXT), created_at (DATETIME)
```

The text tagger (in `analyzer.ts`) should use `COALESCE(full_text, content_preview)` instead of just `content_preview` when building post summaries for tagging.

### 4.3 Overview Generation Improvements

**Top performer card** — currently shows "Weighted engagement score: 118". Change to:
- Show the post's `hook_text` (first ~100 chars)
- Show why it performed (generated by the AI in the overview prompt)
- Link to the post

The orchestrator's overview generation prompt changes from a static score to asking the AI: "Given this top-performing post and its metrics, explain in one sentence why it resonated."

**Quick insights** — the synthesis prompt already has access to `hook_text` per post, so insights naturally reference posts by topic rather than ID.

### 4.4 Image Analysis Integration

Add to the pattern detection prompt's schema description:
```
- **ai_image_tags**: post_id (TEXT), image_index (INTEGER), format (TEXT),
  people (TEXT), setting (TEXT), text_density (TEXT), energy (TEXT)
```

Add analysis instruction:
> "Correlate image classifications with performance metrics. Look for patterns like: do posts with the author visible get more comments? Do screenshots get more shares? Do polished vs raw images perform differently?"

---

## 5. Dashboard Display Fixes

### 5.1 "vs Prior" Clarification

The KPI cards' subtitle currently shows "+19.6% vs prior". Change to include the selected time range:
- 7d selected → "+19.6% vs prev 7d"
- 30d selected → "+19.6% vs prev 30d"
- 90d selected → "+19.6% vs prev 90d"
- All selected → no comparison shown (hide the subtitle entirely — no meaningful prior period)

Implementation: pass the `range` value down to the `pctChange` function and include it in the output string. When range is "all", the function returns `null` and the UI hides the comparison badge.

### 5.2 Top Performer Card

Replace "Weighted engagement score: 118" with:
- Post hook text (or first ~100 chars of full_text if hook is null)
- AI-generated reason ("This post resonated because...")
- Post date
- Link to the post

The existing `top_performer_reason` column in `ai_overview` is populated with this richer AI-generated explanation (no schema change needed — the column already exists, it just gets better content).

### 5.3 Posts Table — No More "(no preview)"

After the scraper captures `full_text` and `hook_text`:
- Posts table display priority: `hook_text` → first ~80 chars of `full_text` → `content_preview`
- `content_preview` (from the original top-posts list scrape) serves as the final fallback for posts not yet backfilled
- Note: `hook_text` and `content_preview` may overlap for short posts. `hook_text` is preferred because it's the exact text shown in the LinkedIn feed.

### 5.4 Image Thumbnails in Posts Table

Optional: show a small thumbnail next to image/carousel posts in the Posts table. Images are served from `GET /api/images/{post_id}/0`.

---

## 6. Settings Page

### 6.1 New Dashboard Route: `/settings`

Minimal settings page with:
- **Author reference photo**: upload, preview, delete
- Photo stored at `data/author-reference.jpg` on the server
- Used by the image classifier to identify the author in post images

### 6.2 API Endpoints

- `POST /api/settings/author-photo` — multipart file upload, saves to `data/author-reference.jpg`. Validates: JPEG/PNG only, max 5MB.
- `GET /api/settings/author-photo` — serves the stored image (404 if none)
- `DELETE /api/settings/author-photo` — removes the photo

### 6.3 Classifier Integration

When classifying images, the orchestrator checks if `data/author-reference.jpg` exists. If yes, it's included in the classifier prompt as the author's face. If no reference photo, the `people` dimension defaults to `others-only` or `no-people` (can't distinguish author).

---

## 7. Feedback "Why" Field

### 7.1 UX Change

After clicking "Useful" or "Not useful" on a recommendation:
1. The button highlights (current behavior)
2. A text input slides open below: "What would make this more useful?" / "Why was this helpful?"
3. User can type a reason and press Enter or a submit button
4. Stored alongside the rating

### 7.2 API and Data Model Changes

**API:** `POST /api/recommendations/:id/feedback` accepts a JSON body:
```json
{
  "rating": "useful",
  "reason": "This is exactly the kind of specific advice I need"
}
```
The `reason` field is optional. For backward compatibility, the API also accepts a plain string body (`"useful"`) and treats it as `{ rating: "useful", reason: null }`.

**Storage:** The `recommendations.feedback` column stores the JSON string. On read, existing plain string values (from before this change) are normalized to `{ rating: "<value>", reason: null }` at the application layer.

### 7.3 Feeding Back into Prompts

The synthesis prompt's "User Feedback History" section (currently a TODO) gets wired up:
- Query recent recommendation feedback with reasons
- Format as: "The user found '[headline]' useful because: '[reason]'" or "The user found '[headline]' not useful because: '[reason]'"
- This teaches the AI what kind of advice the user values

---

## 8. Implementation Order

1. **Schema migration** — new columns on posts, new ai_image_tags table
2. **Scraper: post page visit** — capture full_text, hook_text, image_urls
3. **Server: image download** — background download, local storage, serve endpoint
4. **Settings page** — author photo upload
5. **Image classifier** — Haiku vision, structured tags, reference photo
6. **Prompt rewrites** — language rules, data enrichment, image analysis instructions
7. **Dashboard fixes** — "vs prior" labels, top performer card, posts table, feedback why field
8. **Backfill** — endpoint for posts needing content, extension backfill logic
9. **Wire feedback into prompts** — synthesis prompt uses feedback history

---

## Non-Goals

- Real-time image analysis (classification is batch, pre-computed)
- Video frame analysis (only still images for now)
- Multiple author support (single-user tool)
- Image editing or generation
- LinkedIn API integration (DOM scraping only)
