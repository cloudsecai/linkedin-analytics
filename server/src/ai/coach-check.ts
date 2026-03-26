import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import type { GenerationRule, CoachingInsight } from "../db/generate-queries.js";

export type AlignmentDimension =
  | "voice_match"
  | "ai_tropes"
  | "hook_strength"
  | "engagement_close"
  | "concrete_specifics"
  | "ending_quality";

export interface CoachCheckResult {
  draft: string;
  expertise_needed: Array<{ area: string; question: string }>;
  alignment: Array<{ dimension: AlignmentDimension; summary: string }>;
}

const DIMENSIONS: Array<{ name: AlignmentDimension; description: string }> = [
  { name: "voice_match", description: "Does the post sound like a practitioner, not an analyst? Check against writing rules for tone and specificity." },
  { name: "ai_tropes", description: "No hedge words, correlative constructions, rhetorical questions as filler, meandering intros, recapping conclusions." },
  { name: "hook_strength", description: "Opens with friction, a claim, or a surprise — not a question, context dump, or generic statement." },
  { name: "engagement_close", description: "Closing invites informed practitioner responses — not generic opinion questions." },
  { name: "concrete_specifics", description: "Uses named tools, specific metrics, real experiences — not vague abstractions." },
  { name: "ending_quality", description: "Ending extends the idea forward — does not summarize, recap, or restate." },
];

export function buildCoachCheckPrompt(
  draft: string,
  rules: GenerationRule[],
  insights: CoachingInsight[]
): string {
  const rulesText = rules
    .filter((r) => r.enabled)
    .map((r) => {
      let line = `- [${r.category}] ${r.rule_text}`;
      if (r.example_text) line += ` (${r.example_text})`;
      return line;
    })
    .join("\n");

  const insightsText = insights
    .map((i) => `- **${i.title}**: ${i.prompt_text}`)
    .join("\n");

  const dimensionsText = DIMENSIONS
    .map((d) => `- **${d.name}**: ${d.description}`)
    .join("\n");

  return `You are a writing coach for LinkedIn posts. Your job is to:

1. **Fix** any rule violations in the draft silently — rewrite to comply without explaining what you changed.
2. **Identify** 2-4 areas where the author's real expertise and judgment are needed (framing choices, perspective decisions, domain knowledge gaps). These are things rules alone cannot resolve.
3. **Confirm** alignment on each quality dimension with a specific reason.

## Draft
${draft}

## Writing Rules
${rulesText}

## Coaching Insights
${insightsText}

## Quality Dimensions
${dimensionsText}

Return JSON only (no markdown fences, no extra text):
{
  "draft": "the full revised draft with rule violations fixed",
  "expertise_needed": [
    { "area": "short label", "question": "what the author should weigh in on" }
  ],
  "alignment": [
    { "dimension": "voice_match|ai_tropes|hook_strength|engagement_close|concrete_specifics|ending_quality", "summary": "why this dimension is satisfied" }
  ]
}

Important:
- Do NOT over-edit. Preserve the argument structure and specific content.
- Fix rule violations (banned words, correlative constructions, recap paragraphs, weak hooks) silently.
- Surface framing/perspective issues as expertise_needed — these are for the human to decide.
- Every quality dimension must appear in alignment with a specific summary.`;
}

export function parseCoachCheckResponse(text: string): CoachCheckResult {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { draft: "", expertise_needed: [], alignment: [] };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      draft: parsed.draft ?? "",
      expertise_needed: Array.isArray(parsed.expertise_needed) ? parsed.expertise_needed : [],
      alignment: Array.isArray(parsed.alignment) ? parsed.alignment : [],
    };
  } catch {
    return { draft: "", expertise_needed: [], alignment: [] };
  }
}

async function runCoachCheck(
  client: Anthropic,
  logger: AiLogger,
  draft: string,
  rules: GenerationRule[],
  insights: CoachingInsight[],
  stepName: string
): Promise<CoachCheckResult> {
  const prompt = buildCoachCheckPrompt(draft, rules, insights);

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 4000,
    system: "You are a writing quality coach. Return valid JSON only.",
    messages: [{ role: "user", content: prompt }],
  }, { timeout: 90_000, maxRetries: 1 });

  const duration = Date.now() - start;
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.log({
    step: stepName,
    model: MODELS.SONNET,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  const result = parseCoachCheckResponse(text);

  // If parse returned empty draft, fall back to original
  if (!result.draft) {
    result.draft = draft;
  }

  return result;
}

/**
 * Self-fix pass: AI tries to address expertise_needed items on its own before
 * handing them to the user. Only items genuinely requiring the author's personal
 * experience should survive.
 */
async function selfFix(
  client: Anthropic,
  logger: AiLogger,
  draft: string,
  expertiseItems: Array<{ area: string; question: string }>
): Promise<string> {
  const issuesList = expertiseItems
    .map((item, i) => `${i + 1}. [${item.area}] ${item.question}`)
    .join("\n");

  const prompt = `You are revising a LinkedIn post. The quality review flagged these areas:

${issuesList}

## Current Draft
${draft}

Revise the draft to address as many issues as you can through better writing:
- Sharpen vague claims with stronger framing
- Tighten structure if focus was flagged
- Strengthen opening/closing if they were flagged
- Add specificity through better word choice and concrete language

Do NOT fabricate personal stories, fake company names, made-up metrics, or invented experiences. If an issue genuinely requires the author's real experience, leave it — the author will address it.

Return ONLY the revised draft as plain text (no JSON, no markdown fences).`;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 2000,
    system: "You are a concise LinkedIn post editor. Return only the revised draft text.",
    messages: [{ role: "user", content: prompt }],
  }, { timeout: 90_000, maxRetries: 1 });

  const duration = Date.now() - start;
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.log({
    step: "coach_self_fix",
    model: MODELS.SONNET,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  return text.trim() || draft;
}

/**
 * Run coach-check with one self-fix pass: initial check → self-fix → second check.
 * The second pass should return fewer expertise_needed items since the AI addressed
 * what it could on its own.
 */
export async function coachCheck(
  client: Anthropic,
  logger: AiLogger,
  draft: string,
  rules: GenerationRule[],
  insights: CoachingInsight[]
): Promise<CoachCheckResult> {
  // Pass 1: initial quality check
  const first = await runCoachCheck(client, logger, draft, rules, insights, "coach_check_1");

  // If no expertise items flagged, we're done
  if (first.expertise_needed.length === 0) {
    return first;
  }

  // Self-fix pass: AI tries to address flagged items
  const fixedDraft = await selfFix(client, logger, first.draft, first.expertise_needed);

  // Pass 2: re-check the self-fixed draft
  const second = await runCoachCheck(client, logger, fixedDraft, rules, insights, "coach_check_2");

  return second;
}
