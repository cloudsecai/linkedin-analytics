# Per-Call AI Timeout Tuning Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the uniform 90s default timeout on all Anthropic SDK calls with per-call timeouts and retry counts tuned to each call's model, expected latency, and whether it is user-facing or background.
**Architecture:** Every `client.messages.create({...})` call in `server/src/ai/` and one in `server/src/routes/generate.ts` receives a second options argument `{ timeout: N, maxRetries: M }`. No new abstractions are introduced — this is a mechanical, file-by-file change using the SDK's built-in per-request override support.
**Tech Stack:** Fastify v5, Anthropic SDK (OpenRouter), TypeScript ESM, Vitest

### Implementation Notes

**Client-level defaults:** `client.ts` currently sets `timeout: 90_000` and `maxRetries: 2` on the Anthropic client constructor. Since every call in this plan explicitly sets its own timeout/retries, the client-level defaults become a safety net only. After all per-call overrides are in place (Task 6), remove `timeout` and `maxRetries` from `createClient()` in `client.ts` so there is no hidden fallback masking a missed call site. If a new call site is added without explicit options, it will use the SDK's own defaults (no timeout, 2 retries), which will be obvious during testing.

**Failure behavior:** When retries are exhausted, the SDK throws an `APIConnectionTimeoutError` (for timeouts) or the relevant `APIError` subclass (for HTTP errors). These errors propagate to the caller. Background callers (orchestrator, auto-retro) already wrap AI calls in try/catch with logging. User-facing route handlers in `generate.ts` already catch errors and return 500 responses. No new error handling is needed.

**Empirical tuning:** The timeout values below are reasonable starting points based on model speed and output size. After deployment, monitor actual `duration_ms` values in `ai_logs` and adjust. A query like `SELECT model, step, MAX(duration_ms), AVG(duration_ms) FROM ai_logs GROUP BY model, step` will show where headroom exists.

---

### Task 1: Background Haiku calls — 30s / 2 retries

**Files:**
- Modify: `server/src/ai/auto-retro.ts` (findMatch call only)
- Modify: `server/src/ai/tagger.ts`
- Modify: `server/src/ai/image-classifier.ts`
- Modify: `server/src/ai/discovery.ts`
- Modify: `server/src/ai/orchestrator.ts`
- Modify: `server/src/ai/taxonomy.ts`

- [ ] **Step 1: Update `auto-retro.ts` findMatch call.**
  Find the `client.messages.create({` call in the `findMatch` function (uses `MODELS.HAIKU`) and add the options argument.

  Before:
  ```ts
  client.messages.create({
    model: MODELS.HAIKU,
    ...
  })
  ```
  After:
  ```ts
  client.messages.create({
    model: MODELS.HAIKU,
    ...
  }, { timeout: 30_000, maxRetries: 2 })
  ```

- [ ] **Step 2: Repeat the same pattern for `tagger.ts`** — find `client.messages.create({`, add `{ timeout: 30_000, maxRetries: 2 }` as the second argument.

- [ ] **Step 3: Repeat for `image-classifier.ts`** — same second argument `{ timeout: 30_000, maxRetries: 2 }`.

  Note: `classifyImages` iterates over N images sequentially, calling the API once per image. The timeout applies per individual image classification, so worst-case wall time is N x 30s. This is acceptable because the function runs in the background and N is typically small (1-3 images per post). If image counts grow, consider reducing to 20s per call.

- [ ] **Step 4: Repeat for `discovery.ts`** — same second argument `{ timeout: 30_000, maxRetries: 2 }`.

- [ ] **Step 5: Repeat for `orchestrator.ts` `reasonResponse` call** — same second argument `{ timeout: 30_000, maxRetries: 2 }`.

- [ ] **Step 6: Update `taxonomy.ts`** — same second argument `{ timeout: 30_000, maxRetries: 2 }`.
  This call uses `MODELS.HAIKU` (not Sonnet as previously assumed), so it belongs in the background Haiku group.

- [ ] **Step 7: Commit.**
  ```bash
  git commit -m "feat: set 30s timeout + 2 retries on background Haiku calls"
  ```

---

### Task 2: User-facing Haiku calls — 45s / 2 retries

**Files:**
- Modify: `server/src/ai/researcher.ts`

- [ ] **Step 1: Update `researcher.ts` synthesis call.**
  Find `client.messages.create({` in the `synthesizeTopic` function and add the second argument:
  ```ts
  }, { timeout: 45_000, maxRetries: 2 })
  ```
  This is user-facing — called from `POST /api/generate/research` in the request/response cycle. Uses Haiku but with slightly longer expected output than pure classifiers. The 45s timeout gives headroom while still failing faster than the 90s client default.

- [ ] **Step 2: Commit.**
  ```bash
  git commit -m "feat: set 45s timeout + 2 retries on researcher.ts synthesis call"
  ```

---

