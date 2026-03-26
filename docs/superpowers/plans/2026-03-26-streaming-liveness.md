# Streaming Liveness Detection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blocking `client.messages.create()` calls in user-facing AI functions with streaming via `client.messages.stream()`, adding a 30s idle timer so hung model calls fail fast instead of blocking for 90s.
**Architecture:** A new `streamWithIdleTimeout` utility wraps the Anthropic SDK's streaming interface, resets a timer on each token/thinking/contentBlockStart event (starting only after the first event — TTFB is covered by the hard deadline), aborts on idle timeout. Returns concatenated text and usage counts identical to the non-streaming interface — callers change only the call site and usage destructuring.
**Tech Stack:** Fastify v5, Anthropic SDK (`@anthropic-ai/sdk`), OpenRouter (SSE streaming), better-sqlite3, Vitest

---

### Task 1: Create `stream-with-idle.ts` utility and tests

**Files:**
- Create: `server/src/ai/stream-with-idle.ts`
- Create: `server/src/ai/stream-with-idle.test.ts`

- [ ] **Step 1: Create `server/src/ai/stream-with-idle.ts`**

  Full implementation:

  ```ts
  import Anthropic from "@anthropic-ai/sdk";
  import type { MessageStreamParams } from "@anthropic-ai/sdk/resources/index.js";

  export class StreamIdleTimeoutError extends Error {
    constructor(idleTimeoutMs: number) {
      super(`Stream idle timeout after ${idleTimeoutMs}ms`);
      this.name = "StreamIdleTimeoutError";
    }
  }

  export class StreamDeadlineError extends Error {
    constructor(deadlineMs: number) {
      super(`Stream hard deadline exceeded after ${deadlineMs}ms`);
      this.name = "StreamDeadlineError";
    }
  }

  export interface StreamResult {
    text: string;
    input_tokens: number;
    output_tokens: number;
  }

  /**
   * Streams a message with idle timeout and hard deadline.
   *
   * @param client - Anthropic client instance
   * @param params - Message creation params (same shape as `client.messages.create`,
   *   minus `stream` — the SDK's `MessageStreamParams` type handles this)
   * @param opts.idleTimeoutMs - Max ms between token/thinking events before aborting (default 30s)
   * @param opts.deadlineMs - Hard deadline for the entire call (default 5 min).
   *   Protects against a model that emits one token per 29s, which would never
   *   trigger idle timeout but still run forever.
   *
   * NOTE: When using this function, pass `timeout: 0` (or a value higher than
   * deadlineMs) in `params` to prevent the SDK's built-in connection timeout
   * (default 90s in `createClient`) from racing with and killing the stream
   * before the deadline fires.
   */
  export async function streamWithIdleTimeout(
    client: Anthropic,
    params: MessageStreamParams,
    opts?: { idleTimeoutMs?: number; deadlineMs?: number }
  ): Promise<StreamResult> {
    const idleTimeoutMs = opts?.idleTimeoutMs ?? 30_000;
    const deadlineMs = opts?.deadlineMs ?? 300_000; // 5 minutes

    return new Promise<StreamResult>((resolve, reject) => {
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let firstEventReceived = false;

      function cleanup() {
        if (idleTimer) clearTimeout(idleTimer);
        if (deadlineTimer) clearTimeout(deadlineTimer);
      }

      function settle(action: () => void) {
        if (settled) return;
        settled = true;
        cleanup();
        action();
      }

      function resetIdleTimer() {
        if (idleTimer) clearTimeout(idleTimer);
        if (settled) return;
        firstEventReceived = true;
        idleTimer = setTimeout(() => {
          // IMPORTANT: settle (reject) BEFORE aborting so our
          // StreamIdleTimeoutError wins the race, not the SDK's
          // APIUserAbortError which stream.abort() would trigger.
          settle(() => reject(new StreamIdleTimeoutError(idleTimeoutMs)));
          stream.abort();
        }, idleTimeoutMs);
      }

      const stream = client.messages.stream(params);

      // Do NOT start the idle timer here. During TTFB (cold start,
      // OpenRouter routing) there are legitimately no events. The idle
      // timer starts on the first text/thinking/contentBlockStart event.

      // Hard deadline — catches "one token per 29s" pathology and
      // also covers the TTFB window the idle timer intentionally skips.
      deadlineTimer = setTimeout(() => {
        settle(() => reject(new StreamDeadlineError(deadlineMs)));
        stream.abort();
      }, deadlineMs);

      // Reset idle timer on text deltas
      stream.on("text", () => {
        if (!settled) resetIdleTimer();
      });

      // Reset idle timer on thinking events (extended thinking models)
      stream.on("thinking", () => {
        if (!settled) resetIdleTimer();
      });

      // Reset idle timer on content block start — signals model is
      // actively producing output even before text/thinking deltas arrive
      stream.on("contentBlockStart", () => {
        if (!settled) resetIdleTimer();
      });

      // Final message — extract text and usage
      stream.on("finalMessage", (message) => {
        // Concatenate ALL text blocks, not just the first one
        const text = message.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("");

        settle(() =>
          resolve({
            text,
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
          })
        );
      });

      // SDK emits 'abort' (not 'error') when stream.abort() is called.
      // Our idle/deadline timers call settle(reject) before aborting, so
      // this is just a safety net for external aborts.
      stream.on("abort", (err) => {
        settle(() => reject(err));
      });

      stream.on("error", (err) => {
        settle(() => reject(err));
      });

      // Safety net: if the stream ends without emitting 'finalMessage'
      // (e.g., server closes connection), reject instead of hanging forever.
      stream.on("end", () => {
        settle(() =>
          reject(new Error("Stream ended without producing a final message"))
        );
      });
    });
  }
  ```

  Notes:
  - Uses `MessageStreamParams` from `@anthropic-ai/sdk/resources/index.js` (re-exported from `resources/messages/messages.js`). Not exported from the SDK top-level `@anthropic-ai/sdk`, so the deep import is required.
  - Listens to `text`, `thinking`, AND `contentBlockStart` events to reset the idle timer. Extended thinking models emit `thinking` events before any `text` events; `contentBlockStart` signals the model is actively producing output even before deltas arrive.
  - **Idle timer does NOT start until the first event fires.** During TTFB (cold start, OpenRouter routing), there are legitimately no events. A `firstEventReceived` flag tracks this. The hard deadline still covers the TTFB window.
  - **`settle(reject)` is called BEFORE `stream.abort()`** in timeout handlers. This ensures our `StreamIdleTimeoutError`/`StreamDeadlineError` wins the race, not the SDK's `APIUserAbortError` which `stream.abort()` would trigger.
  - Uses `finalMessage` event (not `message`) which fires after all content blocks are complete, providing a reliable final message with usage data. The `end` event is a safety net in case `finalMessage` never fires.
  - Handles both `abort` and `error` events — the SDK emits `abort` (with `APIUserAbortError`) when `stream.abort()` is called, and `error` for other failures.
  - Concatenates ALL text blocks via `.filter(b => b.type === 'text').map(b => b.text).join('')` to handle multi-block responses correctly.
  - No `retryOnIdle` option — retry logic was removed to keep the utility simple. No caller needs it, and hidden retries double billing (the provider charges for input tokens on the aborted first attempt even though the response is discarded). If needed later, callers can wrap the call in their own retry logic.
  - Hard deadline (default 5 min) prevents a model emitting one token per 29s from running forever — the idle timer would keep resetting but the deadline catches it.
  - The `settle` helper prevents double-resolution if multiple terminal events fire.
  - **Important:** Callers should pass `timeout: 0` in `params` to disable the SDK's built-in connection timeout (default 90s from `createClient`). Otherwise the SDK timeout can race with and kill the stream before the deadline fires.

