# Publish Detection via Network Interception — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when the user publishes a LinkedIn post and immediately scrape + match it against unmatched generations, eliminating the multi-hour lag from waiting for the next scraper sync (9 AM / 9 PM).

**Architecture:** The extension's service worker watches for LinkedIn's publish API call (`normShares`) via `webRequest.onCompleted`. When detected, it creates an alarm (MV3-safe delay instead of `setTimeout`), then opens a background tab to scrape the user's most recent post using the existing `scrapePostContent()` function. It sends the scraped post to the server via the existing `POST /api/personas/:personaId/ingest` endpoint, which already triggers `runAutoRetro` for posts with `full_text`. No new server endpoint needed.

**Tech Stack:** Chrome Extension (Manifest V3, `webRequest` API, `chrome.alarms`), existing ingest + auto-retro pipeline.

**Key insight:** The entire server-side flow already exists. When `/api/ingest` receives a post with `full_text`, it already fires `runAutoRetro` which calls `findMatch(client, postExcerpt, candidates)` and runs `analyzeRetro` on a match. We only need to get the post into the database faster.

---

## Prerequisite: Verify LinkedIn Publish API URL

**Before writing any code**, confirm the exact URL pattern LinkedIn uses when publishing a post.

- [ ] **Step P1: Capture the publish URL in DevTools**
  - Open Chrome DevTools → Network tab on linkedin.com
  - Filter by `contentcreation` or `normShares`
  - Write a post and click Publish
  - Record the exact request URL (method, path, query params)
  - Confirm it matches: `*://*.linkedin.com/voyager/api/contentcreation/normShares*`
  - If the pattern differs, update `PUBLISH_URL_PATTERN` in the extension code below before proceeding

---

### Task 1: Add publish-detection listener + mini-scrape in the extension

**Files:**
- Modify: `extension/src/background/service-worker.ts`

**Why a mini-scrape instead of a server endpoint?** The post does NOT exist in the database when the `normShares` request completes. The scraper runs on a schedule (9 AM / 9 PM). We need to get the post into the DB first. The extension already has `scrapePostContent()` which does a two-phase scrape (hook text → click "see more" → full text). We reuse that, then POST via the existing `/api/ingest` endpoint which already triggers `runAutoRetro`.

- [ ] **Step 1.1: Add the publish-detection alarm handler**

  In `extension/src/background/service-worker.ts`, add the alarm name to the existing `chrome.alarms.onAlarm` listener:

  ```ts
  // Inside the existing onAlarm listener, add a new branch:
  } else if (alarm.name === "publish-scrape") {
    await scrapeLatestPost();
  }
  ```

- [ ] **Step 1.2: Add the webRequest listener for publish detection**

  Near the existing DASH video URL `webRequest.onCompleted` listener (around line 40), add:

  ```ts
  // Detect when the user publishes a LinkedIn post.
  // Uses chrome.alarms instead of setTimeout because MV3 service workers
  // are ephemeral and may be killed before a setTimeout fires.
  const PUBLISH_URL_PATTERN = '*://*.linkedin.com/voyager/api/contentcreation/normShares*';

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (details.statusCode < 200 || details.statusCode >= 300) return;
      if (details.method !== 'POST') return;

      console.log('[Publish] Detected normShares completion, scheduling scrape');

      // chrome.alarms.create with the same name is idempotent — it overwrites
      // the previous alarm. If multiple normShares fire for a single publish
      // (e.g., media upload + post creation), each overwrites the last, and
      // the final alarm fires once. If two publishes happen close together,
      // the second overwrites the first — the scrape picks up whatever is newest.
      //
      // chrome.alarms minimum delay is 30 seconds (0.5 minutes) — Chrome
      // silently clamps lower values. This gives LinkedIn time to process
      // the post before we scrape.
      chrome.alarms.create('publish-scrape', { delayInMinutes: 0.5 });
    },
    { urls: [PUBLISH_URL_PATTERN] }
  );
  ```

  **Why no debounce flag?** `chrome.alarms.create` with the same name is idempotent (overwrites the pending alarm). Multiple `normShares` requests during a single publish just reset the timer. No in-memory flag needed — and in-memory flags are lost when the MV3 service worker restarts, while the alarm itself persists across restarts.

