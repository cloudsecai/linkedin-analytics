import { describe, it, expect } from "vitest";
import {
  buildSynthesisPrompt,
  parseSynthesizedStories,
} from "../ai/researcher.js";
import type { Story } from "../db/generate-queries.js";

// ── buildSynthesisPrompt ───────────────────────────────────

describe("buildSynthesisPrompt", () => {
  const topic = "AI agents replacing on-call engineers";
  const content = "Multiple banks reported 60% reduction in incident response time after deploying AI agents.";
  const citations = ["https://techcrunch.com/article1", "https://fortune.com/article2"];

  it("includes the topic in the prompt", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations);
    expect(prompt).toContain(topic);
  });

  it("includes the sonar content in the prompt", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations);
    expect(prompt).toContain("60% reduction in incident response time");
  });

  it("includes citations in the prompt", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations);
    expect(prompt).toContain("https://techcrunch.com/article1");
    expect(prompt).toContain("https://fortune.com/article2");
  });

  it("asks for 3 story cards", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations);
    expect(prompt).toContain("3");
  });

  it("handles empty citations gracefully", () => {
    const prompt = buildSynthesisPrompt(topic, content, []);
    expect(prompt).toContain(topic);
    expect(prompt).not.toContain("Sources");
  });

  it("includes avoid section when avoid list is provided", () => {
    const avoid = ["AI replacing developers", "automation in DevOps"];
    const prompt = buildSynthesisPrompt(topic, content, citations, avoid);
    expect(prompt).toContain("AI replacing developers");
    expect(prompt).toContain("automation in DevOps");
    expect(prompt).toContain("previously covered");
  });

  it("omits avoid section when avoid list is empty", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations, []);
    expect(prompt).not.toContain("previously covered");
  });

  it("omits avoid section when avoid is undefined", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations, undefined);
    expect(prompt).not.toContain("previously covered");
  });

  it("includes framing guidance for practitioner perspectives", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations);
    expect(prompt).toContain("practitioner");
  });
});

// ── parseSynthesizedStories ────────────────────────────────

describe("parseSynthesizedStories", () => {
  const sampleStory: Story = {
    headline: "AI Agents Now Handle 60% of Bank Incidents",
    summary: "Major financial institutions report AI agents resolving incidents before humans notice.",
    source: "TechCrunch",
    source_url: "https://techcrunch.com/article1",
    age: "This week",
    tag: "AI / Operations",
    angles: ["Operators: what gets replaced first?", "Future: will on-call exist in 5 years?"],
    is_stretch: false,
  };

  it("parses {stories: [...]} wrapper format", () => {
    const text = JSON.stringify({ stories: [sampleStory] });
    const stories = parseSynthesizedStories(text);
    expect(stories).toHaveLength(1);
    expect(stories[0].headline).toBe("AI Agents Now Handle 60% of Bank Incidents");
  });

  it("parses multiple stories in wrapper format", () => {
    const stories3 = [
      { ...sampleStory, headline: "Story 1", is_stretch: false },
      { ...sampleStory, headline: "Story 2", is_stretch: false },
      { ...sampleStory, headline: "Story 3", is_stretch: true },
    ];
    const text = JSON.stringify({ stories: stories3 });
    const result = parseSynthesizedStories(text);
    expect(result).toHaveLength(3);
    expect(result[2].is_stretch).toBe(true);
  });

  it("parses single story object without wrapper", () => {
    const text = JSON.stringify(sampleStory);
    const result = parseSynthesizedStories(text);
    expect(result).toHaveLength(1);
    expect(result[0].headline).toBe("AI Agents Now Handle 60% of Bank Incidents");
  });

  it("strips markdown fences before parsing", () => {
    const text = "```json\n" + JSON.stringify({ stories: [sampleStory] }) + "\n```";
    const result = parseSynthesizedStories(text);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("AI / Operations");
  });

  it("returns empty array on unparseable input", () => {
    const result = parseSynthesizedStories("sorry, I cannot help with that");
    expect(result).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    const result = parseSynthesizedStories("{broken json}}}");
    expect(result).toEqual([]);
  });

  it("preserves source_url from parsed stories", () => {
    const text = JSON.stringify({ stories: [sampleStory] });
    const result = parseSynthesizedStories(text);
    expect(result[0].source_url).toBe("https://techcrunch.com/article1");
  });

  it("preserves angles array", () => {
    const text = JSON.stringify({ stories: [sampleStory] });
    const result = parseSynthesizedStories(text);
    expect(result[0].angles).toHaveLength(2);
    expect(result[0].angles[0]).toContain("replaced");
  });
});