- [ ] **Step 2: Create `server/src/ai/stream-with-idle.test.ts`**

  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import {
    streamWithIdleTimeout,
    StreamIdleTimeoutError,
    StreamDeadlineError,
    type StreamResult,
  } from "./stream-with-idle.js";
  import { EventEmitter } from "events";

  /**
   * NOTE: These mocks approximate the SDK's MessageStream interface with a plain
   * EventEmitter. They verify the idle timeout and deadline logic, NOT full SDK
   * integration. The real MessageStream has additional internal state (e.g.,
   * `ended`, `aborted` getters, async iteration). A true integration test against
   * OpenRouter would be needed to verify SSE parsing and abort propagation end-to-end.
   */

  function makeMockStream(
    tokens: string[],
    tokenDelayMs: number,
    usageMock = { input_tokens: 10, output_tokens: 20 }
  ) {
    const emitter = new EventEmitter() as any;
    emitter.abort = vi.fn();

    // Simulate streaming async
    (async () => {
      for (const token of tokens) {
        await new Promise((r) => setTimeout(r, tokenDelayMs));
        emitter.emit("text", token, token);
      }
      await new Promise((r) => setTimeout(r, tokenDelayMs));
      const fullText = tokens.join("");
      const message = {
        content: [{ type: "text" as const, text: fullText }],
        usage: usageMock,
      };
      emitter.emit("finalMessage", message);
      emitter.emit("end");
    })();

    return emitter;
  }

  function makeMockStreamMultiBlock(
    blocks: string[],
    tokenDelayMs: number,
    usageMock = { input_tokens: 10, output_tokens: 20 }
  ) {
    const emitter = new EventEmitter() as any;
    emitter.abort = vi.fn();

    (async () => {
      for (const block of blocks) {
        await new Promise((r) => setTimeout(r, tokenDelayMs));
        emitter.emit("text", block, block);
      }
      await new Promise((r) => setTimeout(r, tokenDelayMs));
      const message = {
        content: blocks.map((b) => ({ type: "text" as const, text: b })),
        usage: usageMock,
      };
      emitter.emit("finalMessage", message);
      emitter.emit("end");
    })();

    return emitter;
  }

  function makeHungStream() {
    const emitter = new EventEmitter() as any;
    emitter.abort = vi.fn();
    // Does not emit any events — simulates a hung connection
    return emitter;
  }

  describe("streamWithIdleTimeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("resolves with text and usage on successful stream", async () => {
      const mockClient = {
        messages: {
          stream: vi.fn(() => makeMockStream(["Hello", " world"], 0)),
        },
      } as any;

      const promise = streamWithIdleTimeout(
        mockClient,
        { model: "test", max_tokens: 100, messages: [] },
        { idleTimeoutMs: 5000 }
      );

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.text).toBe("Hello world");
      expect(result.input_tokens).toBe(10);
      expect(result.output_tokens).toBe(20);
    });

    it("concatenates multiple text blocks from finalMessage", async () => {
      const mockClient = {
        messages: {
          stream: vi.fn(() =>
            makeMockStreamMultiBlock(["Part 1. ", "Part 2."], 0)
          ),
        },
      } as any;

      const promise = streamWithIdleTimeout(
        mockClient,
        { model: "test", max_tokens: 100, messages: [] },
        { idleTimeoutMs: 5000 }
      );

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.text).toBe("Part 1. Part 2.");
    });

    it("hits hard deadline when no events ever arrive (hung during TTFB)", async () => {
      // No events = idle timer never starts. Hard deadline is the safety net.
      const stream = makeHungStream();
      const mockClient = {
        messages: { stream: vi.fn(() => stream) },
      } as any;

      const promise = streamWithIdleTimeout(
        mockClient,
        { model: "test", max_tokens: 100, messages: [] },
        { idleTimeoutMs: 1000, deadlineMs: 3000 }
      );

      await vi.advanceTimersByTimeAsync(3100);

      await expect(promise).rejects.toThrow(StreamDeadlineError);
      expect(stream.abort).toHaveBeenCalled();
    });

    it("throws StreamIdleTimeoutError when tokens stop arriving", async () => {
      // Emits one token then goes silent — idle timer starts on first event
      const emitter = new EventEmitter() as any;
      emitter.abort = vi.fn();

      (async () => {
        await new Promise((r) => setTimeout(r, 50));
        emitter.emit("text", "x", "x");
        // Then nothing — should trigger idle timeout
      })();

      const mockClient = {
        messages: { stream: vi.fn(() => emitter) },
      } as any;

      const promise = streamWithIdleTimeout(
        mockClient,
        { model: "test", max_tokens: 100, messages: [] },
        { idleTimeoutMs: 1000 }
      );

      await vi.advanceTimersByTimeAsync(1200);

      await expect(promise).rejects.toThrow(StreamIdleTimeoutError);
      expect(emitter.abort).toHaveBeenCalled();
    });

    it("resets idle timer on each token received", async () => {
      // Tokens arrive at 900ms intervals, idle timeout is 1000ms
      // Should NOT time out since each token resets the clock
      const tokens = Array(5).fill("x");
      const stream = makeMockStream(tokens, 900);
      const mockClient = {
        messages: { stream: vi.fn(() => stream) },
      } as any;

      const promise = streamWithIdleTimeout(
        mockClient,
        { model: "test", max_tokens: 100, messages: [] },
        { idleTimeoutMs: 1000 }
      );

      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.text).toBe("xxxxx");
    });

    it("resets idle timer on thinking events", async () => {
      // Emit thinking events instead of text — should still keep alive
      const emitter = new EventEmitter() as any;
      emitter.abort = vi.fn();

      (async () => {
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 900));
          emitter.emit("thinking", "...", "...");
        }
        await new Promise((r) => setTimeout(r, 100));
        const message = {
          content: [{ type: "text" as const, text: "result" }],
          usage: { input_tokens: 5, output_tokens: 10 },
        };
        emitter.emit("finalMessage", message);
        emitter.emit("end");
      })();

      const mockClient = {
        messages: { stream: vi.fn(() => emitter) },
      } as any;

      const promise = streamWithIdleTimeout(
        mockClient,
        { model: "test", max_tokens: 100, messages: [] },
        { idleTimeoutMs: 1000 }
      );

      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.text).toBe("result");
    });

    it("resets idle timer on contentBlockStart events", async () => {
      // Emit contentBlockStart events — should keep stream alive
      const emitter = new EventEmitter() as any;
      emitter.abort = vi.fn();

      (async () => {
        await new Promise((r) => setTimeout(r, 900));
        emitter.emit("contentBlockStart", {});
        await new Promise((r) => setTimeout(r, 900));
        emitter.emit("text", "result", "result");
        await new Promise((r) => setTimeout(r, 100));
        const message = {
          content: [{ type: "text" as const, text: "result" }],
          usage: { input_tokens: 5, output_tokens: 10 },
        };
        emitter.emit("finalMessage", message);
        emitter.emit("end");
      })();

      const mockClient = {
        messages: { stream: vi.fn(() => emitter) },
      } as any;

      const promise = streamWithIdleTimeout(
        mockClient,
        { model: "test", max_tokens: 100, messages: [] },
        { idleTimeoutMs: 1000 }
      );

      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.text).toBe("result");
    });

    it("rejects on error event without finalMessage", async () => {
      const emitter = new EventEmitter() as any;
      emitter.abort = vi.fn();

      (async () => {
        await new Promise((r) => setTimeout(r, 50));
        emitter.emit("error", new Error("connection reset"));
      })();

      const mockClient = {
        messages: { stream: vi.fn(() => emitter) },
      } as any;

      const promise = streamWithIdleTimeout(
        mockClient,
        { model: "test", max_tokens: 100, messages: [] },
        { idleTimeoutMs: 5000 }
      );

      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow("connection reset");
    });

    it("rejects on end event without finalMessage", async () => {
      const emitter = new EventEmitter() as any;
      emitter.abort = vi.fn();

      (async () => {
        await new Promise((r) => setTimeout(r, 50));
        emitter.emit("text", "partial", "partial");
        await new Promise((r) => setTimeout(r, 50));
        // Stream ends without finalMessage (e.g., server closes connection)
        emitter.emit("end");
      })();

      const mockClient = {
        messages: { stream: vi.fn(() => emitter) },
      } as any;

      const promise = streamWithIdleTimeout(
        mockClient,
        { model: "test", max_tokens: 100, messages: [] },
        { idleTimeoutMs: 5000 }
      );

      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow(
        "Stream ended without producing a final message"
      );
    });

    it("enforces hard deadline even when tokens keep arriving", async () => {
      // Tokens arrive every 200ms (well within 1s idle timeout)
      // but deadline is 2s — should abort after 2s
      const emitter = new EventEmitter() as any;
      emitter.abort = vi.fn();

      // Emit tokens forever (every 200ms)
      let interval: any;
      (async () => {
        await new Promise((r) => setTimeout(r, 100));
        interval = setInterval(() => emitter.emit("text", "x", "x"), 200);
      })();

      const mockClient = {
        messages: { stream: vi.fn(() => emitter) },
      } as any;

      const promise = streamWithIdleTimeout(
        mockClient,
        { model: "test", max_tokens: 100, messages: [] },
        { idleTimeoutMs: 1000, deadlineMs: 2000 }
      );

      await vi.advanceTimersByTimeAsync(2100);

      await expect(promise).rejects.toThrow(StreamDeadlineError);
      expect(emitter.abort).toHaveBeenCalled();
      clearInterval(interval);
    });
  });
  ```

- [ ] **Step 3: Run tests**

  ```bash
  cd /Users/nate/code/linkedin && pnpm test -- --run stream-with-idle
  ```

  All 10 tests should pass.

- [ ] **Step 4: Type-check**

  ```bash
  cd /Users/nate/code/linkedin && npx tsc --noEmit --project server/tsconfig.json
  ```

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/nate/code/linkedin && git add server/src/ai/stream-with-idle.ts server/src/ai/stream-with-idle.test.ts && git -c commit.gpgsign=false commit -m "feat: add streamWithIdleTimeout utility with 30s idle detection and hard deadline"
  ```