### Task 3: User-facing Sonnet calls — 90s / 1 retry

**Files:**
- Modify: `server/src/ai/drafter.ts`
- Modify: `server/src/ai/combiner.ts` (2 calls)
- Modify: `server/src/ai/coach-check.ts` (2 calls)
- Modify: `server/src/ai/retro.ts` (signature change + default options)
- Modify: `server/src/ai/auto-retro.ts` (pass background options to `analyzeRetro`)
- Modify: `server/src/ai/profile-extractor.ts`

- [ ] **Step 1: Update `drafter.ts`.**
  Find `client.messages.create({` and add:
  ```ts
  }, { timeout: 90_000, maxRetries: 1 })
  ```
  Note: `generateDrafts` fires 3 parallel Sonnet calls via `Promise.all`. The timeout applies per-call, not to the group. All three run concurrently, so the wall-clock time is roughly equal to the slowest single call (up to 90s), not 3x90s.

- [ ] **Step 2: Update both `client.messages.create` calls in `combiner.ts`** — add `{ timeout: 90_000, maxRetries: 1 }` to each. Confirm both calls are updated.

- [ ] **Step 3: Update both `client.messages.create` calls in `coach-check.ts`** — add `{ timeout: 90_000, maxRetries: 1 }` to each. Confirm both calls are updated.

- [ ] **Step 4: Update `retro.ts` — make `analyzeRetro` accept optional timeout/retry params.**
  `retro.ts` is called from two contexts with different needs:
  - **User-facing** (`POST /api/generate/retro` in `routes/generate.ts`): needs fast failure — 90s / 1 retry.
  - **Background** (`auto-retro.ts` fire-and-forget from ingest): can tolerate longer waits — 120s / 2 retries.

  Add an optional `options` parameter to `analyzeRetro` and pass it through to the SDK call:
  ```ts
  // In retro.ts, update the function signature:
  export async function analyzeRetro(
    client: Anthropic,
    draftText: string,
    publishedText: string,
    existingRules: string[],
    currentWritingPrompt?: string,
    requestOptions?: { timeout?: number; maxRetries?: number }
  ): Promise<{ analysis: RetroAnalysis; input_tokens: number; output_tokens: number }> {
  ```

  Then pass `requestOptions` as the second argument to `client.messages.create`:
  ```ts
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 3000,
    ...
  }, requestOptions ?? { timeout: 90_000, maxRetries: 1 });
  ```

  The default `{ timeout: 90_000, maxRetries: 1 }` covers the user-facing path (which passes no options).

  Then update the caller in `auto-retro.ts` (line 123) to pass background-appropriate options:
  ```ts
  const { analysis } = await analyzeRetro(
    client,
    gen.final_draft,
    post.full_text,
    rules,
    writingPrompt,
    { timeout: 120_000, maxRetries: 2 }
  );
  ```

- [ ] **Step 5: Update `profile-extractor.ts`** — add `{ timeout: 90_000, maxRetries: 1 }`.

- [ ] **Step 6: Commit.**
  ```bash
  git commit -m "feat: set 90s timeout + 1 retry on user-facing Sonnet calls"
  ```

---

### Task 4: routes/generate.ts chat endpoint — 90s / 1 retry

**Files:**
- Modify: `server/src/routes/generate.ts`

- [ ] **Step 1: Update the chat `client.messages.create` call in `generate.ts`.**
  Find the call in the chat route handler and add:
  ```ts
  }, { timeout: 90_000, maxRetries: 1 })
  ```
  This is user-facing (request/response cycle), so one retry maximum.

  **Wall time note:** The chat route can chain a `coachCheck` call after the chat revision (see lines ~184 and ~301 in `generate.ts`). `coachCheck` makes up to 2 Sonnet calls internally (alignment check + optional revision) and may run up to 3 times via the coach loop. So true worst-case wall time for a single chat request is: 90s (chat) + 3 x 2 x 90s (coach-check) = up to 630s. In practice the coach loop rarely iterates more than once. This is acceptable because the coach-check calls get their own per-call timeouts (Task 3 Step 3), and the route handler has its own try/catch.

- [ ] **Step 2: Commit.**
  ```bash
  git commit -m "feat: set 90s timeout + 1 retry on generate.ts chat endpoint"
  ```

---

### Task 5: Background heavy calls — 120s–180s / 2 retries

**Files:**
- Modify: `server/src/ai/coaching-analyzer.ts` — `{ timeout: 120_000, maxRetries: 2 }`
- Modify: `server/src/ai/analyzer.ts` (3 calls, 2 different configs) — see below

- [ ] **Step 1: Update `coaching-analyzer.ts`.**
  Find `client.messages.create({` and add:
  ```ts
  }, { timeout: 120_000, maxRetries: 2 })
  ```

