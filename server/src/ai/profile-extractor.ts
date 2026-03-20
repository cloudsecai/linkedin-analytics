import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./client.js";

export interface ExtractedProfile {
  profile_text: string;
  profile_json: {
    mental_models: string[];
    contrarian_convictions: string[];
    scar_tissue: string[];
    disproportionate_caring: string[];
    vantage_point: string;
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
    system: `You are a profile extraction expert. Given an interview transcript, extract what makes this person's professional perspective distinctive. Focus on their LENS — how they see the world — not biographical facts or individual stories.`,
    messages: [
      {
        role: "user",
        content: `Extract a professional profile from this interview transcript.

## Transcript
${transcript}

## Instructions

Return JSON with two fields:

1. "profile_text" — A compact paragraph (~150-200 words) written in third person that captures who this person is professionally and what makes their perspective distinctive. This will be injected into an AI writing prompt, so it should emphasize: what they can credibly speak about, their strong opinions, their recurring observations, and how they naturally communicate. Do NOT include biographical details unless they inform perspective.

2. "profile_json" — A structured object with these fields:
   - "mental_models": array of strings — the 2-3 frameworks/lenses they apply repeatedly
   - "contrarian_convictions": array of strings — beliefs they hold that most peers would disagree with
   - "scar_tissue": array of strings — recurring patterns of failure they've observed across multiple instances
   - "disproportionate_caring": array of strings — things they care about that most people in their role ignore
   - "vantage_point": string — where they sit professionally and what that lets them see
   - "persuasion_style": string — how they naturally argue (storyteller, opinionator, data-presenter, or framework-builder) and their default metaphor domain

Return valid JSON only. No markdown fences.`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Profile extraction did not return valid JSON");
  }

  return JSON.parse(jsonMatch[0]) as ExtractedProfile;
}
