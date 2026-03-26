# AI Queries Split Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic `server/src/db/ai-queries.ts` (1,294 lines) into six focused modules under `server/src/db/ai/`, with `ai-queries.ts` becoming a barrel re-export so all existing imports continue to work unchanged.

**Architecture:** Each module owns a single concern (tags, insights, recommendations, deep-dive queries, run management, settings). The barrel re-export at `ai-queries.ts` ensures zero changes are needed at call sites. The test file `server/src/__tests__/ai-queries.test.ts` must pass without modification after every task.

**Tech Stack:** Fastify v5, better-sqlite3 (raw SQL, no ORM), TypeScript ESM (`.js` import extensions required), Vitest.

**Important conventions for all tasks:**

1. **Relative imports must be adjusted for the deeper directory.** Files move from `server/src/db/` to `server/src/db/ai/`, so imports like `../ai/client.js` become `../../ai/client.js`, and `../ai/stats-report.js` becomes `../../ai/stats-report.js`.
2. **Use `import type Database` (not `import Database`)** — `Database` is only used as a type for the `db` parameter, never as a value.
3. **Delete-then-re-export on every task.** After extracting functions to a new file, immediately delete them from `ai-queries.ts` and add a temporary re-export line (e.g., `export { upsertAiTag, getAiTags, ... } from "./ai/tags.js";`). This prevents duplicate code from ever existing and keeps tests green throughout.

---

### Task 1: Create directory and `runs.ts`

> **Why runs first:** `getLatestCompletedRun` is needed by both `insights.ts` (Task 2) and `recommendations.ts` (Task 3). Extracting `runs.ts` first lets those modules import directly from `./runs.js` instead of creating a circular dependency through the barrel.

**Files:**
- Create: `server/src/db/ai/runs.ts`
- Modify: `server/src/db/ai-queries.ts` (delete extracted code, add re-export)
- Test: `server/src/__tests__/ai-queries.test.ts`

- [ ] **Step 1: Create the `server/src/db/ai/` directory.**
  Run: `mkdir -p server/src/db/ai`

- [ ] **Step 2: Read `server/src/db/ai-queries.ts` to locate the following functions and types.**
  Functions to extract:
  - `createRun`
  - `completeRun`
  - `failRun`
  - `getRunningRun`
  - `getRunCost`
  - `getLatestCompletedRun`
  - `getRunLogs`
  - `insertAiLog`
  - `getAiLogsForRun`
  - `listCompletedRuns`
  - `getTotalCostForPersona`
  - `getLastFullRun`
  - `getRunsNeedingCostBackfill`
  - `backfillRunCost`
  - `pruneOldAiLogs`

  **Note:** `clearTagsForPersona` is NOT included here — it will be extracted to `tags.ts` in Task 2.

  Types to extract:
  - `AiLogInput`

- [ ] **Step 3: Create `server/src/db/ai/runs.ts`.**
  - Add `import type Database from "better-sqlite3";` at the top.
  - `getRunCost` calls `calculateCostCents` — add:
    ```ts
    import { calculateCostCents } from "../../ai/client.js";
    ```
  - **Adjust all relative imports** for the deeper directory.
  - Export all types and functions.

- [ ] **Step 4: Delete the extracted types and functions from `ai-queries.ts` and add a re-export.**
  Add to `ai-queries.ts`:
  ```ts
  export { createRun, completeRun, failRun, getRunningRun, getRunCost, getLatestCompletedRun, getRunLogs, insertAiLog, getAiLogsForRun, listCompletedRuns, getTotalCostForPersona, getLastFullRun, getRunsNeedingCostBackfill, backfillRunCost, pruneOldAiLogs } from "./ai/runs.js";
  export type { AiLogInput } from "./ai/runs.js";
  ```

- [ ] **Step 5: Verify tests pass.**
  Run: `pnpm test -- --run`
  Expected: All tests pass.

- [ ] **Step 6: Commit.**
  Run: `git -c commit.gpgsign=false commit -m "refactor: extract runs module to server/src/db/ai/runs.ts"`

---

### Task 2: Create `tags.ts`