- [ ] **Step 1.3: Add the `scrapeLatestPost()` function**

  Add this function in the service worker. It opens a background tab to the user's feed, scrapes the most recent post, and sends it to the server via `/api/ingest`.

  ```ts
  /**
   * Scrape the user's most recent post and send it to the server.
   * Called after publish detection. Uses the existing scrapePostContent()
   * and postToServer() functions.
   *
   * Limitation: hardcoded to persona 1, same as the DASH video URL listener.
   * Post IDs are globally unique so the server resolves the correct persona.
   */
  async function scrapeLatestPost(): Promise<void> {
    // Skip if a sync is currently in progress — avoid conflicting scrapes
    const { syncInProgress } = await chrome.storage.session.get('syncInProgress');
    if (syncInProgress) {
      console.log('[Publish] Skipping publish scrape — sync in progress');
      return;
    }

    let tabId: number | undefined;
    try {
      // Open the user's recent activity (posts only, not reshares/comments/reactions)
      const tab = await chrome.tabs.create({
        active: false,
        url: 'https://www.linkedin.com/in/me/recent-activity/posts/',
      });
      if (!tab.id) return;
      tabId = tab.id;

      await waitForTabLoad(tabId);
      // Brief delay to ensure content script injection
      await new Promise((r) => setTimeout(r, 1500));

      // Extract the most recent post's activity ID from the page
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Find the first post's activity URN in the feed
          const postElements = document.querySelectorAll('[data-urn]');
          for (const el of postElements) {
            const urn = el.getAttribute('data-urn') ?? '';
            const match = urn.match(/activity:(\d+)/);
            if (match) return match[1];
          }
          // Fallback: look for activity links
          const links = document.querySelectorAll('a[href*="activity-"]');
          for (const link of links) {
            const href = (link as HTMLAnchorElement).href;
            const match = href.match(/activity[:-](\d+)/);
            if (match) return match[1];
          }
          return null;
        },
      });

      const postId = result?.result;
      if (!postId) {
        console.warn('[ReachLab] Publish detection: could not find latest post ID');
        if (tabId) try { await chrome.tabs.remove(tabId); } catch {}
        return;
      }

      // Reuse existing scrapePostContent() for two-phase content extraction
      await randomDelay(PACING_MIN_MS, PACING_MAX_MS);
      const content = await scrapePostContent(tabId, postId);

      // Send via existing ingest endpoint — this triggers auto-retro
      // on the server side when full_text is present
      await postToServerDirect({
        posts: [content],
      }, 1);

      console.log(`[ReachLab] Publish detection: scraped and sent post ${postId}`);
    } catch (err: any) {
      console.error('[ReachLab] Publish detection scrape failed:', err.message);
    } finally {
      if (tabId) {
        try { await chrome.tabs.remove(tabId); } catch {}
      }
    }
  }
  ```

  **What happens server-side (no changes needed):**
  1. `/api/ingest` receives the post with `full_text`
  2. The ingest handler already checks for `aiApiKey && payload.posts` with `full_text`
  3. It fires `runAutoRetro(client, db, personaId, postsWithText.map(p => p.id))`
  4. `runAutoRetro` calls `getUnmatchedGenerations(db, personaId, 90)` to get candidates
  5. For each post, it calls `findMatch(client, postExcerpt, candidates)` — signature: `(client: Anthropic, postExcerpt: string, candidates: Array<{ id: number; excerpt: string }>)`
  6. On match: sets `matched_post_id`, `status = 'published'`, `published_text`, runs `analyzeRetro`, stores `retro_json`

- [ ] **Step 1.4: Type-check the extension**
  ```bash
  npx tsc --noEmit --project extension/tsconfig.json
  ```
  Fix any type errors before continuing.

---

### Task 2: Verify extension manifest permissions

**Files:**
- Read: `extension/manifest.json`

- [ ] **Step 2.1: Check for required permissions**
  - `"webRequest"` — already present in permissions array
  - `"scripting"` — already present (needed for `chrome.scripting.executeScript`)
  - `"tabs"` — already present (needed for `chrome.tabs.create`)
  - `*://*.linkedin.com/*` — already in `host_permissions`
  - **No manifest changes needed.** All required permissions are already declared.

