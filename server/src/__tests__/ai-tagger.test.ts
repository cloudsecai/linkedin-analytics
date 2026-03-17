import { describe, it, expect } from "vitest";
import { parseTaggingResponse, batchPosts } from "../ai/tagger.js";

describe("parseTaggingResponse", () => {
  it("parses valid JSON array of tag objects", () => {
    const input = JSON.stringify([
      {
        post_id: "p1",
        topics: ["Leadership", "Tech"],
        hook_type: "question",
        tone: "professional",
        format_style: "short_text",
      },
      {
        post_id: "p2",
        topics: ["Marketing"],
        hook_type: "story",
        tone: "conversational",
        format_style: "long_form",
      },
    ]);
    const result = parseTaggingResponse(input);
    expect(result).toHaveLength(2);
    expect(result[0].post_id).toBe("p1");
    expect(result[0].topics).toEqual(["Leadership", "Tech"]);
    expect(result[0].hook_type).toBe("question");
    expect(result[1].post_id).toBe("p2");
    expect(result[1].tone).toBe("conversational");
  });

  it("handles response wrapped in ```json code blocks", () => {
    const json = JSON.stringify([
      {
        post_id: "p1",
        topics: ["AI"],
        hook_type: "bold_claim",
        tone: "provocative",
        format_style: "tips",
      },
    ]);
    const input = "```json\n" + json + "\n```";
    const result = parseTaggingResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].post_id).toBe("p1");
    expect(result[0].topics).toEqual(["AI"]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseTaggingResponse("not json at all")).toThrow();
  });
});

describe("batchPosts", () => {
  it("splits 45 posts into batches of [20, 20, 5]", () => {
    const posts = Array.from({ length: 45 }, (_, i) => ({ id: `p${i}` }));
    const batches = batchPosts(posts, 20);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(20);
    expect(batches[1]).toHaveLength(20);
    expect(batches[2]).toHaveLength(5);
  });

  it("handles empty array", () => {
    const batches = batchPosts([], 20);
    expect(batches).toEqual([]);
  });

  it("handles array smaller than batch size", () => {
    const posts = [{ id: "p1" }, { id: "p2" }];
    const batches = batchPosts(posts, 20);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });
});