---

### Task 2: Convert `retro.ts`

**Files:**
- Modify: `server/src/ai/retro.ts`

- [ ] **Step 1: Update import**

  Add to imports at top of `retro.ts`:
  ```ts
  import { streamWithIdleTimeout } from "./stream-with-idle.js";
  ```

- [ ] **Step 2: Convert `analyzeRetro` call**

  `retro.ts` has 1 call site: `client.messages.create(...)` in `analyzeRetro`.

  Before pattern:
  ```ts
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 3000,
    system: ...,
    messages: [...],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  // ... later:
  input_tokens: response.usage.input_tokens,
  output_tokens: response.usage.output_tokens,
  ```

  After pattern:
  ```ts
  const { text, input_tokens, output_tokens } = await streamWithIdleTimeout(client, {
    model: MODELS.SONNET,
    max_tokens: 3000,
    timeout: 0, // disable SDK connection timeout — streamWithIdleTimeout has its own deadline
    system: ...,
    messages: [...],
  });
  ```

  **Note for ALL conversions (Tasks 2-7):** Always pass `timeout: 0` in the params object to disable the Anthropic SDK's built-in connection timeout (configured as 90s in `createClient`). Without this, the SDK timeout can race with and kill the stream before `streamWithIdleTimeout`'s hard deadline fires.

