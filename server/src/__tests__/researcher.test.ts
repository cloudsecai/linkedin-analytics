import { describe, it, expect } from "vitest";
import {
  buildRankingPrompt,
  parseRankedTopics,
  buildSynthesisPrompt,
  parseSynthesizedStories,
  type RankedTopic,
} from "../ai/researcher.js";
import type { RssItem } from "../ai/rss-fetcher.js";
import type { Story } from "../db/generate-queries.js";

// ── buildRankingPrompt ─────────────────────────────────────

describe("buildRankingPrompt", () => {
  const items: RssItem[] = [
    {
      title: "AI agents are replacing SREs at major banks",
      link: "https://techcrunch.com/ai-sres",
      summary: "Banks deploy AI agents for incident response",
      pubDate: new Date(),
      sourceName: "TechCrunch",
    },
    {
      title: "Kubernetes 2.0 ships with native AI scheduling",
      link: "https://kubernetes.io/blog/k8s2",
      summary: "Major release includes AI-powered resource scheduling",
      pubDate: new Date(),
      sourceName: "Kubernetes Blog",
    },
  ];

  it("includes RSS item titles in the prompt", () => {
    const prompt = buildRankingPrompt(items, "news", []);
    expect(prompt).toContain("AI agents are replacing SREs at major banks");
    expect(prompt).toContain("Kubernetes 2.0 ships with native AI scheduling");
  });

  it("includes source names and URLs", () => {
    const prompt = buildRankingPrompt(items, "news", []);
    expect(prompt).toContain("TechCrunch");
    expect(prompt).toContain("https://techcrunch.com/ai-sres");
  });

  it("includes post type guidance for news", () => {
    const prompt = buildRankingPrompt(items, "news", []);
    expect(prompt).toContain("news");
    expect(prompt).toContain("practitioner");
  });

  it("includes post type guidance for topic", () => {
    const prompt = buildRankingPrompt(items, "topic", []);
    expect(prompt).toContain("topic");
    expect(prompt).toContain("debates");
  });

  it("includes post type guidance for insight", () => {
    const prompt = buildRankingPrompt(items, "insight", []);
    expect(prompt).toContain("insight");
    expect(prompt).toContain("lessons");
  });

  it("includes recent headlines as avoidance list", () => {
    const recentHeadlines = [
      "Why remote work is failing",
      "The death of agile methodology",
    ];
    const prompt = buildRankingPrompt(items, "news", recentHeadlines);
    expect(prompt).toContain("Why remote work is failing");
    expect(prompt).toContain("The death of agile methodology");
  });

  it("omits avoid section when no recent headlines", () => {
    const prompt = buildRankingPrompt(items, "news", []);
    expect(prompt).not.toContain("Avoid topics");
  });

  it("asks for top 5 items", () => {
    const prompt = buildRankingPrompt(items, "news", []);
    expect(prompt).toContain("top 5");
  });
});

// ── parseRankedTopics ──────────────────────────────────────

describe("parseRankedTopics", () => {
  it("parses a JSON array response", () => {
    const text = JSON.stringify([
      {
        topic: "Should engineers own incident response?",
        source_headline: "AI agents are replacing SREs at major banks",
        source_url: "https://techcrunch.com/ai-sres",
      },
    ]);
    const topics = parseRankedTopics(text);
    expect(topics).toHaveLength(1);
    expect(topics[0].topic).toBe("Should engineers own incident response?");
    expect(topics[0].source_url).toBe("https://techcrunch.com/ai-sres");
  });

  it("strips markdown fences before parsing", () => {
    const text = "```json\n" + JSON.stringify([
      {
        topic: "AI in incident response",
        source_headline: "AI agents are replacing SREs",
        source_url: "https://example.com",
      },
    ]) + "\n```";
    const topics = parseRankedTopics(text);
    expect(topics).toHaveLength(1);
    expect(topics[0].topic).toBe("AI in incident response");
  });

  it("handles response with extra text before/after JSON", () => {
    const arr: RankedTopic[] = [
      { topic: "Topic A", source_headline: "Headline A", source_url: "https://a.com" },
    ];
    const text = `Here are the top items:\n${JSON.stringify(arr)}\nLet me know if you need more.`;
    const topics = parseRankedTopics(text);
    expect(topics).toHaveLength(1);
    expect(topics[0].topic).toBe("Topic A");
  });

  it("returns empty array on invalid JSON", () => {
    const topics = parseRankedTopics("not json at all");
    expect(topics).toEqual([]);
  });

  it("returns empty array when no JSON array found", () => {
    const topics = parseRankedTopics('{"not": "an array"}');
    expect(topics).toEqual([]);
  });
});

// ── buildSynthesisPrompt ───────────────────────────────────

describe("buildSynthesisPrompt", () => {
  const topic = "AI agents replacing on-call engineers";
  const content = "Multiple banks reported 60% reduction in incident response time after deploying AI agents.";
  const citations = ["https://techcrunch.com/article1", "https://fortune.com/article2"];

  it("includes the topic in the prompt", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations, "news");
    expect(prompt).toContain(topic);
  });

  it("includes the sonar content in the prompt", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations, "news");
    expect(prompt).toContain("60% reduction in incident response time");
  });

  it("includes citations in the prompt", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations, "news");
    expect(prompt).toContain("https://techcrunch.com/article1");
    expect(prompt).toContain("https://fortune.com/article2");
  });

  it("includes post type guidance for news", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations, "news");
    expect(prompt).toContain("news");
    expect(prompt).toContain("timely");
  });

  it("includes post type guidance for topic", () => {
    const prompt = buildSynthesisPrompt(topic, content, [], "topic");
    expect(prompt).toContain("topic");
    expect(prompt).toContain("debate");
  });

  it("includes post type guidance for insight", () => {
    const prompt = buildSynthesisPrompt(topic, content, [], "insight");
    expect(prompt).toContain("insight");
    expect(prompt).toContain("lesson");
  });

  it("asks for 3 story cards", () => {
    const prompt = buildSynthesisPrompt(topic, content, citations, "news");
    expect(prompt).toContain("3");
  });

  it("handles empty citations gracefully", () => {
    const prompt = buildSynthesisPrompt(topic, content, [], "news");
    expect(prompt).toContain(topic);
    expect(prompt).not.toContain("Sources");
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
