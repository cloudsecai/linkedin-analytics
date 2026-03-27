import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  streamWithIdleTimeout,
  StreamIdleTimeoutError,
  StreamDeadlineError,
} from "./stream-with-idle.js";
import { EventEmitter } from "events";

/**
 * NOTE: These mocks approximate the SDK's MessageStream interface with a plain
 * EventEmitter. They verify the idle timeout and deadline logic, NOT full SDK
 * integration.
 */

function makeMockStream(
  tokens: string[],
  tokenDelayMs: number,
  usageMock = { input_tokens: 10, output_tokens: 20 }
) {
  const emitter = new EventEmitter() as any;
  emitter.abort = vi.fn(() => emitter.removeAllListeners());

  (async () => {
    for (const token of tokens) {
      await new Promise((r) => setTimeout(r, tokenDelayMs));
      emitter.emit("text", token, token);
    }
    await new Promise((r) => setTimeout(r, tokenDelayMs));
    const fullText = tokens.join("");
    emitter.emit("finalMessage", {
      content: [{ type: "text" as const, text: fullText }],
      usage: usageMock,
    });
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
  emitter.abort = vi.fn(() => emitter.removeAllListeners());

  (async () => {
    for (const block of blocks) {
      await new Promise((r) => setTimeout(r, tokenDelayMs));
      emitter.emit("text", block, block);
    }
    await new Promise((r) => setTimeout(r, tokenDelayMs));
    emitter.emit("finalMessage", {
      content: blocks.map((b) => ({ type: "text" as const, text: b })),
      usage: usageMock,
    });
    emitter.emit("end");
  })();

  return emitter;
}

function makeHungStream() {
  const emitter = new EventEmitter() as any;
  emitter.abort = vi.fn(() => emitter.removeAllListeners());
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
      { idleTimeoutMs: 5000, deadlineMs: 10000 }
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
      { idleTimeoutMs: 5000, deadlineMs: 10000 }
    );

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe("Part 1. Part 2.");
  });

  it("hits hard deadline when no events ever arrive (hung during TTFB)", async () => {
    const stream = makeHungStream();
    const mockClient = {
      messages: { stream: vi.fn(() => stream) },
    } as any;

    const promise = streamWithIdleTimeout(
      mockClient,
      { model: "test", max_tokens: 100, messages: [] },
      { idleTimeoutMs: 1000, deadlineMs: 3000 }
    );

    // Attach rejection handler BEFORE advancing timers
    const assertion = expect(promise).rejects.toThrow(StreamDeadlineError);
    await vi.advanceTimersByTimeAsync(3100);
    await assertion;
    expect(stream.abort).toHaveBeenCalled();
  });

  it("throws StreamIdleTimeoutError when tokens stop arriving", async () => {
    const emitter = new EventEmitter() as any;
    emitter.abort = vi.fn(() => emitter.removeAllListeners());

    (async () => {
      await new Promise((r) => setTimeout(r, 50));
      emitter.emit("text", "x", "x");
    })();

    const mockClient = {
      messages: { stream: vi.fn(() => emitter) },
    } as any;

    const promise = streamWithIdleTimeout(
      mockClient,
      { model: "test", max_tokens: 100, messages: [] },
      { idleTimeoutMs: 1000, deadlineMs: 60000 }
    );

    const assertion = expect(promise).rejects.toThrow(StreamIdleTimeoutError);
    await vi.advanceTimersByTimeAsync(1200);
    await assertion;
    expect(emitter.abort).toHaveBeenCalled();
  });

  it("resets idle timer on each token received", async () => {
    const tokens = Array(5).fill("x");
    const stream = makeMockStream(tokens, 900);
    const mockClient = {
      messages: { stream: vi.fn(() => stream) },
    } as any;

    const promise = streamWithIdleTimeout(
      mockClient,
      { model: "test", max_tokens: 100, messages: [] },
      { idleTimeoutMs: 1000, deadlineMs: 60000 }
    );

    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.text).toBe("xxxxx");
  });

  it("resets idle timer on thinking events", async () => {
    const emitter = new EventEmitter() as any;
    emitter.abort = vi.fn(() => emitter.removeAllListeners());

    (async () => {
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 900));
        emitter.emit("thinking", "...", "...");
      }
      await new Promise((r) => setTimeout(r, 100));
      emitter.emit("finalMessage", {
        content: [{ type: "text" as const, text: "result" }],
        usage: { input_tokens: 5, output_tokens: 10 },
      });
      emitter.emit("end");
    })();

    const mockClient = {
      messages: { stream: vi.fn(() => emitter) },
    } as any;

    const promise = streamWithIdleTimeout(
      mockClient,
      { model: "test", max_tokens: 100, messages: [] },
      { idleTimeoutMs: 1000, deadlineMs: 60000 }
    );

    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.text).toBe("result");
  });

  it("resets idle timer on contentBlock events", async () => {
    const emitter = new EventEmitter() as any;
    emitter.abort = vi.fn(() => emitter.removeAllListeners());

    (async () => {
      await new Promise((r) => setTimeout(r, 900));
      emitter.emit("contentBlock", {});
      await new Promise((r) => setTimeout(r, 900));
      emitter.emit("text", "result", "result");
      await new Promise((r) => setTimeout(r, 100));
      emitter.emit("finalMessage", {
        content: [{ type: "text" as const, text: "result" }],
        usage: { input_tokens: 5, output_tokens: 10 },
      });
      emitter.emit("end");
    })();

    const mockClient = {
      messages: { stream: vi.fn(() => emitter) },
    } as any;

    const promise = streamWithIdleTimeout(
      mockClient,
      { model: "test", max_tokens: 100, messages: [] },
      { idleTimeoutMs: 1000, deadlineMs: 60000 }
    );

    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.text).toBe("result");
  });

  it("rejects on error event without finalMessage", async () => {
    const emitter = new EventEmitter() as any;
    emitter.abort = vi.fn(() => emitter.removeAllListeners());

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
      { idleTimeoutMs: 5000, deadlineMs: 60000 }
    );

    const assertion = expect(promise).rejects.toThrow("connection reset");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("rejects on end event without finalMessage", async () => {
    const emitter = new EventEmitter() as any;
    emitter.abort = vi.fn(() => emitter.removeAllListeners());

    (async () => {
      await new Promise((r) => setTimeout(r, 50));
      emitter.emit("text", "partial", "partial");
      await new Promise((r) => setTimeout(r, 50));
      emitter.emit("end");
    })();

    const mockClient = {
      messages: { stream: vi.fn(() => emitter) },
    } as any;

    const promise = streamWithIdleTimeout(
      mockClient,
      { model: "test", max_tokens: 100, messages: [] },
      { idleTimeoutMs: 5000, deadlineMs: 60000 }
    );

    const assertion = expect(promise).rejects.toThrow(
      "Stream ended without producing a final message"
    );
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
  });

  it("enforces hard deadline even when tokens keep arriving", async () => {
    const emitter = new EventEmitter() as any;
    emitter.abort = vi.fn(() => emitter.removeAllListeners());

    (async () => {
      await new Promise((r) => setTimeout(r, 100));
      const interval = setInterval(() => {
        if (emitter.abort.mock.calls.length > 0) {
          clearInterval(interval);
          return;
        }
        emitter.emit("text", "x", "x");
      }, 200);
    })();

    const mockClient = {
      messages: { stream: vi.fn(() => emitter) },
    } as any;

    const promise = streamWithIdleTimeout(
      mockClient,
      { model: "test", max_tokens: 100, messages: [] },
      { idleTimeoutMs: 1000, deadlineMs: 2000 }
    );

    const assertion = expect(promise).rejects.toThrow(StreamDeadlineError);
    await vi.advanceTimersByTimeAsync(2100);
    await assertion;
    expect(emitter.abort).toHaveBeenCalled();
  });
});
