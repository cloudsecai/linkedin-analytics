import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./client.js";
import type { RetroChange, RetroRuleSuggestion, RetroPromptEdit, RetroAnalysis } from "@reachlab/shared";

export type { RetroChange, RetroRuleSuggestion, RetroPromptEdit, RetroAnalysis };

export async function analyzeRetro(
  client: Anthropic,
  draftText: string,
  publishedText: string,
  existingRules: string[],
  currentWritingPrompt?: string,
  requestOptions?: { timeout?: number; maxRetries?: number }
): Promise<{ analysis: RetroAnalysis; input_tokens: number; output_tokens: number }> {
  const rulesBlock = existingRules.length > 0
    ? `\nEXISTING GENERATION RULES (don't suggest duplicates of these):\n${existingRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n`
    : "";

  const promptBlock = currentWritingPrompt
    ? `\nCURRENT WRITING PROMPT (suggest specific edits to this text — what to remove, what to add, what to replace):\n---\n${currentWritingPrompt}\n---\n`
    : "";

  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 3000,
    system: `You are a senior developmental editor with deep experience analyzing how authors revise their own writing. Your specialty is distinguishing between changes that reflect genuine editorial preferences versus incidental rewording.

You understand revision taxonomy (Faigley & Witte): changes are either SURFACE (don't affect meaning — grammar, synonyms, punctuation, rephrasing that says the same thing) or MEANING changes (alter the argument, structure, tone, or rhetorical strategy).

Your job: analyze surface changes briefly, then focus exclusively on meaning changes to extract editorial principles and suggest TIGHT, CONSOLIDATED improvements to rules and prompts.

PROMPT & RULE MAINTENANCE PHILOSOPHY:
- NEVER just append new rules or instructions. The goal is a tight, well-organized system — not an ever-growing list of exceptions.
- CLUSTER FIRST: Group new learnings with existing rules by theme. If it fits an existing cluster, REWRITE that rule to subsume the new learning. Only create a new standalone rule if it truly doesn't fit anywhere.
- SUBSUMPTION CHECK: Before suggesting any addition, verify no existing rule or prompt section already covers it. If it does, at most enhance the existing text.
- When suggesting prompt edits, prefer REPLACING a section with a tighter rewrite over adding new text. The prompt should get better, not longer.
- THREE-STRIKE CONSOLIDATION: If you notice 3+ specific rules covering the same theme, suggest consolidating them into one principle with examples.
- BUDGET AWARENESS: A writing prompt with 20+ distinct instructions starts losing effectiveness. If the prompt is already long, prioritize consolidation over addition.
- Think like an editor maintaining a style guide: the goal is FEWER, SHARPER rules that capture principles, not MORE rules that catalog every specific case.

OUTPUT CHANNEL:
- All suggestions go into prompt_edits. The writing prompt is the single source of truth for how the AI writes.
- Do NOT suggest rules. Rules are user-managed guardrails added manually — the retro system only refines the writing prompt.
- rule_suggestions must always be an empty array.`,
    messages: [{
      role: "user",
      content: `I need you to compare an AI-generated draft with what I actually published on LinkedIn, and help me understand my own editorial principles so the AI can write better first drafts.

DRAFT (AI-generated):
${draftText}

PUBLISHED (what I actually posted):
${publishedText}
${rulesBlock}${promptBlock}
Follow this analysis process:

PHASE 1 — ALIGNMENT
Read both versions completely. Identify what's the SAME: the core message, the preserved ideas, the structure that survived. Anchor your analysis in what didn't change before examining what did.

PHASE 2 — SURFACE vs. MEANING CHANGES
For every difference you notice, apply these two tests:

THE SUMMARY TEST: If you wrote a one-sentence summary of the draft paragraph and a one-sentence summary of the published paragraph, would they differ? If not → surface change, move on.

THE REVERSAL TEST: If you swapped the draft wording back in, would any reader notice a difference in meaning, tone, or impact? If a reasonable reader would not → incidental, move on.

Group all surface changes into a brief summary. Do not extract principles from them.

PHASE 3 — PRINCIPLE EXTRACTION
For each meaning change that passes both tests, ask: "What editorial principle does this reveal about how this author wants to communicate?" Look for clusters — multiple changes that serve the same underlying principle are far more significant than one-off edits.

Only suggest new rules if they would ACTUALLY change the AI's output and are NOT already covered by the existing rules listed above.

Return JSON only (no markdown fences):
{
  "core_message_same": true/false,
  "surface_changes_summary": "Brief note on cosmetic/incidental changes (or 'None significant')",
  "changes": [
    {
      "category": "structural|voice|content|hook|closing|cut|added",
      "significance": "high|medium",
      "principle": "The editorial principle this reveals — stated as a generalizable rule, not a description of what changed",
      "draft_excerpt": "relevant text (only if it illustrates the principle)",
      "published_excerpt": "what it became (only if it illustrates the principle)"
    }
  ],
  "patterns": ["Generalizable editorial principles — each should be something that would improve future drafts if the AI followed it"],
  "rule_suggestions": [],
  "prompt_edits": [
    {
      "type": "add|remove|replace",
      "remove_text": "exact text to remove from the writing prompt (for 'remove' or 'replace' types — must be a verbatim substring of the CURRENT WRITING PROMPT above)",
      "add_text": "text to add (for 'add' type: appended to prompt; for 'replace' type: replaces remove_text)",
      "reason": "Why this change improves generation based on the editorial principles found"
    }
  ],
  "summary": "2-3 sentences: what is the single most important thing the AI should learn from how this author revised this draft?"
}

IMPORTANT:
- If the texts are substantially similar with only surface differences, say so honestly. An empty "changes" array with a clear surface_changes_summary is the correct output when there are no real editorial principles to extract.
- Do NOT manufacture insights from noise. Fewer high-confidence principles are better than many speculative ones.
- Each pattern should be supported by at least 2 changes. One-off edits are more likely incidental.`
    }],
  }, requestOptions ?? { timeout: 90_000, maxRetries: 1 });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Retro analysis returned no valid JSON");
  }

  const analysis = JSON.parse(jsonMatch[0]) as RetroAnalysis;
  return {
    analysis,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}
