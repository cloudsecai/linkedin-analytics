# Per-Persona Settings Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Dependency:** This plan assumes helpers are added to `server/src/db/ai-queries.ts` (the current monolith). If the ai-queries split (plan `2026-03-26-ai-queries-split.md`) has already been completed, adjust import paths to `../db/ai/settings.js` instead of `../db/ai-queries.js`.

**Goal:** Replace global key-value settings with a per-persona `persona_settings` table, forking persona-scoped keys on persona creation so each persona has independent writing prompts, schedule, thresholds, and discovery labels.
**Architecture:** A new `persona_settings` table (keyed by `persona_id` + `key`) stores the four persona-scoped settings, while global keys remain in the existing `settings` table. A DB migration copies existing values and keeps the old keys in `settings` as a safety net until all code changes are committed and tested; a final cleanup migration removes them. All routes and AI modules that read persona-scoped keys are updated to call new `getPersonaSetting`/`upsertPersonaSetting` helpers, and persona creation forks those keys from the source persona.
**Tech Stack:** Fastify v5, better-sqlite3 (raw SQL), TypeScript ESM, Vitest

> **Out of scope:** `getPersonaId` defaults to persona 1 when no `personaId` query param is provided. This is existing behavior shared across all routes and is a product decision about how to handle the single-persona case. It is not something this plan should change.

---

### Task 1: Migration — create table, copy keys (DO NOT delete from settings yet)

**Files:**
- Create: `server/src/db/migrations/021-persona-settings.sql`

- [ ] **Step 1: Create migration file**

  The migration creates the table and copies data, but does NOT delete from `settings`. This avoids an intermediate state where code still reads from `settings` but the keys are gone. The old keys will be cleaned up in a final migration (Task 11) after all code changes are committed.

  ```sql
  -- Create persona_settings table
  CREATE TABLE persona_settings (
    persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (persona_id, key)
  );

  -- Copy persona-scoped keys from settings into persona_settings for persona 1 only.
  -- Persona 1 is the only persona that has historical data. New personas created later
  -- will get their settings forked via createPersona.

  -- writing_prompt
  INSERT INTO persona_settings (persona_id, key, value)
  SELECT 1, 'writing_prompt', s.value
  FROM settings s
  WHERE s.key = 'writing_prompt' AND s.value IS NOT NULL;

  -- auto_interpret_schedule
  INSERT INTO persona_settings (persona_id, key, value)
  SELECT 1, 'auto_interpret_schedule', s.value
  FROM settings s
  WHERE s.key = 'auto_interpret_schedule' AND s.value IS NOT NULL;

  -- auto_interpret_post_threshold
  INSERT INTO persona_settings (persona_id, key, value)
  SELECT 1, 'auto_interpret_post_threshold', s.value
  FROM settings s
  WHERE s.key = 'auto_interpret_post_threshold' AND s.value IS NOT NULL;

  -- last_discovery_labels — copy for persona 1 only (they have analysis history).
  -- New personas init as [] since they have no discovery history.
  INSERT INTO persona_settings (persona_id, key, value)
  SELECT 1, 'last_discovery_labels', COALESCE(s.value, '[]')
  FROM settings s
  WHERE s.key = 'last_discovery_labels'
  UNION ALL
  SELECT 1, 'last_discovery_labels', '[]'
  WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'last_discovery_labels');

  -- NOTE: Old keys are intentionally left in settings as a safety net.
  -- They will be removed by migration 022 (Task 11) after all code is updated.
  ```

- [ ] **Step 2: Verify migration runs on server startup without errors**

  Start the server briefly (`pnpm dev`) and confirm no migration errors in stdout. Kill it with `pnpm kill-existing`.

- [ ] **Step 3: Commit**

  ```
  git commit -m "feat: add persona_settings migration 021 (create table, copy keys)"
  ```

---

### Task 2: DB helpers — getPersonaSetting / upsertPersonaSetting

**Files:**
- Modify: `server/src/db/ai-queries.ts`
- Modify: `server/src/__tests__/settings-routes.test.ts`

