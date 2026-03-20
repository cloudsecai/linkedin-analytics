import { describe, it, expect } from "vitest";
import { buildSearchPrompt, parseSonarResponse } from "../ai/perplexity.js";

describe("buildSearchPrompt", () => {
  it("includes the topic in the prompt", () => {
    const prompt = buildSearchPrompt("AI agents replacing SREs");
    expect(prompt).toContain("AI agents replacing SREs");
  });

  it("includes practitioner-focused language", () => {
    const prompt = buildSearchPrompt("zero trust architecture");
    expect(prompt).toContain("zero trust architecture");
    expect(prompt).toContain("practitioners");
  });

  it("asks for multiple perspectives and examples", () => {
    const prompt = buildSearchPrompt("migrating to microservices");
    expect(prompt).toContain("migrating to microservices");
    expect(prompt).toContain("examples");
  });

  it("mentions recent coverage", () => {
    const prompt = buildSearchPrompt("test topic");
    expect(prompt).toContain("recent coverage");
  });
});

describe("parseSonarResponse", () => {
  it("extracts content and citations from Sonar Pro response", () => {
    const sonarJson = {
      choices: [{ message: { content: "Here is what I found about the topic." } }],
      citations: ["https://example.com/article1", "https://example.com/article2"],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    };

    const result = parseSonarResponse(sonarJson);
    expect(result.content).toBe("Here is what I found about the topic.");
    expect(result.citations).toEqual(["https://example.com/article1", "https://example.com/article2"]);
    expect(result.usage.input_tokens).toBe(100);
    expect(result.usage.output_tokens).toBe(200);
  });

  it("handles missing citations gracefully", () => {
    const sonarJson = {
      choices: [{ message: { content: "Content without citations." } }],
      usage: { prompt_tokens: 50, completion_tokens: 100 },
    };

    const result = parseSonarResponse(sonarJson);
    expect(result.content).toBe("Content without citations.");
    expect(result.citations).toEqual([]);
  });

  it("handles completely empty response", () => {
    const result = parseSonarResponse({});
    expect(result.content).toBe("");
    expect(result.citations).toEqual([]);
    expect(result.usage.input_tokens).toBe(0);
  });
});
