# Topic Bubbles Discovery + Coach-Check + Conversational Revision

## Problem

The Generate tab has three issues:

1. **Post type tabs are confusing** — News/Topic/Insight influence research and drafting but the distinction is unclear, especially with manual topic input. Users can already direct the take via combining guidance.
2. **No browsable discovery** — Users either type a topic or click "Find me something" and get whatever the AI picks. There's no way to see what's interesting and choose.
3. **Quality gate shows problems it already knows how to fix** — The system detects AI tropes, voice mismatch, etc. but just displays warnings instead of fixing them. Users then leave the platform to iterate.

## Solution: Three Connected Changes

### 1. Topic Bubbles Discovery

Replace post type tabs and the current "Find me something" flow with a browsable topic discovery experience.

**Page load flow:**
1. RSS feeds scanned via existing `fetchAllFeeds()`
2. Headlines sent to Haiku with a clustering prompt
3. Returns ~20 topics organized into 3-5 AI-generated categories
4. Displayed as clickable bubbles, each a 3-5 word summary

**Layout:**
- Manual topic input at top ("I want to write about..." + Go button)
- Below: categorized topic bubbles with category headers
- Beautiful animated loading state during the 5-8s RSS scan + clustering

**Clicking a bubble:**
- Triggers Sonar Pro deep dive on that topic
- Returns 3 story cards (same as current manual topic path)
- Bubbles collapse away, story cards shown with "Back to topics" link
- Clicking "Back to topics" restores the bubbles (cached, no re-fetch)

### 2. Coach-Check Auto-Correction

Replace the pass/warn quality gate with a coach-check step that auto-fixes rule violations before the user sees the draft.

**Flow:** Generate drafts → combine → coach-check auto-fixes → user sees cleaned version

The coach-check prompt receives:
- The combined draft
- All writing rules (voice/tone, structure/formatting, anti-AI tropes)
- All active coaching insights
- The 6 quality dimensions

It fixes rule violations silently and produces two assessment sections:

**"Needs Your Expertise"** (top, prominent): 2-4 areas where human judgment is needed — framing choices, perspective decisions, domain knowledge gaps. These are things rules can't resolve.

**"Why This Aligns"** (bottom, secondary): Green checks confirming each quality dimension is satisfied. Confidence builder.

### 3. Conversational Revision

Replace action-button revision with a chat-based flow.

**ReviewEdit layout:**
- Left: editable draft textarea
- Right top: "Needs your expertise" cards (clickable → pre-fills chat)
- Right middle: chat thread (user messages + AI responses with revision explanations)
- Right bottom: "Alignment" green checks
- Chat input at bottom of right panel

**Existing action buttons (Shorten, Strengthen close) become chat shortcut chips** — same prompts, routed through the chat endpoint.

**Each revision runs coach-check** — catches any new rule violations introduced by the edit.

## Removed Concepts

- **Post type (News/Topic/Insight)** — everywhere. Research, drafting, and UI.
- **`TypeCache` / per-type caching** — replaced by simple discovery cache
- **Old quality gate** (`quality-gate.ts`, pass/warn checks) — replaced by coach-check
- **Old revision endpoint** (`/api/generate/revise`) — replaced by chat endpoint
- **Auto-research on tab switch** — already removed, now the whole tab concept is gone

## New Generate Pipeline

1. **Discovery** → topic bubbles (or type your own)
2. **Deep dive** → click bubble → 3 story cards
3. **Draft generation** → pick story → 3 variations (contrarian/operator/future)
4. **Combining** → select drafts + personal connection + guidance → combine → coach-check auto-fixes → cleaned draft
5. **Review/Chat** → iterate via conversation, inline editing, or both

## Server Changes

### New endpoint: `POST /api/generate/discover`

Fetches RSS feeds, sends to Haiku for clustering.

Request: (no body)

Response:
```json
{
  "categories": [
    {
      "name": "AI & Automation",
      "topics": [
        { "label": "AI agents replacing SREs", "source_headline": "...", "source_url": "..." }
      ]
    }
  ]
}
```

### Modified endpoint: `POST /api/generate/research`

- `topic` becomes required (no more auto path)
- `post_type` parameter removed
- `avoid` stays optional
- Calls Sonar Pro → Haiku synthesis → 3 story cards
- The auto path (RSS → rank → parallel Sonar Pro) is removed since discovery handles RSS scanning

Request:
```json
{ "topic": "AI agents replacing SREs", "avoid": ["headline1", "headline2"] }
```

### Modified endpoint: `POST /api/generate/drafts`

