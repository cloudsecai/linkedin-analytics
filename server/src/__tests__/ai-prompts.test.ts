import { describe, it, expect } from "vitest";
import {
  getTier,
  patternDetectionPrompt,
  hypothesisTestingPrompt,
  synthesisPrompt,
  taxonomyPrompt,
  taggingPrompt,
  overviewSummaryPrompt,
} from "../ai/prompts.js";

describe("getTier", () => {
  it("returns 'foundation' for <30 posts", () => {
    expect(getTier(0)).toBe("foundation");
    expect(getTier(15)).toBe("foundation");
    expect(getTier(29)).toBe("foundation");
  });

  it("returns 'patterns' for 30-59 posts", () => {
    expect(getTier(30)).toBe("patterns");
    expect(getTier(45)).toBe("patterns");
    expect(getTier(59)).toBe("patterns");
  });

  it("returns 'trends' for 60-119 posts", () => {
    expect(getTier(60)).toBe("trends");
    expect(getTier(90)).toBe("trends");
    expect(getTier(119)).toBe("trends");
  });

  it("returns 'prediction' for 120-249 posts", () => {
    expect(getTier(120)).toBe("prediction");
    expect(getTier(200)).toBe("prediction");
    expect(getTier(249)).toBe("prediction");
  });

  it("returns 'strategic' for 250+ posts", () => {
    expect(getTier(250)).toBe("strategic");
    expect(getTier(1000)).toBe("strategic");
  });
});

describe("patternDetectionPrompt", () => {
  it("returns a string containing the summary and tier instructions", () => {
    const result = patternDetectionPrompt("My summary data", "patterns");
    expect(result).toContain("My summary data");
    expect(result).toContain("patterns");
  });

  it("includes sample size rules", () => {
    const result = patternDetectionPrompt("data", "foundation");
    expect(result).toContain("potential area to explore");
    expect(result).toContain("preliminary signal");
    expect(result).toContain("moderate evidence");
  });
});

describe("hypothesisTestingPrompt", () => {
  it("returns a string containing the findings and previous insights", () => {
    const result = hypothesisTestingPrompt("stage1 findings", "prev insights");
    expect(result).toContain("stage1 findings");
    expect(result).toContain("prev insights");
  });

  it("includes confounder checklist", () => {
    const result = hypothesisTestingPrompt("findings", "insights");
    expect(result.toLowerCase()).toContain("content");
    expect(result.toLowerCase()).toContain("timing");
    expect(result.toLowerCase()).toContain("audience");
    expect(result.toLowerCase()).toContain("measurement");
  });
});

describe("synthesisPrompt", () => {
  it("returns a string containing the findings and feedback", () => {
    const result = synthesisPrompt("verified findings", "feedback history");
    expect(result).toContain("verified findings");
    expect(result).toContain("feedback history");
  });

  it("includes evidence strength labels", () => {
    const result = synthesisPrompt("findings", "feedback");
    expect(result).toContain("STRONG");
    expect(result).toContain("MODERATE");
    expect(result).toContain("WEAK");
    expect(result).toContain("INSUFFICIENT");
  });

  it("includes rule about citing numbers", () => {
    const result = synthesisPrompt("findings", "feedback");
    expect(result.toLowerCase()).toContain("citing");
  });
});

describe("taxonomyPrompt", () => {
  it("returns a string mentioning JSON", () => {
    const result = taxonomyPrompt("post summaries here");
    expect(result).toContain("post summaries here");
    expect(result.toLowerCase()).toContain("json");
  });
});

describe("taggingPrompt", () => {
  it("returns a string listing topic categories", () => {
    const taxonomy = [
      { name: "Leadership", description: "Posts about leadership" },
      { name: "Tech", description: "Posts about technology" },
    ];
    const result = taggingPrompt(taxonomy);
    expect(result).toContain("Leadership");
    expect(result).toContain("Tech");
  });
});

describe("overviewSummaryPrompt", () => {
  it("returns a string mentioning summary", () => {
    const result = overviewSummaryPrompt("top performer info", [
      "insight 1",
      "insight 2",
    ]);
    expect(result).toContain("top performer info");
    expect(result).toContain("insight 1");
    expect(result.toLowerCase()).toContain("summary");
  });
});