- [ ] **Step 3: Type-check**

  ```bash
  cd /Users/nate/code/linkedin && npx tsc --noEmit --project server/tsconfig.json
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/nate/code/linkedin && git add server/src/ai/retro.ts && git -c commit.gpgsign=false commit -m "feat: stream retro.ts analyzeRetro for liveness detection"
  ```

---

### Task 3: Convert `drafter.ts` (3 parallel calls)

**Files:**
- Modify: `server/src/ai/drafter.ts`

- [ ] **Step 1: Update import**

  Add to imports:
  ```ts
  import { streamWithIdleTimeout } from "./stream-with-idle.js";
  ```

- [ ] **Step 2: Convert `generateDrafts` — 3 parallel calls in `.map()` + `Promise.all`**

  `drafter.ts` has 3 parallel `client.messages.create` calls — one for each variation type (contrarian, operator, future-facing), executed via `Object.entries(VARIATION_INSTRUCTIONS).map(...)` + `Promise.all(draftPromises)`. Each call individually tracks `response.usage.input_tokens` and `response.usage.output_tokens`.

  For each call inside the `.map()`, replace:
  ```ts
  const response = await client.messages.create({ model: MODELS.SONNET, ... });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  // ... logger.log({ ..., input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens });
  ```

  With:
  ```ts
  const { text, input_tokens, output_tokens } = await streamWithIdleTimeout(client, {
    model: MODELS.SONNET, ...
  });
  // ... logger.log({ ..., input_tokens, output_tokens });
  ```

  The `Promise.all` structure and per-variation token aggregation remain unchanged.