- [ ] **Step 1: Add `getPersonaSetting` helper**

  Add after existing `getSetting` in `server/src/db/ai-queries.ts`:

  ```ts
  const VALID_PERSONA_SETTING_KEYS = new Set([
    'writing_prompt',
    'auto_interpret_schedule',
    'auto_interpret_post_threshold',
    'last_discovery_labels',
  ]);

  export function getPersonaSetting(db: Database.Database, personaId: number, key: string): string | null {
    const row = db.prepare(
      'SELECT value FROM persona_settings WHERE persona_id = ? AND key = ?'
    ).get(personaId, key) as { value: string } | undefined;
    return row?.value ?? null;
  }
  ```

- [ ] **Step 2: Add `upsertPersonaSetting` helper with key validation**

  Add after existing `upsertSetting` in `server/src/db/ai-queries.ts`. The allowlist prevents callers from storing arbitrary keys in the table:

  ```ts
  export function upsertPersonaSetting(db: Database.Database, personaId: number, key: string, value: string): void {
    if (!VALID_PERSONA_SETTING_KEYS.has(key)) {
      throw new Error(`Invalid persona setting key: ${key}. Valid keys: ${[...VALID_PERSONA_SETTING_KEYS].join(', ')}`);
    }
    db.prepare(`
      INSERT INTO persona_settings (persona_id, key, value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (persona_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(personaId, key, value);
  }
  ```

- [ ] **Step 3: Write unit tests in `settings-routes.test.ts`**

  Add a describe block that:
  - Calls `upsertPersonaSetting(db, 1, 'writing_prompt', 'test prompt')` then asserts `getPersonaSetting(db, 1, 'writing_prompt') === 'test prompt'`.
  - Asserts `getPersonaSetting(db, 1, 'nonexistent_key') === null`.
  - Asserts persona 2's value is independent from persona 1's.
  - Asserts `upsertPersonaSetting(db, 1, 'bogus_key', 'val')` throws an error (key allowlist enforcement).

- [ ] **Step 4: Write migration test**

  Add a test that:
  - Seeds `settings` table with `writing_prompt`, `auto_interpret_schedule`, `auto_interpret_post_threshold`, and `last_discovery_labels` values.
  - Runs the migration (or verifies the migration already ran during test DB setup).
  - Asserts `getPersonaSetting(db, 1, 'writing_prompt')` returns the seeded value.
  - Asserts `getPersonaSetting(db, 1, 'last_discovery_labels')` returns the seeded value (not `[]`).
  - Asserts `getPersonaSetting(db, 1, 'auto_interpret_schedule')` returns the seeded value.

- [ ] **Step 5: Type-check and run tests**

  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  pnpm test -- --run
  ```

- [ ] **Step 6: Commit**

  ```
  git commit -m "feat: add getPersonaSetting / upsertPersonaSetting helpers with key allowlist"
  ```

---

### Task 3: Update settings routes — writing-prompt and auto-refresh

**Files:**
- Modify: `server/src/routes/settings.ts`
- Modify: `server/src/db/ai-queries.ts`

- [ ] **Step 1: Import new helpers**

  Add `getPersonaSetting` and `upsertPersonaSetting` to the existing import from `../db/ai-queries.js`:

  ```ts
  import {
    getSetting,
    upsertSetting,
    saveWritingPromptHistory,
    getWritingPromptHistory,
    clearPromptSuggestions,
    getPersonaSetting,
    upsertPersonaSetting,
  } from "../db/ai-queries.js";
  ```

  Note: `getPersonaId` is already imported from `../utils.js` — do NOT add a duplicate import.

- [ ] **Step 2: Update `GET /api/settings/writing-prompt`**

  The current handler signature is `async () => { ... }` which has no `request` parameter. Change signature to `async (request) => { ... }` so `getPersonaId(request)` can be called:

  ```ts
  // before
  app.get("/api/settings/writing-prompt", async () => {
    const text = getSetting(db, "writing_prompt");
    return { text: text ?? null };
  });

  // after
  app.get("/api/settings/writing-prompt", async (request) => {
    const personaId = getPersonaId(request);
    const text = getPersonaSetting(db, personaId, 'writing_prompt');
    return { text: text ?? null };
  });
  ```

- [ ] **Step 3: Update `PUT /api/settings/writing-prompt`**

  The PUT handler already has `request` and `personaId`. Replace `upsertSetting` with `upsertPersonaSetting`. The field on the body is `body.text` (NOT `body.prompt`):

  ```ts
  // before
  upsertSetting(db, "writing_prompt", body.text);

  // after
  upsertPersonaSetting(db, personaId, "writing_prompt", body.text);
  ```

- [ ] **Step 4: Persona-scope `clearPromptSuggestions`**

  The current `clearPromptSuggestions` in `server/src/db/ai-queries.ts` clears the latest `ai_overview` row globally (no persona filter):

  ```ts
  // current implementation
  export function clearPromptSuggestions(db: Database.Database): void {
    db.prepare(
      "UPDATE ai_overview SET prompt_suggestions_json = NULL WHERE id = (SELECT MAX(id) FROM ai_overview)"
    ).run();
  }
  ```

  The `ai_overview` table has `run_id INTEGER NOT NULL REFERENCES ai_runs(id)`, and `ai_runs` has `persona_id`. The subquery must JOIN through `ai_runs` to scope by persona. `run_id` is guaranteed NOT NULL so the JOIN is safe.

  Update it to accept a `personaId` parameter and scope the update to that persona's latest overview:

  ```ts
  export function clearPromptSuggestions(db: Database.Database, personaId: number): void {
    db.prepare(
      `UPDATE ai_overview SET prompt_suggestions_json = NULL
       WHERE id = (SELECT MAX(ao.id) FROM ai_overview ao JOIN ai_runs ar ON ao.run_id = ar.id WHERE ar.persona_id = ?)`
    ).run(personaId);
  }
  ```

  Then update the call site in `settings.ts`:

  ```ts
  // before
  clearPromptSuggestions(db);

  // after
  clearPromptSuggestions(db, personaId);
  ```

- [ ] **Step 5: Update `GET /api/settings/auto-refresh`**

  Change the handler signature from `async () => { ... }` to `async (request) => { ... }`, then replace `getSetting` calls:

  ```ts
  // before
  app.get("/api/settings/auto-refresh", async () => {
    const schedule = getSetting(db, "auto_interpret_schedule") ?? "weekly";
    const postThreshold = getSetting(db, "auto_interpret_post_threshold") ?? "5";
    return { schedule, post_threshold: parseInt(postThreshold, 10) };
  });

  // after
  app.get("/api/settings/auto-refresh", async (request) => {
    const personaId = getPersonaId(request);
    const schedule = getPersonaSetting(db, personaId, "auto_interpret_schedule") ?? "weekly";
    const postThreshold = getPersonaSetting(db, personaId, "auto_interpret_post_threshold") ?? "5";
    return { schedule, post_threshold: parseInt(postThreshold, 10) };
  });
  ```

- [ ] **Step 6: Update `PUT /api/settings/auto-refresh`**

  Replace `upsertSetting` calls for schedule/threshold with `upsertPersonaSetting(db, getPersonaId(request), key, value)`.

- [ ] **Step 7: Type-check and run tests**

  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  pnpm test -- --run
  ```

- [ ] **Step 8: Commit**

  ```
  git commit -m "feat: persona-scope writing-prompt and auto-refresh settings endpoints"
  ```

---

### Task 4: Update generate.ts — writing prompt in retro endpoint

**Files:**
- Modify: `server/src/routes/generate.ts`

- [ ] **Step 1: Import `getPersonaSetting`**

  Add `getPersonaSetting` to the existing import from `../db/ai-queries.js`. Note: `getPersonaId` is already imported from `../utils.js` — do NOT add a duplicate.

- [ ] **Step 2: Replace `getSetting(db, "writing_prompt")` in the retro endpoint**

  The retro endpoint already has `personaId` available via `getPersonaId(request)`. Replace:

  ```ts
  // before
  const writingPromptValue = getSetting(db, "writing_prompt");

  // after
  const writingPromptValue = getPersonaSetting(db, personaId, "writing_prompt");
  ```

  Where `personaId` is already resolved earlier in the handler. If it is not already resolved before this line, add `const personaId = getPersonaId(request);` before this line.

- [ ] **Step 3: Type-check and run tests**

  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  pnpm test -- --run
  ```

- [ ] **Step 4: Commit**

  ```
  git commit -m "feat: use persona-scoped writing prompt in generate retro endpoint"
  ```

---

### Task 5: Update insights.ts and ingest.ts — schedule/threshold reads

**Files:**
- Modify: `server/src/routes/insights.ts`
- Modify: `server/src/routes/ingest.ts`

- [ ] **Step 1: Update `insights.ts` — `GET /api/insights/status`**

  The `GET /api/insights/status` handler reads `auto_interpret_schedule` and `auto_interpret_post_threshold` via `getSetting`. It already has `personaId` from `getPersonaId(request)`.

  Add `getPersonaSetting` to the existing import from `../db/ai-queries.js`. Then replace:

  ```ts
  // before
  const schedule = getSetting(db, "auto_interpret_schedule") ?? "weekly";
  const postThreshold = parseInt(getSetting(db, "auto_interpret_post_threshold") ?? "5", 10);

  // after
  const schedule = getPersonaSetting(db, personaId, "auto_interpret_schedule") ?? "weekly";
  const postThreshold = parseInt(getPersonaSetting(db, personaId, "auto_interpret_post_threshold") ?? "5", 10);
  ```

  Note: `getSetting` import must remain because `insights.ts` does NOT use `getSetting` for any other calls currently, BUT verify no other calls exist before removing it. If no other `getSetting` calls remain, remove it from the import.

- [ ] **Step 2: Update `ingest.ts` schedule/threshold reads**

  In `ingest.ts`, the auto-trigger AI pipeline section uses `getSetting` (dynamically imported) for `auto_interpret_schedule` and `auto_interpret_post_threshold`. The `personaId` is already available in scope.

  Update the dynamic import at line ~250 to also import `getPersonaSetting`:

  ```ts
  // In the dynamic import destructuring, add getPersonaSetting:
  ]).then(([{ runTaggingPipeline, runFullPipeline }, { getPostCountWithMetrics, getLatestCompletedRun, getRunningRun, getSetting, getUntaggedPostIds, getPersonaSetting }, { createClient }]) => {
  ```

  Then replace the two `getSetting` calls:

  ```ts
  // before
  const schedule = getSetting(db, "auto_interpret_schedule") ?? "weekly";
  const postThreshold = parseInt(getSetting(db, "auto_interpret_post_threshold") ?? "5", 10);

  // after
  const schedule = getPersonaSetting(db, personaId, "auto_interpret_schedule") ?? "weekly";
  const postThreshold = parseInt(getPersonaSetting(db, personaId, "auto_interpret_post_threshold") ?? "5", 10);
  ```

  Note: `getSetting` is still used at the top-level import in `ingest.ts` for sync warning keys (`sync_warning`, `sync_stale_warning`), so do NOT remove the top-level `getSetting` import.

- [ ] **Step 3: Type-check and run tests**

  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  pnpm test -- --run
  ```

- [ ] **Step 4: Commit**

  ```
  git commit -m "feat: use persona-scoped schedule/threshold in insights and ingest routes"
  ```

---

### Task 6: Update AI modules — orchestrator.ts, discovery.ts, and auto-retro.ts

**Files:**
- Modify: `server/src/ai/orchestrator.ts`
- Modify: `server/src/ai/discovery.ts`
- Modify: `server/src/ai/rss-fetcher.ts`
- Modify: `server/src/ai/auto-retro.ts`

- [ ] **Step 1: Update `orchestrator.ts` writing prompt read**

  `orchestrator.ts` reads both `timezone` and `writing_prompt` via `getSetting` (line ~190-191 in `runFullPipeline`):

  ```ts
  const timezone = getSetting(db, "timezone") ?? "UTC";
  const writingPrompt = getSetting(db, "writing_prompt");
  ```

  Import `getPersonaSetting` from `../db/ai-queries.js` (add to existing import). Replace the `writing_prompt` read only — `timezone` remains global:

  ```ts
  // after
  const timezone = getSetting(db, "timezone") ?? "UTC";
  const writingPrompt = getPersonaSetting(db, personaId, "writing_prompt");
  ```

  The `personaId` parameter is already available in `runFullPipeline`'s function signature. Keep the `getSetting` import since it is still needed for `timezone`.

- [ ] **Step 2: Scope `fetchAllFeeds` by persona**

  `fetchAllFeeds` in `server/src/ai/rss-fetcher.ts` calls `getEnabledSources` which queries `research_sources` globally (`WHERE enabled = 1`) without filtering by `persona_id`. Since `research_sources` has a `persona_id` column, this means `discoverTopics` fetches RSS items from ALL personas' sources — a persona could see topics from sources they don't have configured.

  Update `getEnabledSources` and `fetchAllFeeds` to accept `personaId`:

  ```ts
  // before
  export function getEnabledSources(db: Database.Database): RssSource[] {
    return db
      .prepare("SELECT * FROM research_sources WHERE enabled = 1")
      .all() as RssSource[];
  }

  export async function fetchAllFeeds(db: Database.Database): Promise<RssItem[]> {
    const sources = getEnabledSources(db);

  // after
  export function getEnabledSources(db: Database.Database, personaId: number): RssSource[] {
    return db
      .prepare("SELECT * FROM research_sources WHERE enabled = 1 AND persona_id = ?")
      .all(personaId) as RssSource[];
  }

  export async function fetchAllFeeds(db: Database.Database, personaId: number): Promise<RssItem[]> {
    const sources = getEnabledSources(db, personaId);
  ```

  Then update all call sites of `fetchAllFeeds` to pass `personaId`. The call in `discoverTopics` (updated in Step 3 below) will thread `personaId` through.

- [ ] **Step 3: Update `discovery.ts` — writing prompt read AND taxonomy/RSS scoping**

  `discovery.ts` has TWO persona-scoping issues beyond the writing prompt:

  **Issue A: Taxonomy query is global.** The query `SELECT name FROM ai_taxonomy ORDER BY name` reads ALL taxonomy topics regardless of persona. `ai_taxonomy` does not have a `persona_id` column — it is a shared global taxonomy. This is acceptable for now since taxonomy topics are derived from post analysis which is already persona-scoped upstream (the orchestrator only analyzes posts for the given persona). The taxonomy table itself is a shared vocabulary, not per-persona data. No change needed here.

  **Issue B: `fetchAllFeeds` is global.** Fixed in Step 2 above.

  Import `getPersonaSetting` from `../db/ai-queries.js`. Thread `personaId` through the function signature (add it as a new parameter):

  ```ts
  // before
  export async function discoverTopics(
    client: Anthropic,
    db: Database.Database,
    logger: AiLogger,
    previousLabels?: string[]
  ): Promise<DiscoveryResult> {

  // after
  export async function discoverTopics(
    client: Anthropic,
    db: Database.Database,
    personaId: number,
    logger: AiLogger,
    previousLabels?: string[]
  ): Promise<DiscoveryResult> {
  ```

  Update the `fetchAllFeeds` call to pass `personaId`:

  ```ts
  // before
  const rssItems = await fetchAllFeeds(db);

  // after
  const rssItems = await fetchAllFeeds(db, personaId);
  ```

  Replace the inline SQL for the writing prompt:

  ```ts
  // before
  const writingPrompt = db
    .prepare("SELECT value FROM settings WHERE key = 'writing_prompt'")
    .get() as { value: string } | undefined;
  // ... later ...
  if (writingPrompt?.value) {

  // after
  const writingPromptValue = getPersonaSetting(db, personaId, "writing_prompt");
  // ... later ...
  if (writingPromptValue) {
    contextParts.push(`Creator's writing brief:\n${writingPromptValue}`);
  }
  ```

  Then update all call sites of `discoverTopics` to pass `personaId`. The call site in `generate-sources.ts` already has `personaId` from `getPersonaId(request)`.

- [ ] **Step 4: Update `auto-retro.ts` writing prompt read**

  This file uses inline SQL to read the writing prompt (line ~77-81):

  ```ts
  const writingPrompt = (
    db
      .prepare("SELECT value FROM settings WHERE key = 'writing_prompt'")
      .get() as { value: string } | undefined
  )?.value;
  ```

  Import `getPersonaSetting` from `../db/ai-queries.js`. The `personaId` parameter is already available in `runAutoRetro`'s function signature. Replace:

  ```ts
  const writingPrompt = getPersonaSetting(db, personaId, "writing_prompt");
  ```

- [ ] **Step 5: Type-check and run tests**

  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  pnpm test -- --run
  ```

- [ ] **Step 6: Commit**

  ```
  git commit -m "feat: use persona-scoped writing prompt and RSS feeds in orchestrator, discovery, and auto-retro"
  ```

---

### Task 7: Fork persona-scoped settings on persona creation

**Files:**
- Modify: `server/src/db/persona-queries.ts`

- [ ] **Step 1: Import helpers**

  Add import at the top of `persona-queries.ts`:

  ```ts
  import { getPersonaSetting, upsertPersonaSetting } from "./ai-queries.js";
  ```

- [ ] **Step 2: Add settings fork to `createPersona` transaction**

  Inside the existing transaction in `createPersona` (after inserting persona, author_profile, RSS sources, generation rules), add settings fork. Use the source persona's settings with a fallback if persona 1 doesn't exist:

  ```ts
  // Fork persona-scoped settings from source persona (default persona 1)
  const sourcePersonaId = 1; // future: accept as parameter for fork-from-any
  const PERSONA_SCOPED_KEYS = [
    'writing_prompt',
    'auto_interpret_schedule',
    'auto_interpret_post_threshold',
  ];

  for (const key of PERSONA_SCOPED_KEYS) {
    const value = getPersonaSetting(db, sourcePersonaId, key);
    if (value !== null) {
      upsertPersonaSetting(db, personaId, key, value);
    }
  }

  // Discovery labels always init as empty for new personas — they have no analysis history
  upsertPersonaSetting(db, personaId, 'last_discovery_labels', '[]');
  ```

  Note: The variable holding the new persona ID in `createPersona` is `personaId` (from `result.lastInsertRowid as number`).

- [ ] **Step 3: Type-check and run tests**

  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  pnpm test -- --run
  ```

- [ ] **Step 4: Commit**

  ```
  git commit -m "feat: fork persona-scoped settings on persona creation"
  ```

---

### Task 8: Update generate-sources.ts — discovery labels + discoverTopics call

**Files:**
- Modify: `server/src/routes/generate-sources.ts`

- [ ] **Step 1: Import `getPersonaSetting` and `upsertPersonaSetting`**

  Add to the existing import from `../db/ai-queries.js`:

  ```ts
  import { createRun, completeRun, failRun, getRunCost, getPersonaSetting, upsertPersonaSetting } from "../db/ai-queries.js";
  ```

  Remove `getSetting` and `upsertSetting` from the import since they are no longer used for `last_discovery_labels` in this file. Verify no other calls to `getSetting`/`upsertSetting` remain — if they do, keep them.

- [ ] **Step 2: Replace `getSetting`/`upsertSetting` calls for `last_discovery_labels`**

  The `personaId` is already available from `getPersonaId(request)` in the discover handler. Replace:

  ```ts
  // before
  const prevRaw = getSetting(db, "last_discovery_labels");
  // ...
  upsertSetting(db, "last_discovery_labels", JSON.stringify(allLabels));

  // after
  const prevRaw = getPersonaSetting(db, personaId, "last_discovery_labels");
  // ...
  upsertPersonaSetting(db, personaId, "last_discovery_labels", JSON.stringify(allLabels));
  ```

- [ ] **Step 3: Update `discoverTopics` call to pass `personaId`**

  After Task 6 Step 3 changed the `discoverTopics` signature to accept `personaId`, update the call:

  ```ts
  // before
  const result = await discoverTopics(client, db, logger, previousLabels);

  // after
  const result = await discoverTopics(client, db, personaId, logger, previousLabels);
  ```

- [ ] **Step 4: Type-check and run tests**

  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  pnpm test -- --run
  ```

- [ ] **Step 5: Commit**

  ```
  git commit -m "feat: use persona-scoped discovery labels in generate-sources"
  ```

---

### Task 9: Dashboard API client verification

**Files:**
- Verify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Verify dashboard API calls pass personaId**

  The dashboard client uses `getUnscoped()` for GET calls and `withPersonaId()` for PUT/POST calls. Both already append `?personaId=N` to the URL. Verify:

  - `getWritingPrompt` uses `getUnscoped("/settings/writing-prompt")` -- passes personaId via query string. OK.
  - `saveWritingPrompt` uses `fetch(withPersonaId("/api/settings/writing-prompt"), ...)` -- passes personaId. OK.
  - `getAutoRefreshSettings` uses `getUnscoped("/settings/auto-refresh")` -- passes personaId. OK.
  - `saveAutoRefreshSettings` uses `fetch(withPersonaId("/api/settings/auto-refresh"), ...)` -- passes personaId. OK.

  No dashboard changes needed -- the client already routes personaId correctly. The only change was on the server side (GET handlers now read `request` to extract it).

- [ ] **Step 2: Commit (only if changes were needed)**

---

### Task 10: Full test suite verification

**Files:** No file changes -- verification only.

- [ ] **Step 1: Run full test suite**

  ```bash
  pnpm test -- --run
  ```

  All tests must pass. If any test is failing due to `settings` table lookups returning `null` for persona-scoped keys (because the migration removed them), update the test setup to seed `persona_settings` instead of `settings` for those keys.

- [ ] **Step 2: Run both type-checks**

  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  npx tsc --noEmit --project dashboard/tsconfig.json
  ```

- [ ] **Step 3: Smoke test manually**

  - Start `pnpm dev`.
  - Hit `GET /api/settings/writing-prompt?personaId=1` -- confirm returns a value.
  - Hit `PUT /api/settings/writing-prompt` with body `{ "text": "...", "source": "manual_edit" }` and `?personaId=1` -- confirm persists.
  - Confirm persona 2 (if it exists) has its own independent writing prompt.
  - Hit `POST /api/generate/discover?personaId=1` -- confirm discovery still works (tests `discovery.ts` change).

- [ ] **Step 4: Final commit if any test fixes were needed**

  ```
  git commit -m "fix: update test fixtures to use persona_settings for persona-scoped keys"
  ```

---

### Task 11: Cleanup migration — delete old keys from settings

**Files:**
- Create: `server/src/db/migrations/022-remove-persona-keys-from-settings.sql`

This task MUST be done last, after all code changes from Tasks 2-10 are committed and tested. At this point no code reads these keys from `settings` anymore, so it is safe to remove them.

- [ ] **Step 1: Create cleanup migration**

  ```sql
  -- Remove persona-scoped keys from global settings.
  -- All code now reads from persona_settings instead (Tasks 2-10).
  DELETE FROM settings WHERE key IN (
    'writing_prompt',
    'auto_interpret_schedule',
    'auto_interpret_post_threshold',
    'last_discovery_labels'
  );
  ```

- [ ] **Step 2: Verify migration runs on server startup without errors**

  Start the server briefly (`pnpm dev`) and confirm no migration errors in stdout. Kill it with `pnpm kill-existing`.

- [ ] **Step 3: Run full test suite one more time**

  ```bash
  pnpm test -- --run
  ```

- [ ] **Step 4: Commit**

  ```
  git commit -m "chore: remove persona-scoped keys from settings table (cleanup migration 022)"
  ```
