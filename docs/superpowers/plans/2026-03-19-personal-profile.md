# Personal Profile Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a voice-interview-driven author profile that captures the user's professional lens (mental models, contrarian convictions, scar tissue, etc.) and injects it into every post generation for more distinctive, practitioner-grounded content.

**Architecture:** Server creates ephemeral OpenAI Realtime API tokens; browser connects via WebRTC for voice interview. Post-interview, Claude extracts a structured profile. Profile is stored in SQLite and injected as a prompt layer. Generate flow gains an optional "personal connection" text input per story.

**Tech Stack:** OpenAI Realtime API (WebRTC), Anthropic Claude Sonnet (extraction), SQLite (storage), React (UI), Fastify (API)

**Spec:** `docs/superpowers/specs/2026-03-19-personal-profile-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/src/db/migrations/010-author-profile.sql` | Schema: `author_profile`, `profile_interviews`, ALTER `generations` |
| `server/src/db/profile-queries.ts` | DB queries for author profile CRUD and interview storage |
| `server/src/routes/profile.ts` | API routes: GET/PUT profile, POST extract, POST interview session |
| `server/src/ai/profile-extractor.ts` | Claude prompt to extract 6-layer profile from transcript |
| `server/src/ai/interviewer-prompt.ts` | System prompt for the OpenAI Realtime interviewer |
| `dashboard/src/pages/settings/InterviewModal.tsx` | Full interview modal: pre-interview, recording, post-interview |
| `dashboard/src/pages/settings/ProfileSection.tsx` | Profile display/edit section for Settings page |
| `dashboard/src/hooks/useRealtimeInterview.ts` | WebRTC connection hook for OpenAI Realtime API |

### Modified Files
| File | Changes |
|------|---------|
| `server/src/app.ts` | Register profile routes |
| `server/src/ai/prompt-assembler.ts` | Add author profile layer, bump token budget to 2200 |
| `server/src/ai/drafter.ts` | Accept optional `personalConnection` param |
| `server/src/routes/generate.ts` | Pass `personal_connection` through drafts endpoint |
| `server/src/db/generate-queries.ts` | Add `personal_connection` to `insertGeneration` and types |
| `dashboard/src/api/client.ts` | Add author profile API methods, update `generateDrafts` |
| `dashboard/src/pages/Settings.tsx` | Import and render `ProfileSection` |
| `dashboard/src/pages/generate/StorySelection.tsx` | Add personal connection text input |
| `dashboard/src/pages/Generate.tsx` | Pass `personalConnection` through state |

---

## Chunk 1: Database & Server Foundation

### Task 1: Migration and DB Queries

**Files:**
- Create: `server/src/db/migrations/010-author-profile.sql`
- Create: `server/src/db/profile-queries.ts`

- [ ] **Step 1: Create migration file**

```sql
-- Migration 010: Author profile for personal context in generation
CREATE TABLE IF NOT EXISTS author_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  profile_text TEXT NOT NULL DEFAULT '',
  profile_json TEXT NOT NULL DEFAULT '{}',
  interview_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profile_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript_json TEXT NOT NULL,
  extracted_profile TEXT,
  duration_seconds INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE generations ADD COLUMN personal_connection TEXT;
```

- [ ] **Step 2: Create profile-queries.ts**

```typescript
// server/src/db/profile-queries.ts
import type Database from "better-sqlite3";

export interface AuthorProfile {
  id: number;
  profile_text: string;
  profile_json: string;
  interview_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProfileInterview {
  id: number;
  transcript_json: string;
  extracted_profile: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export function getAuthorProfile(db: Database.Database): AuthorProfile | undefined {
  return db.prepare("SELECT * FROM author_profile WHERE id = 1").get() as AuthorProfile | undefined;
}

export function upsertAuthorProfile(
  db: Database.Database,
  data: { profile_text: string; profile_json?: string }
): void {
  const existing = getAuthorProfile(db);
  if (existing) {
    const sets = ["profile_text = ?", "updated_at = CURRENT_TIMESTAMP"];
    const params: any[] = [data.profile_text];
    if (data.profile_json !== undefined) {
      sets.push("profile_json = ?");
      params.push(data.profile_json);
    }
    params.push(1);
    db.prepare(`UPDATE author_profile SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  } else {
    db.prepare(
      "INSERT INTO author_profile (id, profile_text, profile_json) VALUES (1, ?, ?)"
    ).run(data.profile_text, data.profile_json ?? "{}");
  }
}