- [ ] **Step 3: Type-check**

  ```bash
  cd /Users/nate/code/linkedin && npx tsc --noEmit --project server/tsconfig.json
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/nate/code/linkedin && git add server/src/ai/drafter.ts && git -c commit.gpgsign=false commit -m "feat: stream drafter.ts 3 parallel draft calls for liveness detection"
  ```

---

### Task 4: Convert `combiner.ts` (2 calls)

**Files:**
- Modify: `server/src/ai/combiner.ts`

- [ ] **Step 1: Update import**

  Add to imports:
  ```ts
  import { streamWithIdleTimeout } from "./stream-with-idle.js";
  ```

- [ ] **Step 2: Convert `combineDrafts` call**

  Apply the before/after pattern from Task 2 to the `client.messages.create` call in `combineDrafts` (line ~64).

- [ ] **Step 3: Convert `tighten` call**

  Apply the same pattern to the tightening call (line ~109) within the `if (wordCount > range.max * 1.2)` block.

- [ ] **Step 4: Type-check**

  ```bash
  cd /Users/nate/code/linkedin && npx tsc --noEmit --project server/tsconfig.json
  ```

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/nate/code/linkedin && git add server/src/ai/combiner.ts && git -c commit.gpgsign=false commit -m "feat: stream combiner.ts combineDrafts and tighten calls for liveness detection"
  ```

---

### Task 5: Convert `coach-check.ts` (3 calls)

**Files:**
- Modify: `server/src/ai/coach-check.ts`

- [ ] **Step 1: Update import**

  Add to imports:
  ```ts
  import { streamWithIdleTimeout } from "./stream-with-idle.js";
  ```

- [ ] **Step 2: Convert `runCoachCheck` call**

  `runCoachCheck` (line ~116) is a private helper called twice by `coachCheck` (pass 1 at line ~221, pass 2 at line ~232). Converting this one function covers 2 of the 3 calls.

  Apply the before/after pattern from Task 2.

- [ ] **Step 3: Convert `selfFix` call**

  `selfFix` (line ~182) is the third call — it runs between the two coach check passes. Apply the same pattern.

- [ ] **Step 4: Type-check**

  ```bash
  cd /Users/nate/code/linkedin && npx tsc --noEmit --project server/tsconfig.json
  ```

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/nate/code/linkedin && git add server/src/ai/coach-check.ts && git -c commit.gpgsign=false commit -m "feat: stream coach-check.ts all 3 calls for liveness detection"
  ```

