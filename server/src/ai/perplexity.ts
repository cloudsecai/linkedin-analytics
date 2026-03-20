import { AiLogger } from "./logger.js";

export interface SonarResult {
  content: string;
  citations: string[];
  usage: { input_tokens: number; output_tokens: number };
}

const SEARCH_PROMPTS: Record<string, (topic: string) => string> = {
  news: (topic) =>
    `Find recent news coverage, reactions, and analysis about "${topic}" from the past week. Include multiple sources and perspectives. Focus on what happened, who reacted, and why it matters for practitioners.`,
  topic: (topic) =>
    `Find current discussions, debates, and different perspectives on "${topic}". What are practitioners saying? What's controversial? Include specific examples and named sources.`,
  insight: (topic) =>
    `Find practitioner experiences, case studies, and lessons learned about "${topic}". What worked, what failed, what surprised people? Focus on firsthand accounts and concrete outcomes.`,
};

export function buildSearchPrompt(topic: string, postType: string): string {
  const builder = SEARCH_PROMPTS[postType] ?? SEARCH_PROMPTS.topic;
  return builder(topic);
}

export function parseSonarResponse(json: any): SonarResult {
  const content = json.choices?.[0]?.message?.content ?? "";
  const citations: string[] = json.citations ?? [];
  const usage = {
    input_tokens: json.usage?.prompt_tokens ?? 0,
    output_tokens: json.usage?.completion_tokens ?? 0,
  };
  return { content, citations, usage };
}

export async function searchWithSonarPro(
  topic: string,
  postType: string,
  logger: AiLogger
): Promise<SonarResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error("PERPLEXITY_API_KEY is required for web research");
  }

  const searchPrompt = buildSearchPrompt(topic, postType);
  const start = Date.now();

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [{ role: "user", content: searchPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Perplexity API error: ${response.status} ${errText}`);
  }

  const json = await response.json();
  const duration = Date.now() - start;
  const result = parseSonarResponse(json);

  logger.log({
    step: "sonar_pro_search",
    model: "perplexity/sonar-pro",
    input_messages: JSON.stringify([{ role: "user", content: searchPrompt }]),
    output_text: result.content,
    tool_calls: null,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  return result;
}