**Files:**
- Create: `server/src/db/ai/tags.ts`
- Modify: `server/src/db/ai-queries.ts` (delete extracted code, add re-export)
- Test: `server/src/__tests__/ai-queries.test.ts`

- [ ] **Step 1: Read `server/src/db/ai-queries.ts` to locate the following functions and their associated types.**
  Functions to extract:
  - `upsertAiTag`
  - `getAiTags`
  - `getUntaggedPostIds`
  - `upsertImageTag`
  - `getImageTags`
  - `getUnclassifiedImagePosts`
  - `upsertTaxonomy`
  - `getTaxonomy`
  - `setPostTopics`
  - `getPostTopics`
  - `clearTagsForPersona` (this is a tag-clearing function, belongs here not in `runs.ts`)

  Types to extract:
  - `AiTag`
  - `ImageTagInput`
  - `ImageTag`

- [ ] **Step 2: Create `server/src/db/ai/tags.ts`.**
  - Add `import type Database from "better-sqlite3";` at the top.
  - Add any other imports required by these functions (e.g. shared types from `@reachlab/shared`).
  - **Do not paste verbatim** — adjust all relative imports for the deeper directory (e.g., `../ai/client.js` becomes `../../ai/client.js`).
  - Export all types and functions.

- [ ] **Step 3: Delete the extracted types and functions from `ai-queries.ts` and add a re-export.**
  Add to `ai-queries.ts`:
  ```ts
  export { upsertAiTag, getAiTags, getUntaggedPostIds, upsertImageTag, getImageTags, getUnclassifiedImagePosts, upsertTaxonomy, getTaxonomy, setPostTopics, getPostTopics, clearTagsForPersona } from "./ai/tags.js";
  export type { AiTag, ImageTagInput, ImageTag } from "./ai/tags.js";
  ```

- [ ] **Step 4: Verify tests pass.**
  Run: `pnpm test -- --run`
  Expected: All tests pass.

- [ ] **Step 5: Commit.**
  Run: `git -c commit.gpgsign=false commit -m "refactor: extract tags module to server/src/db/ai/tags.ts"`

---

### Task 3: Create `insights.ts`

**Files:**
- Create: `server/src/db/ai/insights.ts`
- Modify: `server/src/db/ai-queries.ts` (delete extracted code, add re-export)
- Test: `server/src/__tests__/ai-queries.test.ts`

- [ ] **Step 1: Read `server/src/db/ai-queries.ts` to locate the following functions and types.**
  Functions to extract:
  - `insertInsight`
  - `getActiveInsights`
  - `retireInsight`
  - `insertInsightLineage`
  - `upsertOverview`
  - `getLatestOverview`
  - `getChangelog`
  - `getLatestAnalysisGaps`
  - `upsertAnalysisGap`
  - `getLatestPromptSuggestions`
  - `clearPromptSuggestions`

  Types to extract:
  - `InsightInput`
  - `OverviewInput`
  - `AnalysisGapInput`
  - `AnalysisGapRow`

  **Cross-module dependency:** Three functions call `getLatestCompletedRun`: `getLatestOverview`, `getChangelog`, and `getLatestPromptSuggestions`. Since `runs.ts` was already extracted in Task 1, import directly from the sibling module (NOT through the barrel, to avoid circular dependency):
  ```ts
  import { getLatestCompletedRun } from "./runs.js";
  ```

- [ ] **Step 2: Create `server/src/db/ai/insights.ts`.**
  - Add `import type Database from "better-sqlite3";` at the top.
  - Import `PromptSuggestions` from `@reachlab/shared` (used by `getLatestPromptSuggestions`).
  - Import `getLatestCompletedRun` from `./runs.js` (used by `getLatestOverview`, `getChangelog`, and `getLatestPromptSuggestions`).
  - **Adjust all relative imports** for the deeper directory.
  - Export all types and functions.

