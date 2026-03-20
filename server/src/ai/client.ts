import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  HAIKU: "anthropic/claude-3.5-haiku",
  SONNET: "anthropic/claude-sonnet-4-6",
  OPUS: "anthropic/claude-opus-4-6",
  GPT54: "openai/gpt-5.4",
  SONAR_PRO: "perplexity/sonar-pro",
} as const;

// OpenRouter pricing per 1M tokens (as of March 2026)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  [MODELS.HAIKU]: { input: 1, output: 5 },
  [MODELS.SONNET]: { input: 3, output: 15 },
  [MODELS.OPUS]: { input: 15, output: 75 },
  [MODELS.GPT54]: { input: 2.5, output: 10 },
  [MODELS.SONAR_PRO]: { input: 3, output: 15 },
};

const OPENROUTER_FEE = 0.055; // 5.5%

/** Calculate cost in cents from ai_logs rows for a run */
export function calculateCostCents(
  logs: Array<{ model: string; input_tokens: number; output_tokens: number }>
): number {
  let totalDollars = 0;
  for (const log of logs) {
    const pricing = MODEL_PRICING[log.model];
    if (!pricing) continue;
    totalDollars +=
      (log.input_tokens * pricing.input + log.output_tokens * pricing.output) / 1_000_000;
  }
  return Math.round(totalDollars * (1 + OPENROUTER_FEE) * 100);
}

const PROVIDER_PREFS = JSON.stringify({
  order: ["amazon-bedrock", "google-vertex"],
});

export function createClient(apiKey: string): Anthropic {
  if (!apiKey)
    throw new Error("TRUSTMIND_LLM_API_KEY is required for AI features");
  return new Anthropic({
    apiKey,
    baseURL: "https://openrouter.ai/api",
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      // OpenRouter requires Bearer auth and provider routing header
      const headers = new Headers(init?.headers);
      headers.set("X-OpenRouter-Provider", PROVIDER_PREFS);
      const key = headers.get("x-api-key");
      if (key) {
        headers.set("Authorization", `Bearer ${key}`);
        headers.delete("x-api-key");
      }
      return globalThis.fetch(url, { ...init, headers });
    },
  });
}
