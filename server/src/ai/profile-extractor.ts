import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./client.js";

export interface ExtractedProfile {
  profile_text: string;
  profile_json: {
    writing_topics: string[];
    audience: string;
    strong_opinions: string[];
    mental_models: string[];
    signature_stories: string[];
    anti_examples: string[];
    persuasion_style: string;
  };
}

/**
 * Extract a structured 6-layer profile from an interview transcript.
 * Returns both a compact ~200 token profile_text (for prompt injection)
 * and a structured profile_json (for the review/edit UI).
 */
export async function extractProfile(
  client: Anthropic,
  transcript: string
): Promise<ExtractedProfile> {
  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 2000,
    system: `You are a profile extraction expert for a LinkedIn ghostwriting tool. Given an interview transcript, extract what makes this person's writing perspective distinctive. Focus on their opinions, audience, topics, and voice — not biographical facts.`,
    messages: [
      {
        role: "user",
        content: `Extract a writing profile from this interview transcript.

## Transcript
${transcript}

## Instructions

Return JSON with two fields:

1. "profile_text" — A compact paragraph (~200-250 words) written in second person ("you") as instructions to an AI ghostwriter. It should tell the ghostwriter:
   - What topics this person writes about and who their audience is
   - Their strongest opinions and contrarian beliefs (use their actual words when possible)
   - How they naturally communicate (storyteller, opinionator, data-driven, framework-builder)
   - What they NEVER want to sound like (anti-examples)
   - Any signature stories or experiences they reference repeatedly

   This paragraph will be injected into every draft prompt, so make it actionable. Example tone: "You are writing for [Name], a [role] who writes about [topics] for [audience]. They believe strongly that [opinion]. They never want to sound like [anti-example]. When explaining ideas, they tend to [style]."

2. "profile_json" — A structured object with these fields:
   - "writing_topics": array of strings — the specific topics they want to own on LinkedIn
   - "audience": string — who they're writing for and what that audience cares about
   - "strong_opinions": array of strings — beliefs they hold that most peers would disagree with, stated as "I believe X, but most people think Y"
   - "mental_models": array of strings — the 2-3 frameworks/lenses they apply repeatedly
   - "signature_stories": array of strings — concrete experiences they referenced that could anchor future posts
   - "anti_examples": array of strings — styles, tones, or patterns they explicitly want to avoid
   - "persuasion_style": string — how they naturally argue (storyteller, opinionator, data-presenter, or framework-builder)

Return valid JSON only. No markdown fences.`,
      },
    ],
  }, { timeout: 90_000, maxRetries: 1 });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Profile extraction did not return valid JSON");
  }

  return JSON.parse(jsonMatch[0]) as ExtractedProfile;
}