- `post_type` parameter removed from request
- Drafting prompt no longer varies by post type

### Modified endpoint: `POST /api/generate/combine`

- After `combineDrafts()`, calls `coachCheck()` instead of `runQualityGate()`
- Returns auto-fixed draft + new quality shape

Response:
```json
{
  "final_draft": "...",
  "quality": {
    "expertise_needed": [
      { "area": "Framing", "question": "Is the audit failure about enterprises not verifying, or about the trust model itself?" }
    ],
    "alignment": [
      { "dimension": "voice_match", "summary": "Practitioner tone throughout, concrete specifics grounded in real firms" }
    ]
  }
}
```

### New endpoint: `POST /api/generate/chat`

Request:
```json
{
  "generation_id": 1,
  "message": "Make the opening more confrontational",
  "edited_draft": "optional — if user edited inline before sending"
}
```

Response:
```json
{
  "draft": "revised draft text",
  "quality": { "expertise_needed": [...], "alignment": [...] },
  "explanation": "Sharpened the opening hook to lead with the fraud framing..."
}
```

- Loads full conversation history from `generation_messages`
- Sends to model with system prompt (rules + insights) + conversation thread
- Runs coach-check on the revision
- Saves user message + assistant response to `generation_messages`

### Removed endpoint: `POST /api/generate/revise`

Replaced by chat endpoint.

### New module: `coach-check.ts`

```typescript
interface CoachCheckResult {
  draft: string;
  expertise_needed: Array<{ area: string; question: string }>;
  alignment: Array<{ dimension: string; summary: string }>;
}

export async function coachCheck(
  client: Anthropic,
  logger: AiLogger,
  draft: string,
  rules: Rule[],
  insights: CoachingInsight[]
): Promise<CoachCheckResult>
```

### Removed module: `quality-gate.ts`

### New migration

```sql
CREATE TABLE generation_messages (
  id INTEGER PRIMARY KEY,
  generation_id INTEGER REFERENCES generations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  draft_snapshot TEXT,
  quality_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `quality_gate_json` column shape change

From:
```json
{ "passed": true, "checks": [{ "name": "...", "status": "pass|warn", "detail": "..." }] }
```

To:
```json
{
  "expertise_needed": [{ "area": "string", "question": "string" }],
  "alignment": [{ "dimension": "string", "summary": "string" }]
}
```

Existing rows with old shape are left as-is (backward compatible — frontend checks shape).

## Frontend Changes

### New component: `DiscoveryView` (replaces `StorySelection`)

Three states:
1. **Loading** — Animated loading during RSS scan + clustering (~5-8s)
2. **Bubbles** — Topic input at top. Categories with topic bubbles below.
3. **Story cards** — 3 cards for selected topic. "Back to topics" restores cached bubbles.

### Modified `GenerationState`

Remove:
- `postType`
- `cache: Record<PostType, TypeCache | null>`

Add:
- `discoveryTopics: Category[] | null`
- `selectedTopic: string | null`

Keep: `stories`, `researchId`, `articleCount`, `sourceCount`, `selectedStoryIndex`, `generationId`, `drafts`, `selectedDraftIndices`, `combiningGuidance`, `finalDraft`, `qualityGate`, `appliedInsights`, `personalConnection`

### Modified `DraftVariations`

- Personal connection textarea moves here (from StorySelection)
- Shown after selecting drafts, before combining
- No post type references

### Rewritten `ReviewEdit`

- Left panel: editable draft textarea
- Right panel top: "Needs your expertise" cards — clickable, pre-fills chat input
- Right panel middle: chat thread
- Right panel bottom: "Alignment" green checks
- Chat input at bottom of right panel
- "Shorten" and "Strengthen close" become chat shortcut chips
- No more separate revision action buttons

### Removed

- `QualityGateCard` component (replaced by two-section layout)
- Post type tabs (everywhere)
- `PostType` type, `TypeCache` interface

## Implementation Order

1. Database migration (`generation_messages` table)
2. `coach-check.ts` module
3. Wire coach-check into combine endpoint (replace `runQualityGate`)
4. Discovery endpoint + clustering prompt
5. Simplify research endpoint (remove post type, require topic)
6. Simplify drafts endpoint (remove post type)
7. Chat endpoint + conversation history
8. Frontend: `DiscoveryView` component with loading animation
9. Frontend: Update `GenerationState` (remove post type, add discovery)
10. Frontend: Move personal connection to `DraftVariations`
11. Frontend: Rewrite `ReviewEdit` with chat panel + new quality sections
12. Frontend: Remove post type references everywhere
13. End-to-end verification