- [ ] **Step 2: Update `analyzer.ts` — all 3 `client.messages.create` calls.**
  `analyzer.ts` uses a multi-model pipeline, not "2 Sonnet calls":
  - **`callModel` helper** (called twice in parallel via `Promise.allSettled`): Once with `MODELS.OPUS` and once with `MODELS.GPT54`. These are the heaviest calls — deep post analysis with large context. Use `{ timeout: 180_000, maxRetries: 2 }`.
  - **Reconciliation call** (Sonnet, runs after both complete): Merges the two analyses. Shorter input but still extended thinking. Use `{ timeout: 120_000, maxRetries: 2 }`.

  Update `callModel`'s `client.messages.create` call:
  ```ts
  }, { timeout: 180_000, maxRetries: 2 })
  ```

  Update the reconciliation `client.messages.create` call:
  ```ts
  }, { timeout: 120_000, maxRetries: 2 })
  ```

- [ ] **Step 3: Commit.**
  ```bash
  git commit -m "feat: set 120s-180s timeout + 2 retries on heavy background calls"
  ```

---

### Task 6: Remove client-level defaults, test, and type-check

**Files:**
- Modify: `server/src/ai/client.ts`

- [ ] **Step 1: Remove `timeout` and `maxRetries` from `createClient()` in `client.ts`.**
  Since all call sites now specify their own timeout/retry values, the client-level defaults are no longer needed. Remove them so missed call sites are obvious:
  ```ts
  // Before:
  return new Anthropic({
    apiKey,
    baseURL: "https://openrouter.ai/api",
    timeout: 90_000,
    maxRetries: 2,
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
  // After:
  return new Anthropic({
    apiKey,
    baseURL: "https://openrouter.ai/api",
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
  ```

- [ ] **Step 2: Run the full server test suite.**
  ```bash
  pnpm test
  ```
  All tests must pass. If any test mocks `client.messages.create` and asserts exact call arguments, update those mocks to expect the new second argument.

  **Positive test verification:** Existing test mocks in `server/src/__tests__/ai-pipeline-modules.test.ts` and `server/src/__tests__/ai-analyzer.test.ts` call `client.messages.create` via mocks. Verify these tests also check the second argument contains the expected `{ timeout, maxRetries }` values. For example, in tests that assert `expect(client.messages.create).toHaveBeenCalledOnce()`, extend them to also check:
  ```ts
  expect(client.messages.create).toHaveBeenCalledWith(
    expect.objectContaining({ model: expect.any(String) }),
    expect.objectContaining({ timeout: expect.any(Number), maxRetries: expect.any(Number) })
  );
  ```
  This ensures the timeout/retry options are actually being passed through, not silently dropped.

- [ ] **Step 3: Type-check the server.**
  ```bash
  npx tsc --noEmit --project server/tsconfig.json
  ```
  Resolve any type errors. The SDK's `RequestOptions` type accepts `timeout: number` and `maxRetries: number`, so no new types are needed.

- [ ] **Step 4: Type-check the dashboard (sanity check — no server changes should affect it).**
  ```bash
  npx tsc --noEmit --project dashboard/tsconfig.json
  ```

- [ ] **Step 5: Commit.**
  ```bash
  git commit -m "feat: remove client-level timeout defaults, add timeout assertion tests"
  ```

---

## Reference: Full Timeout Table

| File | Model | Timeout | maxRetries | Category |
|---|---|---|---|---|
| `ai/auto-retro.ts` findMatch | Haiku | 30s | 2 | Background |
| `ai/tagger.ts` | Haiku | 30s | 2 | Background |
| `ai/image-classifier.ts` (per image) | Haiku | 30s | 2 | Background |
| `ai/discovery.ts` | Haiku | 30s | 2 | Background |
| `ai/orchestrator.ts` reasonResponse | Haiku | 30s | 2 | Background |
| `ai/taxonomy.ts` | Haiku | 30s | 2 | Background |
| `ai/researcher.ts` synthesis | Haiku | 45s | 2 | User-facing |
| `ai/drafter.ts` (×3 parallel) | Sonnet | 90s | 1 | User-facing |
| `ai/combiner.ts` (×2) | Sonnet | 90s | 1 | User-facing |
| `ai/coach-check.ts` (×2) | Sonnet | 90s | 1 | User-facing |
| `ai/retro.ts` (default / user-facing) | Sonnet | 90s | 1 | User-facing |
| `ai/retro.ts` (via auto-retro.ts) | Sonnet | 120s | 2 | Background |
| `ai/profile-extractor.ts` | Sonnet | 90s | 1 | User-facing |
| `routes/generate.ts` chat | Sonnet | 90s | 1 | User-facing |
| `ai/coaching-analyzer.ts` | Sonnet | 120s | 2 | Background |
| `ai/analyzer.ts` reconciliation | Sonnet | 120s | 2 | Background |
| `ai/analyzer.ts` callModel (×2 parallel) | Opus + GPT-5.4 | 180s | 2 | Background |