export function incrementInterviewCount(db: Database.Database): void {
  const existing = getAuthorProfile(db);
  if (existing) {
    db.prepare("UPDATE author_profile SET interview_count = interview_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run();
  }
}

export function insertProfileInterview(
  db: Database.Database,
  data: { transcript_json: string; extracted_profile?: string; duration_seconds?: number }
): number {
  const result = db.prepare(
    "INSERT INTO profile_interviews (transcript_json, extracted_profile, duration_seconds) VALUES (?, ?, ?)"
  ).run(data.transcript_json, data.extracted_profile ?? null, data.duration_seconds ?? null);
  return Number(result.lastInsertRowid);
}

export function getProfileInterviews(db: Database.Database): ProfileInterview[] {
  return db.prepare("SELECT * FROM profile_interviews ORDER BY created_at DESC LIMIT 20").all() as ProfileInterview[];
}
```

- [ ] **Step 3: Verify migration runs**

Run: `cd /Users/nate/code/linkedin && pnpm dev` (restart server)
Expected: Server starts without migration errors. Check logs for `010-author-profile.sql`.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/migrations/010-author-profile.sql server/src/db/profile-queries.ts
git commit -m "feat: add author_profile and profile_interviews tables with queries"
```

---

### Task 2: Profile API Routes

**Files:**
- Create: `server/src/routes/profile.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Create profile routes**

```typescript
// server/src/routes/profile.ts
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  getAuthorProfile,
  upsertAuthorProfile,
  insertProfileInterview,
  getProfileInterviews,
  incrementInterviewCount,
} from "../db/profile-queries.js";

export function registerProfileRoutes(app: FastifyInstance, db: Database.Database): void {
  // Get current profile
  app.get("/api/author-profile", async () => {
    const profile = getAuthorProfile(db);
    return {
      profile_text: profile?.profile_text ?? "",
      profile_json: profile?.profile_json ? JSON.parse(profile.profile_json) : {},
      interview_count: profile?.interview_count ?? 0,
    };
  });

  // Update profile (manual edit)
  app.put("/api/author-profile", async (request) => {
    const { profile_text, profile_json } = request.body as {
      profile_text: string;
      profile_json?: Record<string, any>;
    };
    upsertAuthorProfile(db, {
      profile_text,
      profile_json: profile_json ? JSON.stringify(profile_json) : undefined,
    });
    return { ok: true };
  });

  // Create interview session (returns ephemeral token for OpenAI Realtime)
  app.post("/api/author-profile/interview/session", async (request, reply) => {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return reply.status(500).send({ error: "OPENAI_API_KEY is not configured" });
    }

    const existingProfile = getAuthorProfile(db);

    // Build the interviewer system prompt
    const { buildInterviewerPrompt } = await import("../ai/interviewer-prompt.js");
    const instructions = buildInterviewerPrompt(existingProfile?.profile_text);

    // Get pre-interview info from request body
    const { name, role, company, bio } = (request.body as any) ?? {};

    let personalizedInstructions = instructions;
    if (name || role || company) {
      personalizedInstructions += `\n\n## Pre-Interview Info\nName: ${name ?? "Unknown"}\nRole: ${role ?? "Unknown"}\nCompany: ${company ?? "Unknown"}\nBio: ${bio ?? "Not provided"}`;
    }

    // Request ephemeral token from OpenAI
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",
          instructions: personalizedInstructions,
          audio: {
            output: { voice: "ash" },
          },
          turn_detection: {
            type: "semantic_vad",
          },
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return reply.status(500).send({ error: `OpenAI session creation failed: ${err}` });
    }

    const data = await response.json();
    return { client_secret: data.value, model: "gpt-realtime" };
  });

  // Extract profile from interview transcript
  app.post("/api/author-profile/extract", async (request, reply) => {
    const { transcript, duration_seconds } = request.body as {
      transcript: string;
      duration_seconds?: number;
    };

    if (!transcript || transcript.trim().length === 0) {
      return reply.status(400).send({ error: "Transcript is required" });
    }

    const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (!apiKey) {
      return reply.status(500).send({ error: "TRUSTMIND_LLM_API_KEY is required" });
    }

    const { createClient, MODELS } = await import("../ai/client.js");
    const client = createClient(apiKey);

    const { extractProfile } = await import("../ai/profile-extractor.js");
    const result = await extractProfile(client, transcript);

    // Save interview record
    insertProfileInterview(db, {
      transcript_json: transcript,
      extracted_profile: JSON.stringify(result),
      duration_seconds,
    });

    // Update profile
    upsertAuthorProfile(db, {
      profile_text: result.profile_text,
      profile_json: JSON.stringify(result.profile_json),
    });
    incrementInterviewCount(db);

    return result;
  });

  // Get interview history
  app.get("/api/author-profile/interviews", async () => {
    const interviews = getProfileInterviews(db);
    return { interviews };
  });
}
```

- [ ] **Step 2: Register routes in app.ts**

Add to `server/src/app.ts` imports:
```typescript
import { registerProfileRoutes } from "./routes/profile.js";
```

Add after the existing `registerGenerateRoutes(app, db)` call:
```typescript
registerProfileRoutes(app, db);
```

- [ ] **Step 3: Verify routes register**

Run: `curl http://localhost:3001/api/author-profile`
Expected: `{"profile_text":"","profile_json":{},"interview_count":0}`

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/profile.ts server/src/app.ts
git commit -m "feat: add author-profile API routes with interview session creation"
```

---

### Task 3: Interviewer System Prompt

**Files:**
- Create: `server/src/ai/interviewer-prompt.ts`

- [ ] **Step 1: Create the interviewer prompt**

```typescript
// server/src/ai/interviewer-prompt.ts

