import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./client.js";
import { AiLogger } from "./logger.js";
import type { Draft } from "../db/generate-queries.js";
import { type DraftLength, LENGTH_RANGES } from "./drafter.js";

export interface CombineResult {
  final_draft: string;
  input_tokens: number;
  output_tokens: number;
}

/**
 * Combine 2+ selected drafts into a single final draft using optional guidance.
 * If only 1 draft is selected, returns it as-is (formatted as full text).
 * When draftLength is provided, enforces word count — if the combined draft exceeds
 * the target range by >20%, bounces it back to the LLM for tightening.
 */
export async function combineDrafts(
  client: Anthropic,
  logger: AiLogger,
  drafts: Draft[],
  selectedIndices: number[],
  guidance?: string,
  systemPrompt?: string,
  draftLength?: DraftLength
): Promise<CombineResult> {
  const selected = selectedIndices.map((i) => drafts[i]).filter(Boolean);

  if (selected.length === 0) {
    throw new Error("No drafts selected for combining");
  }

  // Single draft — just format and return
  if (selected.length === 1) {
    const d = selected[0];
    const fullText = `${d.hook}\n\n${d.body}\n\n${d.closing}`;
    return { final_draft: fullText, input_tokens: 0, output_tokens: 0 };
  }

  // Multiple drafts — combine via LLM
  const draftsText = selected
    .map(
      (d, i) =>
        `--- Draft ${i + 1} (${d.type}) ---\nHook: ${d.hook}\n\nBody:\n${d.body}\n\nClosing: ${d.closing}`
    )
    .join("\n\n");

  const lengthConstraint = draftLength
    ? ` The final post MUST be ${LENGTH_RANGES[draftLength].min}-${LENGTH_RANGES[draftLength].max} words.`
    : "";

  const guidanceText = guidance
    ? `\n\nUser guidance for combining: "${guidance}"`
    : "";

  const prompt = `Combine these ${selected.length} LinkedIn post drafts into a single cohesive post. Take the strongest elements from each — the best hook, the most compelling evidence, the sharpest closing.${lengthConstraint}${guidanceText}

${draftsText}

Return the combined post as plain text (no JSON, no markdown headers). Use line breaks between paragraphs.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 2000,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: [{ role: "user", content: prompt }],
  }, { timeout: 90_000, maxRetries: 1 });

  const duration = Date.now() - start;
  let text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.log({
    step: "combine",
    model: MODELS.SONNET,
    input_messages: JSON.stringify([{ role: "user", content: prompt }]),
    output_text: text,
    tool_calls: null,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    thinking_tokens: 0,
    duration_ms: duration,
  });

  let totalInput = response.usage.input_tokens;
  let totalOutput = response.usage.output_tokens;

  // Tightening pass — if the combined draft exceeds the target by >20%
  if (draftLength) {
    const range = LENGTH_RANGES[draftLength];
    const wordCount = text.trim().split(/\s+/).length;

    if (wordCount > range.max * 1.2) {
      const tightenPrompt = `This LinkedIn post is ${wordCount} words but needs to be ${range.min}-${range.max} words.

WRITING PRINCIPLES TO GUIDE CUTS:
${systemPrompt ?? "(none provided)"}

Tighten this post. Cut what doesn't carry weight. Sharpen sentences. Don't summarize — keep the voice and the strongest material. Remove filler, merge redundant points, eliminate anything that restates what's already implied.

POST:
${text}

Return only the tightened post as plain text.`;

      const tightenStart = Date.now();
      const tightenResponse = await client.messages.create({
        model: MODELS.SONNET,
        max_tokens: 2000,
        messages: [{ role: "user", content: tightenPrompt }],
      }, { timeout: 90_000, maxRetries: 1 });

      const tightenDuration = Date.now() - tightenStart;
      const tightenedText =
        tightenResponse.content[0].type === "text"
          ? tightenResponse.content[0].text
          : "";

      logger.log({
        step: "combine_tighten",
        model: MODELS.SONNET,
        input_messages: JSON.stringify([
          { role: "user", content: tightenPrompt },
        ]),
        output_text: tightenedText,
        tool_calls: null,
        input_tokens: tightenResponse.usage.input_tokens,
        output_tokens: tightenResponse.usage.output_tokens,
        thinking_tokens: 0,
        duration_ms: tightenDuration,
      });

      text = tightenedText;
      totalInput += tightenResponse.usage.input_tokens;
      totalOutput += tightenResponse.usage.output_tokens;
    }
  }

  return {
    final_draft: text.trim(),
    input_tokens: totalInput,
    output_tokens: totalOutput,
  };
}
