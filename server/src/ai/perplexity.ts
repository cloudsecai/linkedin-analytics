import { AiLogger } from "./logger.js";

export interface SonarResult {
  content: string;
  citations: string[];
  usage: { input_tokens: number; output_tokens: number };
}

export function buildSearchPrompt(topic: string): string {
  return `Find recent coverage, practitioner discussions, and multiple perspectives on "${topic}". Include specific examples, named sources, and concrete outcomes. Focus on what happened, what's controversial, and what practitioners are saying.`;
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
  logger: AiLogger
): Promise<SonarResult> {
  const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
  if (!apiKey) {
    throw new Error("TRUSTMIND_LLM_API_KEY is required for web research");
  }

  const searchPrompt = buildSearchPrompt(topic);
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "perplexity/sonar-pro",
        messages: [{ role: "user", content: searchPrompt }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Sonar Pro API error: ${response.status} ${errText}`);
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