- [ ] **Step 3: Delete the extracted types and functions from `ai-queries.ts` and add a re-export.**
  Add to `ai-queries.ts`:
  ```ts
  export { insertInsight, getActiveInsights, retireInsight, insertInsightLineage, upsertOverview, getLatestOverview, getChangelog, getLatestAnalysisGaps, upsertAnalysisGap, getLatestPromptSuggestions, clearPromptSuggestions } from "./ai/insights.js";
  export type { InsightInput, OverviewInput, AnalysisGapInput, AnalysisGapRow } from "./ai/insights.js";
  ```

- [ ] **Step 4: Verify tests pass.**
  Run: `pnpm test -- --run`
  Expected: All tests pass.

- [ ] **Step 5: Commit.**
  Run: `git -c commit.gpgsign=false commit -m "refactor: extract insights module to server/src/db/ai/insights.ts"`

---

### Task 4: Create `recommendations.ts`

**Files:**
- Create: `server/src/db/ai/recommendations.ts`
- Modify: `server/src/db/ai-queries.ts` (delete extracted code, add re-export)
- Test: `server/src/__tests__/ai-queries.test.ts`

- [ ] **Step 1: Read `server/src/db/ai-queries.ts` to locate the following functions and types.**
  Functions to extract:
  - `insertRecommendation`
  - `getUnresolvedRecommendationHeadlines`
  - `getRecommendations`
  - `getRecommendationsWithCooldown`
  - `updateRecommendationFeedback`
  - `resolveRecommendation`
  - `getRecommendationById`
  - `markRecommendationActedOn`
  - `getRecentFeedbackWithReasons`

  Types to extract:
  - `RecommendationInput`

  **Cross-module dependency:** `getRecommendations` and `getRecommendationsWithCooldown` both call `getLatestCompletedRun`. Since `runs.ts` was already extracted in Task 1, import directly from the sibling module (NOT through the barrel, to avoid circular dependency):
  ```ts
  import { getLatestCompletedRun } from "./runs.js";
  ```

- [ ] **Step 2: Create `server/src/db/ai/recommendations.ts`.**
  - Add `import type Database from "better-sqlite3";` at the top.
  - Import `getLatestCompletedRun` from `./runs.js` (used by `getRecommendations` and `getRecommendationsWithCooldown`).
  - **Adjust all relative imports** for the deeper directory.
  - Export all types and functions.

- [ ] **Step 3: Delete the extracted types and functions from `ai-queries.ts` and add a re-export.**
  Add to `ai-queries.ts`:
  ```ts
  export { insertRecommendation, getUnresolvedRecommendationHeadlines, getRecommendations, getRecommendationsWithCooldown, updateRecommendationFeedback, resolveRecommendation, getRecommendationById, markRecommendationActedOn, getRecentFeedbackWithReasons } from "./ai/recommendations.js";
  export type { RecommendationInput } from "./ai/recommendations.js";
  ```

- [ ] **Step 4: Verify tests pass.**
  Run: `pnpm test -- --run`
  Expected: All tests pass.

- [ ] **Step 5: Commit.**
  Run: `git -c commit.gpgsign=false commit -m "refactor: extract recommendations module to server/src/db/ai/recommendations.ts"`

---

### Task 5: Create `deep-dive.ts`

**Files:**
- Create: `server/src/db/ai/deep-dive.ts`
- Modify: `server/src/db/ai-queries.ts` (delete extracted code, add re-export)
- Test: `server/src/__tests__/ai-queries.test.ts`

- [ ] **Step 1: Read `server/src/db/ai-queries.ts` to locate the following functions.**
  Functions to extract:
  - `getProgressMetrics`
  - `getCategoryPerformance`
  - `getEngagementQuality`
  - `getSparklineData`
  - `getTopicPerformance`
  - `getHookPerformance`
  - `getImageSubtypePerformance`
  - `getPostCountWithMetrics`
  - `getPostCountSinceRun`

  Note: These functions use shared types from `@reachlab/shared` — import from there rather than declaring locally.