---

### Task 6: Convert `profile-extractor.ts`

**Files:**
- Modify: `server/src/ai/profile-extractor.ts`

- [ ] **Step 1: Update import**

  Add to imports:
  ```ts
  import { streamWithIdleTimeout } from "./stream-with-idle.js";
  ```

- [ ] **Step 2: Convert profile extraction call**

  `profile-extractor.ts` has 1 call (line ~26). Note: this file does NOT track usage tokens — `extractProfile` returns `ExtractedProfile` directly (no `input_tokens`/`output_tokens` in the return type). Simply destructure `{ text }` and ignore the token counts:

  ```ts
  const { text } = await streamWithIdleTimeout(client, {
    model: MODELS.SONNET,
    max_tokens: 2000,
    system: ...,
    messages: [...],
  });
  ```

- [ ] **Step 3: Type-check**

  ```bash
  cd /Users/nate/code/linkedin && npx tsc --noEmit --project server/tsconfig.json
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/nate/code/linkedin && git add server/src/ai/profile-extractor.ts && git -c commit.gpgsign=false commit -m "feat: stream profile-extractor.ts for liveness detection"
  ```

---

### Task 7: Convert `generate.ts` chat endpoint

**Files:**
- Modify: `server/src/routes/generate.ts`

- [ ] **Step 1: Update import**

  Add to imports:
  ```ts
  import { streamWithIdleTimeout } from "../ai/stream-with-idle.js";
  ```

- [ ] **Step 2: Convert chat endpoint call**

  The `/api/generate/chat` handler (line ~262) has 1 `client.messages.create` call. Apply the before/after pattern — replace `response.content[0].type === "text" ? response.content[0].text : ""` and `response.usage.*` with destructured `{ text, input_tokens, output_tokens }`.

- [ ] **Step 3: Type-check**

  ```bash
  cd /Users/nate/code/linkedin && npx tsc --noEmit --project server/tsconfig.json
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/nate/code/linkedin && git add server/src/routes/generate.ts && git -c commit.gpgsign=false commit -m "feat: stream generate.ts chat endpoint for liveness detection"
  ```