- [ ] **Step 2.2: Build the extension**
  ```bash
  pnpm --filter linkedin-analytics-extension build
  ```
  Confirm the build succeeds with no errors.

---

### Task 3: Test end-to-end and run the test suite

- [ ] **Step 3.1: Start the server**
  ```bash
  pnpm dev
  ```

- [ ] **Step 3.2: Run the full test suite**
  ```bash
  pnpm test
  ```
  All tests must pass. No server changes were made, so existing tests should be unaffected.

- [ ] **Step 3.3: Manual end-to-end test**
  1. Load the rebuilt extension in Chrome (`chrome://extensions` → Load unpacked)
  2. Create a generation in ReachLab and copy the final draft
  3. Go to LinkedIn and publish a post using the draft text (can edit it moderately)
  4. Watch the extension service worker console (`chrome://extensions` → Inspect views: service worker)
  5. Expected log sequence:
     - `[Publish] Detected normShares completion, scheduling scrape` log appears
     - `publish-scrape` alarm fires ~30 seconds after publish
     - `[ReachLab] Publish detection: scraped and sent post <id>`
  6. Check the server logs for:
     - `[Auto-Retro] Matched post <id> → generation <id>, retro complete`
  7. In the ReachLab dashboard, the generation should show status "published" with retro results

- [ ] **Step 3.4: Test edge cases**
  - Publish a post that does NOT match any generation → should log no match, no crash
  - Publish while the server is stopped → `postToServerDirect` fails silently, no crash
  - Rapid-fire: publish two posts quickly → second alarm overwrites the first, scrape picks up the newest post
  - Publish while a sync is in progress → publish scrape is skipped (logged), post will be picked up by the ongoing sync

- [ ] **Step 3.5: Commit**
  ```bash
  git add extension/src/background/service-worker.ts
  git commit -m "feat: publish detection — scrape latest post on LinkedIn publish via network intercept"
  ```
  If GPG signing fails: `git -c commit.gpgsign=false commit ...`

---

## Design Decisions

### Why Option A (mini-scrape) over Option B (intercept request body)?

1. **Reuses existing code**: `scrapePostContent()` already handles two-phase scraping (hook → "see more" → full text), image URLs, video URLs, author replies, and thread detection. No new parsing logic.
2. **Reuses existing server flow**: `/api/ingest` already triggers `runAutoRetro` for posts with `full_text`. Zero server changes needed.
3. **Request body interception is fragile**: `webRequest.onCompleted` does not provide the request body in MV3. You'd need `webRequest.onBeforeRequest` with `requestBody`, which only gives form data / raw bytes, not parsed JSON. LinkedIn's API uses its own serialization format (Restli), not plain JSON.

### Why no new server endpoint?

The original plan proposed `POST /api/generate/check-publish`. This is unnecessary because:
- The post must be in the database before matching can happen
- Once the post is in the database (via `/api/ingest`), auto-retro already runs
- Adding a separate endpoint would duplicate the matching + retro logic already in `runAutoRetro`

### Limitations

1. **Hardcoded persona ID = 1**: Same as the existing DASH video URL listener. Post IDs are globally unique, so the server can resolve the correct persona. When multi-persona ships, this should be updated.
2. **`chrome.alarms` minimum delay is 30 seconds**: `delayInMinutes` is set to `0.5` (30 seconds), which is the Chrome-enforced minimum. Lower values are silently clamped. This gives LinkedIn time to process the post before scraping.
3. **Recent activity page may not show the post immediately**: LinkedIn's activity page might have a brief delay before showing the new post. The 30-second alarm delay helps, but if the post doesn't appear, `scrapeLatestPost` will fail gracefully and the post will be picked up at the next scheduled sync.
4. **"See more" content scraping requires content script on `/feed/*`**: The existing content script matches `*://*.linkedin.com/feed/*`. The post page URL (`/feed/update/urn:li:activity:...`) matches this pattern. The recent activity page (`/in/me/recent-activity/posts/`) does NOT match — but we only use it to find the post ID, then navigate to the post page for actual scraping.
5. **Concurrent scrape avoidance**: If a scheduled sync is in progress (`syncInProgress` is set in session storage), the publish scrape is skipped. The sync will pick up the new post anyway.