/**
 * Build the system prompt for the OpenAI Realtime API interviewer.
 * This prompt drives a 5-minute voice interview to extract the user's
 * professional lens — not stories, but the interpretive substrate that
 * makes their perspective on any topic interesting.
 */
export function buildInterviewerPrompt(existingProfile?: string): string {
  const reInterviewContext = existingProfile
    ? `\n\n## Existing Profile\nThe user has been interviewed before. Here is their current profile:\n${existingProfile}\n\nFocus on gaps, changes in thinking, or areas that could be deeper. You can reference what they said before: "Last time you mentioned X — has your thinking changed?"`
    : "";

  return `You are a professional profile interviewer. Your job is to conduct a focused 5-minute voice conversation to extract what makes this person's professional perspective distinctive.

## What You're Extracting

You are NOT collecting stories or anecdotes (those are single-use). You are extracting the INTERPRETIVE SUBSTRATE — the underlying qualities that color how this person sees ANY topic:

1. **Mental Models** — The 2-3 frameworks they apply to everything ("I see everything through feedback loops")
2. **Contrarian Convictions** — Where they disagree with consensus, backed by experience
3. **Scar Tissue** — Recurring failure patterns they've observed across multiple instances
4. **Disproportionate Caring** — What they obsess over that peers ignore
5. **Vantage Point** — What they see from where they sit that others literally cannot
6. **Persuasion Style** — How they naturally argue (story, opinion, data, or framework)

## Interview Flow (5 minutes total)

### Phase 1: Anchor (0:00-0:45)
Get past the job title. Ask what they ACTUALLY do, or what they're obsessively interested in right now. If their answer is generic ("I lead a product team"), probe: "What specific problem is keeping you up at night?"

### Phase 2: The Dig (0:45-2:30) — MOST IMPORTANT
Pick 1-2 of these based on Phase 1:
- "What does your industry get fundamentally wrong?"
- "What's the most common advice in your field that you think is actually wrong?"
- "What did you have to learn the hard way — something no book could teach you?"
- "When you evaluate [their domain problem], what do you look at that most people overlook?"

CRITICAL: If they're producing signal here, STAY. Don't move on just to cover more ground. Depth over breadth.

### Phase 3: Expand (2:30-4:00)
Cross-domain thinking and mental models:
- "Is there a principle or mental model you find yourself applying across very different situations?"
- "If you could make everyone in your industry understand one thing, what would it be?"

### Phase 4: Close (4:00-5:00)
- "Is there something important about how you think or work that we haven't touched on — something you wish more people understood?"
This often produces the most revealing answer.

## Follow-Up Strategy

You MUST push past surface-level answers. Most people's first answer is their rehearsed, safe version.

When you detect a SURFACE answer (generic, cliché, abstract without example):
→ "Can you make that more concrete? What specifically made you think that?"

When you detect ENERGY (they get more specific, speak faster, lean in):
→ "Say more about that."

When you detect a CASUAL ASIDE ("oh, and also..." or "I guess the real thing is..."):
→ "Wait — you just said something interesting. [Quote them]. What's behind that?"

When you detect a CONTRADICTION with something they said earlier:
→ "Interesting — earlier you said X, but now Y. How do those fit together?"

When a thread is EXHAUSTED (clear, complete, specific answer):
→ Brief acknowledge, move to next question.

## Rules

- ONE question at a time. Never compound questions.
- Keep your responses SHORT. This is about them talking, not you.
- Don't over-praise. One brief "that's interesting" per answer max.
- Allow 2-3 seconds of silence after they finish — they often add the most interesting part after a pause.
- After ~4.5 minutes, begin wrapping up naturally. Don't cut them off mid-thought.
- At the end, thank them briefly and let them know you got great material.
- Be warm but direct. Not robotic, not sycophantic.${reInterviewContext}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ai/interviewer-prompt.ts
git commit -m "feat: add interviewer system prompt for profile extraction"
```

---

### Task 4: Profile Extractor (Claude)

**Files:**
- Create: `server/src/ai/profile-extractor.ts`

- [ ] **Step 1: Create the profile extractor**

```typescript
// server/src/ai/profile-extractor.ts
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
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ai/profile-extractor.ts
git commit -m "feat: add Claude-based profile extractor for interview transcripts"
```

---

### Task 5: Prompt Assembler Integration

**Files:**
- Modify: `server/src/ai/prompt-assembler.ts`

- [ ] **Step 1: Add author profile layer to prompt assembler**

In `prompt-assembler.ts`, add import:
```typescript
import { getAuthorProfile } from "../db/profile-queries.js";
```

Update the `AssembledPrompt` interface `layers` field to include `author_profile: number`.

Update `TOKEN_BUDGET` from `2000` to `2200`.

Add a `formatProfileLayer` function:
```typescript
function formatProfileLayer(profileText: string): string {
  if (!profileText || profileText.trim().length === 0) return "";
  return `## Author Profile\n\n${profileText}`;
}
```

In `assemblePrompt`, after fetching rules/coaching/template, fetch and format the profile:
```typescript
const profile = getAuthorProfile(db);
const profileText = profile ? formatProfileLayer(profile.profile_text) : "";
const profileTokens = estimateTokens(profileText);
```

Add `profileText` to the system prompt assembly array (between coaching and post type) and include `author_profile: profileTokens` in the returned layers.

Adjust the budget trimming logic to account for the profile layer (profile has priority, coaching still gets trimmed first).

- [ ] **Step 2: Verify prompt assembler still works**

Run: `curl -X POST http://localhost:3001/api/generate/research -H 'Content-Type: application/json' -d '{"post_type":"news"}'`
Expected: Research completes successfully (prompt assembler didn't break).

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/prompt-assembler.ts
git commit -m "feat: add author profile layer to prompt assembler with 2200 token budget"
```

---

### Task 6: Drafter & Generate Route Changes

**Files:**
- Modify: `server/src/ai/drafter.ts`
- Modify: `server/src/routes/generate.ts`
- Modify: `server/src/db/generate-queries.ts`

- [ ] **Step 1: Update drafter to accept personalConnection**

In `drafter.ts`, update `generateDrafts` signature to add optional `personalConnection?: string` parameter after `story`.

In the `storyContext` construction, append personal connection if provided:
```typescript
const connectionContext = personalConnection
  ? `\n\n## Personal Connection\n${personalConnection}`
  : "";
```

Include `connectionContext` in the user message content for each draft variation, after the variation instruction.

- [ ] **Step 2: Update generate-queries.ts**

Add `personal_connection` to `GenerationRecord` interface.

Update `insertGeneration` to accept and persist `personal_connection`:
```typescript
export function insertGeneration(
  db: Database.Database,
  data: {
    research_id: number;
    post_type: string;
    selected_story_index: number;
    drafts_json: string;
    prompt_snapshot?: string;
    personal_connection?: string;
  }
): number {
  const result = db.prepare(
    `INSERT INTO generations (research_id, post_type, selected_story_index, drafts_json, prompt_snapshot, personal_connection)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(data.research_id, data.post_type, data.selected_story_index, data.drafts_json, data.prompt_snapshot ?? null, data.personal_connection ?? null);
  return Number(result.lastInsertRowid);
}
```

- [ ] **Step 3: Update generate route to pass personal_connection**

In `server/src/routes/generate.ts`, update the drafts endpoint to destructure `personal_connection` from the request body:
```typescript
const { research_id, story_index, post_type, personal_connection } = request.body as {
  research_id: number;
  story_index: number;
  post_type: string;
  personal_connection?: string;
};
```

Pass it through to `generateDrafts`:
```typescript
const result = await generateDrafts(client, db, logger, post_type as any, stories[story_index], personal_connection);
```

And to `insertGeneration`:
```typescript
const generationId = insertGeneration(db, {
  research_id,
  post_type,
  selected_story_index: story_index,
  drafts_json: JSON.stringify(result.drafts),
  prompt_snapshot: result.prompt_snapshot,
  personal_connection,
});
```

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/drafter.ts server/src/routes/generate.ts server/src/db/generate-queries.ts
git commit -m "feat: pass personal connection through draft generation pipeline"
```

---

## Chunk 2: Dashboard — Profile UI & Interview

### Task 7: API Client Updates

**Files:**
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add author profile types and API methods**

Add types after the existing `GenCoachingInsight` interface:
```typescript
export interface AuthorProfileResponse {
  profile_text: string;
  profile_json: {
    mental_models: string[];
    contrarian_convictions: string[];
    scar_tissue: string[];
    disproportionate_caring: string[];
    vantage_point: string;
    persuasion_style: string;
  };
  interview_count: number;
}

export interface InterviewSessionResponse {
  client_secret: string;
  model: string;
}

export interface ExtractedProfileResponse {
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
```

Add API methods to the `api` object:
```typescript
// Author Profile
getAuthorProfile: () =>
  get<AuthorProfileResponse>("/author-profile"),

saveAuthorProfile: (profile_text: string, profile_json?: Record<string, any>) =>
  fetch(`${BASE_URL}/author-profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_text, profile_json }),
  }).then((r) => r.json() as Promise<{ ok: boolean }>),

createInterviewSession: (preInfo?: { name?: string; role?: string; company?: string; bio?: string }) =>
  fetch(`${BASE_URL}/author-profile/interview/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preInfo ?? {}),
  }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json() as Promise<InterviewSessionResponse>;
  }),

extractProfile: (transcript: string, duration_seconds?: number) =>
  fetch(`${BASE_URL}/author-profile/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, duration_seconds }),
  }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json() as Promise<ExtractedProfileResponse>;
  }),
```

Update `generateDrafts` to accept optional `personalConnection`:
```typescript
generateDrafts: (researchId: number, storyIndex: number, postType: string, personalConnection?: string) =>
  fetch(`${BASE_URL}/generate/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      research_id: researchId,
      story_index: storyIndex,
      post_type: postType,
      personal_connection: personalConnection,
    }),
  }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json() as Promise<GenDraftsResponse>;
  }),
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add author profile API client methods and update generateDrafts"
```

---

### Task 8: WebRTC Interview Hook

**Files:**
- Create: `dashboard/src/hooks/useRealtimeInterview.ts`

- [ ] **Step 1: Create the WebRTC hook**

```typescript
// dashboard/src/hooks/useRealtimeInterview.ts
import { useState, useRef, useCallback } from "react";
import { api } from "../api/client";