- [ ] **Step 2: Create `server/src/db/ai/deep-dive.ts`.**
  - Add `import type Database from "better-sqlite3";` at the top.
  - Add the following imports from `@reachlab/shared` (used as return types):
    ```ts
    import type { MetricsSummary, CategoryPerformance, SparklinePoint, EngagementQuality, TopicPerformance, HookPerformance, ImageSubtypePerformance } from "@reachlab/shared";
    ```
  - Add imports from `../../ai/stats-report.js` (used by `getTopicPerformance`, `getHookPerformance`, `getImageSubtypePerformance`):
    ```ts
    import { computeWeightedER, median } from "../../ai/stats-report.js";
    ```
  - **Adjust all relative imports** for the deeper directory.
  - Export all functions.

- [ ] **Step 3: Delete the extracted functions from `ai-queries.ts` and add a re-export.**
  Add to `ai-queries.ts`:
  ```ts
  export { getProgressMetrics, getCategoryPerformance, getEngagementQuality, getSparklineData, getTopicPerformance, getHookPerformance, getImageSubtypePerformance, getPostCountWithMetrics, getPostCountSinceRun } from "./ai/deep-dive.js";
  ```

- [ ] **Step 4: Verify tests pass.**
  Run: `pnpm test -- --run`
  Expected: All tests pass.

- [ ] **Step 5: Commit.**
  Run: `git -c commit.gpgsign=false commit -m "refactor: extract deep-dive queries to server/src/db/ai/deep-dive.ts"`

---

### Task 6: Update log retention from 14 to 30 days (separate commit)

