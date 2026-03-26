# Generation Auto-Restore Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically restore the most recent in-progress generation when the user navigates back to the Generate tab, eliminating the need to manually re-open from History.
**Architecture:** A new `GET /api/generate/active` endpoint queries for a recent draft-status generation with content; the dashboard calls it on mount and restores state via a shared `restoreGeneration()` helper (extracted from the existing `onOpen` handler), guarded by a ref that prevents restoration if the user has already started interacting.
**Tech Stack:** Fastify v5, better-sqlite3, React, TypeScript

---

### Task 1: Add `getActiveGeneration` query
**Files:**
- Modify: `server/src/db/generate-queries.ts`

- [ ] **Step 1: Add `getActiveGeneration(db, personaId)` function**

  Add a new exported function after the existing query functions. Query selects the single most recent generation row where `status = 'draft'`, `updated_at > datetime('now', '-7 days')`, `drafts_json IS NOT NULL`, and `json_array_length(drafts_json) > 0`, ordered by `updated_at DESC`, limited to 1.

  ```ts
  export function getActiveGeneration(db: Database.Database, personaId: number): GenerationRecord | undefined {
    // Only restore generations that have drafts (step 2+). Step-1-only work (topic + research
    // but no drafts yet) is excluded intentionally — research is cheap to redo and the user
    // hasn't invested significant review effort at that point.
    return db.prepare(`
      SELECT * FROM generations
      WHERE persona_id = ?
        AND status = 'draft'
        AND drafts_json IS NOT NULL
        AND json_array_length(drafts_json) > 0
        AND updated_at > datetime('now', '-7 days')
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(personaId) as GenerationRecord | undefined;
  }
  ```

  The type `GenerationRecord` and `Database.Database` are already imported/defined in this file.

- [ ] **Step 2: Type-check server**

  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  ```

  Fix any type errors before proceeding.

---

### Task 2: Add `GET /api/generate/active` endpoint
**Files:**
- Modify: `server/src/routes/generate.ts`

- [ ] **Step 1: Import `getActiveGeneration` from generate-queries**

  Add `getActiveGeneration` to the existing import from `../db/generate-queries.js`.

- [ ] **Step 2: Register the route**

  Add the route alongside the other generation routes. Use `getPersonaId(request)` (already imported and used by every route in this file) to resolve the persona. Return the same shape as the history detail endpoint (`/api/generate/history/:id`) or `{ generation: null }`.

  ```ts
  app.get('/api/generate/active', async (request) => {
    const personaId = getPersonaId(request);
    const row = getActiveGeneration(db, personaId);
    if (!row) {
      return { generation: null };
    }
    // Enrich with research stories — same logic as history detail endpoint
    let stories: any[] = [];
    let articleCount = 0;
    let sourceCount = 0;
    if (row.research_id) {
      const research = getResearch(db, row.research_id);
      if (research) {
        stories = JSON.parse(research.stories_json);
        articleCount = research.article_count ?? 0;
        sourceCount = research.source_count ?? 0;
      }
    }
    return { generation: { ...row, stories, article_count: articleCount, source_count: sourceCount } };
  });
  ```

  Note: The response includes `drafts_json`, `selected_draft_indices`, and `quality_gate_json` as raw JSON strings — the client is responsible for parsing them, just like with the history detail endpoint.