---

### Task 8: Full test suite and type-check

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

  ```bash
  cd /Users/nate/code/linkedin && pnpm test -- --run
  ```

  All tests should pass. Pay attention to any tests touching `retro.ts`, `drafter.ts`, `combiner.ts`, `coach-check.ts`, `profile-extractor.ts`, or `generate.ts` — if any mock `client.messages.create`, they will need to be updated to mock `client.messages.stream` instead, returning an EventEmitter with the same shape used in `stream-with-idle.test.ts`.

  **Known test files that mock `client.messages.create` and will need updates:**
  - `server/src/__tests__/ai-pipeline-modules.test.ts`
  - Any per-module test files (e.g., `drafter.test.ts`, `retro.test.ts`, etc.)

- [ ] **Step 2: Fix any broken tests**

  For each failing test that mocks `client.messages.create`, update the mock to use `client.messages.stream`:

  Before:
  ```ts
  client.messages.create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "result" }],
    usage: { input_tokens: 5, output_tokens: 10 },
  });
  ```

  After — use the `makeMockStream` helper pattern from `stream-with-idle.test.ts`, or a simpler inline version:
  ```ts
  client.messages.stream = vi.fn(() => {
    const emitter = new EventEmitter() as any;
    emitter.abort = vi.fn();
    setTimeout(() => {
      emitter.emit("text", "result", "result");
      emitter.emit("finalMessage", {
        content: [{ type: "text", text: "result" }],
        usage: { input_tokens: 5, output_tokens: 10 },
      });
      emitter.emit("end");
    }, 0);
    return emitter;
  });
  ```

- [ ] **Step 3: Full type-check both workspaces**

  ```bash
  cd /Users/nate/code/linkedin && npx tsc --noEmit --project server/tsconfig.json && npx tsc --noEmit --project dashboard/tsconfig.json
  ```

- [ ] **Step 4: Commit any test fixes**

  ```bash
  cd /Users/nate/code/linkedin && git add server/src/ai/*.test.ts server/src/routes/*.test.ts server/src/__tests__/ai-pipeline-modules.test.ts && git -c commit.gpgsign=false commit -m "test: update mocks for streaming conversion"
  ```

---

## Call site inventory

| File | Function | Call sites | Usage tracking | Notes |
|---|---|---|---|---|
| `server/src/ai/retro.ts` | `analyzeRetro` | 1 | Yes (returned to caller) | |
| `server/src/ai/drafter.ts` | `generateDrafts` | 3 (parallel via `.map()` + `Promise.all`) | Yes (per-variation, aggregated) | One call per variation (contrarian, operator, future-facing) |
| `server/src/ai/combiner.ts` | `combineDrafts` | 2 (combine + conditional tighten) | Yes (aggregated across both calls) | Tighten only runs if word count > max * 1.2 |
| `server/src/ai/coach-check.ts` | `runCoachCheck` (x2) + `selfFix` (x1) | 3 | Yes (per-call via logger) | `coachCheck` calls `runCoachCheck` twice with `selfFix` between them |
| `server/src/ai/profile-extractor.ts` | `extractProfile` | 1 | **No** (usage not tracked) | Returns `ExtractedProfile` only, no token counts |
| `server/src/routes/generate.ts` | `/api/generate/chat` handler | 1 | Yes (via logger) | Chat revision endpoint |
| **Total** | | **11** | | |

## Files NOT to convert

The following files use `client.messages.create` for background/batch work and should remain non-streaming:

- `server/src/ai/auto-retro.ts`
- `server/src/ai/tagger.ts`
- `server/src/ai/analyzer.ts`
- `server/src/ai/coaching-analyzer.ts`
- `server/src/ai/taxonomy.ts`
- `server/src/ai/image-classifier.ts`
- `server/src/ai/discovery.ts`
- `server/src/ai/researcher.ts`
- `server/src/ai/orchestrator.ts`

These run in the background without a user waiting synchronously. Background jobs already have their own timeout protection — the server's `buildApp` startup marks any AI run with status `running` for > 1 hour as `failed` (see `server/src/db/` stale run cleanup). Adding idle timeout to batch work provides no UX benefit (no user is waiting) and only introduces unnecessary failure risk — a batch job that takes 45s of thinking time between tokens is normal, not pathological.