**Files:**
- Modify: `server/src/db/ai/runs.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Update `pruneOldAiLogs` default retention from 14 days to 30 days.**
  In `server/src/db/ai/runs.ts`, find the `pruneOldAiLogs` function signature. Change its default parameter from `14` to `30`:
  ```ts
  // Before:
  export function pruneOldAiLogs(db: Database.Database, retentionDays: number = 14): number {
  // After:
  export function pruneOldAiLogs(db: Database.Database, retentionDays: number = 30): number {
  ```

- [ ] **Step 2: Update the log message in `server/src/app.ts`.**
  The startup log at line 227 currently says `"14 days"`. Update it to match the new default:
  ```ts
  // Before:
  console.log(`[Startup] Pruned ${pruned} AI log entries older than 14 days`);
  // After:
  console.log(`[Startup] Pruned ${pruned} AI log entries older than 30 days`);
  ```

- [ ] **Step 3: Verify tests pass.**
  Run: `pnpm test -- --run`
  Expected: All tests pass.

- [ ] **Step 4: Commit the retention change separately.**
  Run: `git -c commit.gpgsign=false commit -m "chore: extend AI log retention from 14 to 30 days"`

---

### Task 7: Create `settings.ts`

**Files:**
- Create: `server/src/db/ai/settings.ts`
- Modify: `server/src/db/ai-queries.ts` (delete extracted code, add re-export)
- Test: `server/src/__tests__/ai-queries.test.ts`

- [ ] **Step 1: Read `server/src/db/ai-queries.ts` to locate the following functions and types.**
  Functions to extract:
  - `getSetting`
  - `upsertSetting`
  - `deleteSetting`
  - `saveWritingPromptHistory`
  - `getWritingPromptHistory`

  Types to extract:
  - `WritingPromptHistoryRow`

  Note: `getPersonaSetting` and `upsertPersonaSetting` do not exist yet — they will be added in the future persona-settings plan. Do not create stubs for them here.

- [ ] **Step 2: Create `server/src/db/ai/settings.ts`.**
  - Add `import type Database from "better-sqlite3";` at the top.
  - **Adjust all relative imports** for the deeper directory.
  - Export all types and functions.

- [ ] **Step 3: Delete the extracted types and functions from `ai-queries.ts` and add a re-export.**
  Add to `ai-queries.ts`:
  ```ts
  export { getSetting, upsertSetting, deleteSetting, saveWritingPromptHistory, getWritingPromptHistory } from "./ai/settings.js";
  export type { WritingPromptHistoryRow } from "./ai/settings.js";
  ```

- [ ] **Step 4: Verify tests pass.**
  Run: `pnpm test -- --run`
  Expected: All tests pass.

- [ ] **Step 5: Commit.**
  Run: `git -c commit.gpgsign=false commit -m "refactor: extract settings module to server/src/db/ai/settings.ts"`

---

### Task 8: Convert `ai-queries.ts` to barrel re-export and verify

**Files:**
- Modify: `server/src/db/ai-queries.ts`
- Test: `server/src/__tests__/ai-queries.test.ts`

- [ ] **Step 1: Read `server/src/db/ai-queries.ts` to confirm all functions have been moved out in Tasks 1–7 and that only re-export lines remain.**
  Verify the file only contains the re-export lines added during Tasks 1–7.

- [ ] **Step 2: Replace the entire contents of `server/src/db/ai-queries.ts` with explicit named re-exports.**
  The file should contain exactly:
  ```ts
  // Barrel re-export — all AI query modules
  // Keep explicit named exports so missing exports cause compile errors.

  // runs (extracted first — other modules depend on getLatestCompletedRun)
  export { createRun, completeRun, failRun, getRunningRun, getRunCost, getLatestCompletedRun, getRunLogs, insertAiLog, getAiLogsForRun, listCompletedRuns, getTotalCostForPersona, getLastFullRun, getRunsNeedingCostBackfill, backfillRunCost, pruneOldAiLogs } from "./ai/runs.js";
  export type { AiLogInput } from "./ai/runs.js";

  // tags
  export { upsertAiTag, getAiTags, getUntaggedPostIds, upsertImageTag, getImageTags, getUnclassifiedImagePosts, upsertTaxonomy, getTaxonomy, setPostTopics, getPostTopics, clearTagsForPersona } from "./ai/tags.js";
  export type { AiTag, ImageTagInput, ImageTag } from "./ai/tags.js";

  // insights (imports getLatestCompletedRun from ./runs.js)
  export { insertInsight, getActiveInsights, retireInsight, insertInsightLineage, upsertOverview, getLatestOverview, getChangelog, getLatestAnalysisGaps, upsertAnalysisGap, getLatestPromptSuggestions, clearPromptSuggestions } from "./ai/insights.js";
  export type { InsightInput, OverviewInput, AnalysisGapInput, AnalysisGapRow } from "./ai/insights.js";

  // recommendations (imports getLatestCompletedRun from ./runs.js)
  export { insertRecommendation, getUnresolvedRecommendationHeadlines, getRecommendations, getRecommendationsWithCooldown, updateRecommendationFeedback, resolveRecommendation, getRecommendationById, markRecommendationActedOn, getRecentFeedbackWithReasons } from "./ai/recommendations.js";
  export type { RecommendationInput } from "./ai/recommendations.js";

  // deep-dive
  export { getProgressMetrics, getCategoryPerformance, getEngagementQuality, getSparklineData, getTopicPerformance, getHookPerformance, getImageSubtypePerformance, getPostCountWithMetrics, getPostCountSinceRun } from "./ai/deep-dive.js";

  // settings
  export { getSetting, upsertSetting, deleteSetting, saveWritingPromptHistory, getWritingPromptHistory } from "./ai/settings.js";
  export type { WritingPromptHistoryRow } from "./ai/settings.js";

  // Re-export shared types that consumers import through this barrel
  export type { PromptSuggestion, PromptSuggestions, MetricsSummary, CategoryPerformance, SparklinePoint, EngagementQuality, TopicPerformance, HookPerformance, ImageSubtypePerformance } from "@reachlab/shared";
  ```

- [ ] **Step 3: Run type-check to catch any missing exports or import errors.**
  Run: `npx tsc --noEmit --project server/tsconfig.json`
  Expected: No errors.

- [ ] **Step 4: Run full test suite.**
  Run: `pnpm test -- --run`
  Expected: All tests pass without any modification to `server/src/__tests__/ai-queries.test.ts`.

  Note: If any test imports `getLatestCompletedRun` directly from `../db/ai-queries.js`, that still works because the barrel re-exports it from `./ai/runs.js`.

- [ ] **Step 5: Commit.**
  Run: `git -c commit.gpgsign=false commit -m "refactor: convert ai-queries.ts to barrel re-export over server/src/db/ai/*"`