export type InterviewStatus = "idle" | "connecting" | "active" | "processing" | "done" | "error";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

interface UseRealtimeInterviewReturn {
  status: InterviewStatus;
  elapsed: number;
  transcript: TranscriptEntry[];
  error: string | null;
  start: (preInfo?: { name?: string; role?: string; company?: string; bio?: string }) => Promise<void>;
  stop: () => void;
}

export function useRealtimeInterview(): UseRealtimeInterviewReturn {
  const [status, setStatus] = useState<InterviewStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const startTimeRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
  }, []);

  const start = useCallback(async (preInfo?: { name?: string; role?: string; company?: string; bio?: string }) => {
    setError(null);
    setTranscript([]);
    setElapsed(0);
    setStatus("connecting");

    try {
      // Request mic permission
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError("Microphone access is required for the voice interview. Please allow microphone access and try again.");
        setStatus("error");
        return;
      }
      streamRef.current = stream;

      // Get ephemeral token from our server
      const session = await api.createInterviewSession(preInfo);

      // Set up WebRTC
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Play remote audio
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;
      pc.ontrack = (e) => { audio.srcObject = e.streams[0]; };

      // Add local mic track
      pc.addTrack(stream.getTracks()[0]);

      // Data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Capture transcript from conversation events
          if (msg.type === "response.audio_transcript.done" && msg.transcript) {
            setTranscript((prev) => [...prev, { role: "assistant", text: msg.transcript, timestamp: Date.now() }]);
          }
          if (msg.type === "conversation.item.input_audio_transcription.completed" && msg.transcript) {
            setTranscript((prev) => [...prev, { role: "user", text: msg.transcript, timestamp: Date.now() }]);
          }
        } catch {
          // ignore non-JSON messages
        }
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Connect to OpenAI Realtime
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.client_secret}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error("Failed to connect to OpenAI Realtime API");
      }

      const answer = { type: "answer" as const, sdp: await sdpResponse.text() };
      await pc.setRemoteDescription(answer);

      // Start timer
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      setStatus("active");

      // Send session update to enable input audio transcription
      dc.onopen = () => {
        dc.send(JSON.stringify({
          type: "session.update",
          session: {
            input_audio_transcription: {
              model: "gpt-4o-mini-transcribe",
            },
          },
        }));
      };
    } catch (err: any) {
      setError(err.message ?? "Failed to start interview");
      setStatus("error");
      cleanup();
    }
  }, [cleanup]);

  const stop = useCallback(() => {
    cleanup();
    setStatus("done");
  }, [cleanup]);

  return { status, elapsed, transcript, error, start, stop };
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/hooks/useRealtimeInterview.ts
git commit -m "feat: add WebRTC hook for OpenAI Realtime interview"
```

---

### Task 9: Profile Section & Interview Modal

**Files:**
- Create: `dashboard/src/pages/settings/ProfileSection.tsx`
- Create: `dashboard/src/pages/settings/InterviewModal.tsx`
- Modify: `dashboard/src/pages/Settings.tsx`

- [ ] **Step 1: Create ProfileSection component**

```typescript
// dashboard/src/pages/settings/ProfileSection.tsx
import { useState, useEffect } from "react";
import { api } from "../../api/client";
import InterviewModal from "./InterviewModal";