- [ ] **Step 3: Type-check server**

  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  ```

- [ ] **Step 4: Manual smoke test**

  Start the server (`pnpm dev`) and call the endpoint:

  ```bash
  curl http://localhost:3211/api/generate/active?personaId=1
  ```

  Expect either `{ "generation": null }` or a full generation object with JSON string fields.

- [ ] **Step 5: Commit**

  ```bash
  git add server/src/db/generate-queries.ts server/src/routes/generate.ts
  git -c commit.gpgsign=false commit -m "feat: add GET /api/generate/active endpoint for auto-restore"
  ```

---

### Task 3: Add `getActiveGeneration()` to API client
**Files:**
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add `getActiveGeneration()` method to the `api` object**

  Add alongside other generation API methods. The client uses `getUnscoped<T>(path)` for GET requests that aren't under the persona URL prefix — this automatically appends `personaId` as a query param. The return type is `any` (matching `generateHistoryDetail`), since the response contains raw JSON string fields that the caller must parse.

  ```ts
  getActiveGeneration: () =>
    getUnscoped<{ generation: any | null }>("/generate/active"),
  ```

- [ ] **Step 2: Type-check dashboard**

  ```bash
  npx tsc --noEmit --project dashboard/tsconfig.json
  ```

  Fix any type errors.

---

### Task 4: Add auto-restore to Generate component
**Files:**
- Modify: `dashboard/src/pages/Generate.tsx`

- [ ] **Step 1: Add `useRef` and `useEffect` imports**

  Update the React import to include `useRef` and `useEffect`:

  ```ts
  import { useState, useRef, useEffect } from "react";
  ```

- [ ] **Step 2: Extract `restoreGeneration` helper**

  Extract the restore logic from `GenerationHistory.onOpen` into a shared function. This function takes the raw detail response (with JSON string fields) and returns the `GenerationState` partial and the target step. Place this above the `Generate` component.

  All `JSON.parse` calls must be guarded with try/catch — if any parsing fails, return `null` (treat as no active generation) so corrupt data doesn't crash the app.

  ```ts
  interface RestoreResult {
    state: GenerationState;
    step: 1 | 2 | 3;
  }

  async function restoreGeneration(data: any): Promise<RestoreResult | null> {
    let drafts: GenDraft[];
    let selectedIndices: number[];
    let qualityGate: GenCoachCheckQuality | null;
    try {
      drafts = data.drafts_json ? JSON.parse(data.drafts_json) : [];
      selectedIndices = data.selected_draft_indices ? JSON.parse(data.selected_draft_indices) : [];
      qualityGate = data.quality_gate_json ? JSON.parse(data.quality_gate_json) : null;
    } catch (err) {
      console.error("[Generate] Failed to parse generation JSON:", err);
      return null;
    }

    // Load chat messages only when final_draft exists (matches onOpen behavior)
    let chatMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (data.id && data.final_draft) {
      try {
        const msgs = await api.generateChatHistory(data.id);
        chatMessages = msgs.map((m: any) => ({ role: m.role, content: m.display_content ?? m.content }));
      } catch {
        // Chat history is non-critical — proceed without it
      }
    }

    const state: GenerationState = {
      ...initialState,
      researchId: data.research_id,
      stories: data.stories ?? [],
      articleCount: data.article_count ?? 0,
      sourceCount: data.source_count ?? 0,
      selectedStoryIndex: data.selected_story_index,
      generationId: data.id,
      drafts,
      selectedDraftIndices: selectedIndices,
      combiningGuidance: data.combining_guidance ?? "",
      originalDraft: data.final_draft ?? "",
      finalDraft: data.final_draft ?? "",
      qualityGate,
      personalConnection: data.personal_connection ?? "",
      draftLength: data.draft_length ?? "medium",
      chatMessages,
    };

    // Step mapping: final_draft exists -> step 3 (ReviewEdit), drafts exist -> step 2 (DraftVariations), else step 1
    // Step 4 (PostRetro) is never opened from history/restore.
    let step: 1 | 2 | 3;
    if (data.final_draft) {
      step = 3;
    } else if (drafts.length > 0) {
      step = 2;
    } else {
      step = 1;
    }

    return { state, step };
  }
  ```

- [ ] **Step 3: Add `userActedRef` guard ref**

  Near the top of the `Generate` component, alongside existing state, add:

  ```ts
  const userActedRef = useRef(false);
  ```

- [ ] **Step 4: Mark `userActedRef` on user-initiated events**

  Do NOT wrap `setGen` — that approach is wrong because API callbacks (research results, draft generation results) also call `setGen`, and those are not user actions. Instead, set `userActedRef.current = true` directly in specific user-initiated event handlers within the `Generate` component:

  1. **`resetPipeline`** (user clicks "Start new") — already handled in step 7.
  2. **`SubTabBar.onChange`** — when user switches sub-tabs, mark as acted:

  ```ts
  <SubTabBar active={subTab} onChange={(tab) => {
    userActedRef.current = true;
    setSubTab(tab);
    if (tab !== "Generate") {
      setGen((prev) => ({ ...prev, discoveryTopics: null }));
    }
  }} />
  ```

  Note: Child components (`DiscoveryView`, `DraftVariations`, `ReviewEdit`) still receive the original `setGen` — no wrapping needed. The user-action signal comes from the fact that the auto-restore `useEffect` checks `userActedRef` AFTER its async fetch returns. By that time, any user interaction within a child (typing a topic, clicking research, selecting a story) will have caused React state changes that make the restore stale. The ref is only needed to guard the narrow window between mount and fetch completion. Typing in the topic input is handled by `DiscoveryView`'s local `topicInput` state (not `setGen`), so the ref guard catches the case where the user types but hasn't triggered a `setGen` call yet — we add it to the SubTabBar onChange and resetPipeline as the two Generate-level interactions that could race.

  Additionally, `DiscoveryView` calls `setGen` on mount to restore cached discovery topics (via `getCachedTopics()`). This is NOT a user action — it's programmatic. The `setGenGuarded` wrapper would have incorrectly blocked auto-restore in this case.

- [ ] **Step 5: Add auto-restore `useEffect`**

  Add a `useEffect` that runs once on mount. It calls `api.getActiveGeneration()`, checks `userActedRef.current` AFTER the await (not just before), and if not yet interacted, restores state using the shared `restoreGeneration` helper. The second `userActedRef` check after `restoreGeneration` guards against the user acting during the chat history fetch.

  ```ts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getActiveGeneration();
        const data = res.generation;
        if (cancelled || userActedRef.current || !data) return;

        const result = await restoreGeneration(data);
        // Check userActedRef again — user may have acted during restoreGeneration's
        // async work (e.g., the chat history fetch)
        if (cancelled || userActedRef.current || !result) return;

        setGen(result.state);
        setStep(result.step);
      } catch (err) {
        console.error("Auto-restore failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, []); // empty deps — run once on mount
  ```

  Note on persona changes: `switchPersona()` calls `window.location.reload()`, so the component is fully remounted and this effect re-runs naturally. No need to add `personaId` to the dependency array.

- [ ] **Step 6: Update `onOpen` to use the shared helper**

  Replace the inline restore logic in the `GenerationHistory.onOpen` callback with a call to `restoreGeneration`:

  ```ts
  onOpen={async (id) => {
    try {
      const data = await api.generateHistoryDetail(id);
      const result = await restoreGeneration(data);
      if (!result) return; // JSON parse failed — silently skip
      setGen(result.state);
      setStep(result.step);
      setSubTab("Generate");
    } catch (err) {
      console.error("Failed to restore generation:", err);
    }
  }}
  ```

- [ ] **Step 7: Update `resetPipeline` to discard the DB row**

  When the user clicks "Start new", the old generation stays as `status='draft'` in the DB, so the next mount would auto-restore it. Call the existing discard endpoint to mark it. Log errors instead of swallowing them — the discard is still fire-and-forget but failures should be visible in the console.

  ```ts
  const resetPipeline = () => {
    // Mark current generation as discarded so it won't auto-restore
    if (gen.generationId) {
      api.generateDiscard(gen.generationId).catch(err => console.error("[Generate] Failed to discard:", err));
    }
    userActedRef.current = true;
    setGen(initialState);
    setStep(1);
  };
  ```

  The `generateDiscard` method already exists in the API client and calls `POST /api/generate/history/:id/discard`, which sets `status = 'discarded'`.

- [ ] **Step 8: Type-check dashboard**

  ```bash
  npx tsc --noEmit --project dashboard/tsconfig.json
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add dashboard/src/api/client.ts dashboard/src/pages/Generate.tsx
  git -c commit.gpgsign=false commit -m "feat: auto-restore active generation on Generate tab mount"
  ```

---

### Task 5: Test
**Files:** Test files + verification.

- [ ] **Step 1: Unit test for `getActiveGeneration` query**

  Add a test in the server test suite (e.g., `server/src/__tests__/generate-queries.test.ts` or alongside existing generation tests). The test should:

  1. Create a test DB using `buildApp(testDbPath)`.
  2. Insert a generation with `status = 'draft'`, `drafts_json` containing at least one draft, and `updated_at` within 7 days.
  3. Call `getActiveGeneration(db, personaId)` and assert it returns the generation.
  4. Update the generation's `status` to `'discarded'` and assert `getActiveGeneration` returns `undefined`.
  5. Insert a generation with `updated_at` older than 7 days and assert it is not returned.

- [ ] **Step 2: Route test for `GET /api/generate/active`**

  Add a route test (e.g., alongside existing generation route tests). The test should:

  1. Build the app with a test DB.
  2. Call `GET /api/generate/active?personaId=1` on an empty DB and assert `{ generation: null }`.
  3. Insert a draft generation with drafts, call the endpoint, and assert the response includes the generation with enriched `stories`, `article_count`, `source_count` fields.

- [ ] **Step 3: Run server tests**

  ```bash
  pnpm test -- --run
  ```

  All tests must pass.

- [ ] **Step 4: Document manual test scenarios**

  The following scenarios should be tested manually after implementation:

  **4a: Auto-restore works**
  1. Start dev server: `pnpm dev`
  2. Navigate to Generate tab, complete at least step 1 (topic + research) and step 2 (generate drafts) so `drafts_json` is populated.
  3. Navigate away (switch to another tab).
  4. Navigate back to Generate tab.
  5. Verify the component restores to step 2 (DraftVariations) with previous drafts intact — no blank slate.
  6. If you also combined drafts (creating a `final_draft`), verify it restores to step 3 (ReviewEdit).

  **4b: Blank slate when no active generation**
  1. Discard or publish the active generation (so status is no longer `draft`), or use a fresh DB.
  2. Navigate to Generate tab.
  3. Verify blank slate (step 1, empty topic field).

  **4c: User interaction prevents restore**
  1. Have an active generation in DB.
  2. Navigate to Generate tab.
  3. Immediately start typing in the topic input before the `getActiveGeneration` fetch resolves (throttle network in DevTools if needed).
  4. Verify the restore is skipped — typed content is preserved, not overwritten.

  **4d: Generation older than 7 days is not restored**
  Using SQLite CLI or a test script, manually set `updated_at` on the generation row to 8 days ago:
  ```bash
  sqlite3 data/linkedin.db "UPDATE generations SET updated_at = datetime('now', '-8 days') WHERE id = <id>;"
  ```
  Navigate to Generate tab and verify blank slate.

  **4e: "Start new" prevents re-restore**
  1. Have an active generation in DB.
  2. Navigate to Generate tab — verify it auto-restores.
  3. Click "Start new" — verify it resets to blank slate.
  4. Navigate away and back — verify blank slate (the old generation was discarded, so it is not restored).

  **4f: `status='copied'` is not restored**
  Verify that generations with `status='copied'` are not returned by the active endpoint. The query filters on `status = 'draft'` only, so a copied generation (user already took the text) will not be auto-restored.

  **4g: Draft length is preserved**
  1. Generate drafts with "short" or "long" length selected.
  2. Navigate away and back.
  3. Verify the length selector shows the correct value, not the default "medium".

- [ ] **Step 5: Commit tests**

  ```bash
  git add server/src/__tests__/
  git -c commit.gpgsign=false commit -m "test: add unit and route tests for getActiveGeneration"
  ```

- [ ] **Step 6: Final commit if any fixes were needed**

  ```bash
  git -c commit.gpgsign=false commit -m "fix: <describe any issues found during testing>"
  ```