export default function ProfileSection() {
  const [profileText, setProfileText] = useState("");
  const [interviewCount, setInterviewCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInterview, setShowInterview] = useState(false);

  useEffect(() => {
    api.getAuthorProfile().then((r) => {
      setProfileText(r.profile_text);
      setInterviewCount(r.interview_count);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveAuthorProfile(profileText);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleInterviewComplete = (newProfileText: string) => {
    setProfileText(newProfileText);
    setInterviewCount((c) => c + 1);
    setShowInterview(false);
  };

  return (
    <>
      <div className="bg-surface-1 border border-border rounded-lg p-5 space-y-4 mt-3">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="text-sm font-medium text-text-primary mb-1">Author Profile</h4>
            <p className="text-xs text-text-muted">
              Your professional lens — injected into every post generation to make drafts sound like you.
            </p>
          </div>
          <button
            onClick={() => setShowInterview(true)}
            className="px-4 py-2 rounded-md text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors flex items-center gap-2"
          >
            <span className="text-base">&#127908;</span>
            {interviewCount > 0 ? "Re-interview" : "Start Interview"}
          </button>
        </div>

        {profileText ? (
          <>
            <textarea
              value={profileText}
              onChange={(e) => setProfileText(e.target.value)}
              rows={6}
              className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-none"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-md text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : saved ? "Saved" : "Save"}
              </button>
              <span className="text-xs text-text-muted">
                ~{Math.ceil(profileText.length / 4)} tokens &middot; always in prompt
              </span>
              {interviewCount > 0 && (
                <span className="text-xs text-text-muted">
                  &middot; {interviewCount} interview{interviewCount !== 1 ? "s" : ""} completed
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="bg-surface-2 rounded-lg p-6 text-center">
            <p className="text-sm text-text-muted mb-2">No profile yet</p>
            <p className="text-xs text-text-muted mb-4">
              Start a 5-minute voice interview and the AI will extract what makes your perspective distinctive.
              Or type your profile directly below.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowInterview(true)}
                className="px-4 py-2 rounded-md text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity"
              >
                Start Interview
              </button>
            </div>
          </div>
        )}
      </div>

      {showInterview && (
        <InterviewModal
          onClose={() => setShowInterview(false)}
          onComplete={handleInterviewComplete}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Create InterviewModal component**

```typescript
// dashboard/src/pages/settings/InterviewModal.tsx
import { useState } from "react";
import { api } from "../../api/client";
import { useRealtimeInterview, type InterviewStatus } from "../../hooks/useRealtimeInterview";

interface InterviewModalProps {
  onClose: () => void;
  onComplete: (profileText: string) => void;
}

export default function InterviewModal({ onClose, onComplete }: InterviewModalProps) {
  const { status, elapsed, transcript, error, start, stop } = useRealtimeInterview();
  const [phase, setPhase] = useState<"pre" | "active" | "extracting" | "review">("pre");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [bio, setBio] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [extractedJson, setExtractedJson] = useState<Record<string, any>>({});
  const [extractError, setExtractError] = useState<string | null>(null);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleStart = async () => {
    await start({ name, role, company, bio });
    setPhase("active");
  };

  const handleStop = async () => {
    stop();
    setPhase("extracting");

    // Build transcript text
    const transcriptText = transcript
      .map((t) => `${t.role === "user" ? "User" : "Interviewer"}: ${t.text}`)
      .join("\n\n");

    if (!transcriptText.trim()) {
      setExtractError("No conversation was captured. Please try again.");
      setPhase("pre");
      return;
    }

    try {
      const result = await api.extractProfile(transcriptText, elapsed);
      setExtractedText(result.profile_text);
      setExtractedJson(result.profile_json);
      setPhase("review");
    } catch (err: any) {
      setExtractError(err.message ?? "Profile extraction failed");
      setPhase("pre");
    }
  };

  const handleSave = () => {
    onComplete(extractedText);
  };

  const layerLabels: Record<string, { label: string; color: string }> = {
    mental_models: { label: "Mental Models", color: "text-purple-400" },
    contrarian_convictions: { label: "Contrarian Convictions", color: "text-red-400" },
    scar_tissue: { label: "Scar Tissue", color: "text-yellow-400" },
    disproportionate_caring: { label: "Disproportionate Caring", color: "text-green-400" },
    vantage_point: { label: "Vantage Point", color: "text-blue-400" },
    persuasion_style: { label: "Persuasion Style", color: "text-indigo-400" },
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface-0 border border-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">Profile Interview</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl">&times;</button>
        </div>

        <div className="p-5">
          {/* Pre-interview */}
          {phase === "pre" && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                A 5-minute voice conversation to capture what makes your professional perspective distinctive.
                The AI will ask about your mental models, contrarian beliefs, and hard-won lessons.
              </p>

              {(error || extractError) && (
                <div className="bg-negative/10 text-negative text-sm rounded-lg p-3">
                  {error || extractError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted block mb-1">Name</label>
                  <input
                    value={name} onChange={(e) => setName(e.target.value)}
                    className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1">Role</label>
                  <input
                    value={role} onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    placeholder="e.g. Engineering Manager"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1">Company</label>
                  <input
                    value={company} onChange={(e) => setCompany(e.target.value)}
                    className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    placeholder="Where you work"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1">Brief bio</label>
                  <input
                    value={bio} onChange={(e) => setBio(e.target.value)}
                    className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    placeholder="One sentence about what you do"
                  />
                </div>
              </div>

              <div className="bg-surface-2 rounded-lg p-4 text-xs text-text-muted space-y-1">
                <p className="font-medium text-text-secondary">Topics we'll cover:</p>
                <p>&bull; What you actually do (beyond your title)</p>
                <p>&bull; What your industry gets wrong</p>
                <p>&bull; Hard-won lessons and recurring patterns</p>
                <p>&bull; Mental models you apply everywhere</p>
              </div>

              <button
                onClick={handleStart}
                disabled={status === "connecting"}
                className="w-full py-3 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {status === "connecting" ? "Connecting..." : "Start Interview"}
              </button>
            </div>
          )}

          {/* Active interview */}
          {phase === "active" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Pulsing indicator */}
                  <div className="relative">
                    <div className="w-4 h-4 bg-negative rounded-full animate-pulse" />
                    <div className="absolute inset-0 w-4 h-4 bg-negative rounded-full animate-ping opacity-30" />
                  </div>
                  <span className="text-sm font-medium text-text-primary">Interview in progress</span>
                </div>
                <span className="text-2xl font-mono text-text-primary tabular-nums">
                  {formatTime(elapsed)}
                </span>
              </div>

              {/* Live transcript */}
              <div className="bg-surface-2 rounded-lg p-4 max-h-64 overflow-y-auto space-y-3">
                {transcript.length === 0 ? (
                  <p className="text-sm text-text-muted italic">Waiting for conversation to begin...</p>
                ) : (
                  transcript.map((t, i) => (
                    <div key={i} className={`text-sm ${t.role === "user" ? "text-text-primary" : "text-accent"}`}>
                      <span className="text-xs text-text-muted font-medium">
                        {t.role === "user" ? "You" : "AI"}:
                      </span>{" "}
                      {t.text}
                    </div>
                  ))
                )}
              </div>

              <button
                onClick={handleStop}
                className="w-full py-3 rounded-lg text-sm font-medium bg-surface-2 text-text-primary hover:bg-surface-3 transition-colors border border-border"
              >
                End Interview
              </button>
            </div>
          )}

          {/* Extracting */}
          {phase === "extracting" && (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <svg className="animate-spin h-6 w-6 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
              <p className="text-sm">Extracting your profile...</p>
              <p className="text-xs mt-1">Analyzing {transcript.length} conversation exchanges</p>
            </div>
          )}

          {/* Review extracted profile */}
          {phase === "review" && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Here's what we extracted. Edit anything that doesn't sound right.
              </p>

              <div>
                <label className="text-xs text-text-muted block mb-1">Profile (injected into every draft)</label>
                <textarea
                  value={extractedText}
                  onChange={(e) => setExtractedText(e.target.value)}
                  rows={6}
                  className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-none"
                />
                <span className="text-xs text-text-muted">~{Math.ceil(extractedText.length / 4)} tokens</span>
              </div>

              {/* Structured layers */}
              <div className="space-y-3">
                {Object.entries(layerLabels).map(([key, { label, color }]) => {
                  const value = extractedJson[key];
                  if (!value) return null;
                  return (
                    <div key={key} className="bg-surface-2 rounded-lg p-3">
                      <span className={`text-xs font-semibold uppercase ${color}`}>{label}</span>
                      <div className="mt-1 text-sm text-text-secondary">
                        {Array.isArray(value)
                          ? value.map((v: string, i: number) => <p key={i} className="mt-0.5">&bull; {v}</p>)
                          : <p>{value}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  className="flex-1 py-3 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity"
                >
                  Save Profile
                </button>
                <button
                  onClick={() => { setPhase("pre"); }}
                  className="px-4 py-3 rounded-lg text-sm font-medium bg-surface-2 text-text-primary hover:bg-surface-3 transition-colors border border-border"
                >
                  Redo Interview
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Integrate into Settings.tsx**

In `dashboard/src/pages/Settings.tsx`, add import:
```typescript
import ProfileSection from "./settings/ProfileSection";
```

Add `<ProfileSection />` inside the Profile section, after the photo upload div but before the closing `</section>` tag.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/settings/ProfileSection.tsx dashboard/src/pages/settings/InterviewModal.tsx dashboard/src/pages/Settings.tsx
git commit -m "feat: add profile section with voice interview modal to Settings"
```

---

### Task 10: Personal Connection in Generate Flow

**Files:**
- Modify: `dashboard/src/pages/Generate.tsx`
- Modify: `dashboard/src/pages/generate/StorySelection.tsx`

- [ ] **Step 1: Add personalConnection to GenerationState**

In `dashboard/src/pages/Generate.tsx`, add `personalConnection: string` to the `GenerationState` interface and `personalConnection: ""` to `initialState`.

- [ ] **Step 2: Update StorySelection to show personal connection input**

In `StorySelection.tsx`, after a story is selected and the user clicks "Generate drafts", show the personal connection text area inline.

Add to StorySelectionProps:
```typescript
gen: {
  // ... existing fields
  personalConnection: string;
};
```

Add state for showing the connection input:
```typescript
const [showConnectionInput, setShowConnectionInput] = useState(false);
```

Modify `handleGenerateDrafts` to pass `gen.personalConnection`:
```typescript
const res = await api.generateDrafts(gen.researchId, gen.selectedStoryIndex, gen.postType, gen.personalConnection || undefined);
```

When user clicks "Generate drafts" button, instead of immediately generating, show the connection input:
```typescript
// Replace the "Generate drafts" button onClick
onClick={() => setShowConnectionInput(true)}
```

Add the connection input UI after the bottom bar when `showConnectionInput` is true:
```tsx
{showConnectionInput && gen.selectedStoryIndex !== null && (
  <div className="mt-4 p-4 bg-gen-bg-1 border border-gen-border-1 rounded-xl space-y-3">
    <div>
      <h3 className="text-[14px] font-medium text-gen-text-0">
        What's your personal connection to this?
      </h3>
      <p className="text-[12px] text-gen-text-3 mt-1">
        Optional — helps the AI ground the draft in your real experience.
      </p>
    </div>
    <textarea
      value={gen.personalConnection}
      onChange={(e) => setGen((prev: any) => ({ ...prev, personalConnection: e.target.value }))}
      rows={3}
      placeholder='e.g. "We migrated off Heroku to AWS and it took 6 months longer than estimated. The real cost wasn\'t the migration — it was the feature freeze."'
      className="w-full bg-gen-bg-0 border border-gen-border-1 rounded-lg px-3 py-2 text-[13px] text-gen-text-0 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent resize-none"
    />
    <div className="flex gap-3 justify-end">
      <button
        onClick={() => { setShowConnectionInput(false); handleGenerateDrafts(); }}
        className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors"
      >
        Skip — generate without
      </button>
      <button
        onClick={() => { setShowConnectionInput(false); handleGenerateDrafts(); }}
        disabled={loading}
        className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors disabled:opacity-40"
      >
        {loading ? "Generating..." : "Generate with connection"}
      </button>
    </div>
  </div>
)}
```

The "Auto-pick best match" button should bypass the connection input entirely (no change needed — it calls `handleAutoPickAndGenerate` which goes direct).

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Generate.tsx dashboard/src/pages/generate/StorySelection.tsx
git commit -m "feat: add personal connection input to generate flow"
```

---

## Chunk 3: Build, Verify, Push

### Task 11: Build & Smoke Test

- [ ] **Step 1: Build dashboard**

Run: `cd /Users/nate/code/linkedin/dashboard && npx vite build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Restart server and verify**

Run: `cd /Users/nate/code/linkedin && pnpm dev`
Verify:
- `curl http://localhost:3001/api/author-profile` returns empty profile
- Settings page loads with new Profile section
- Generate tab still works (research + draft generation)

- [ ] **Step 3: Test profile save/load**

```bash
curl -X PUT http://localhost:3001/api/author-profile \
  -H 'Content-Type: application/json' \
  -d '{"profile_text": "Test profile text for prompt injection"}'
# Should return {"ok":true}

curl http://localhost:3001/api/author-profile
# Should return the saved profile text
```

- [ ] **Step 4: Verify prompt assembler includes profile**

Generate drafts and check the prompt snapshot includes "## Author Profile".

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "feat: complete personal profile feature with voice interview and prompt integration"
git push origin main
```
