# Personal Profile Feature — Design Spec

> **For agentic workers:** This spec defines the personal profile feature for ReachLab. Use superpowers:writing-plans to create the implementation plan.

**Goal:** Build a voice-interview-driven profile system that captures what's fundamental about the user — their lens, convictions, and expertise — and injects it into every post generation to produce more distinctive, practitioner-grounded LinkedIn content.

**Core Insight:** The profile is NOT a collection of stories (stories are single-use). It captures the *interpretive substrate* — mental models, contrarian convictions, scar tissue, disproportionate caring, vantage point, and persuasion style — that makes the user's perspective on ANY topic interesting.

---

## 1. Feature Overview

Three interconnected pieces:

1. **Voice Profile Interview** (Settings → Profile) — A 5-minute voice conversation via OpenAI Realtime API that interviews the user to extract their professional lens. The AI asks targeted questions, follows up on interesting threads, and extracts a structured profile.

2. **Personal Connection Input** (Generate flow) — After picking a news story and before drafting, an optional text box: "What's your personal connection to this?" Injected into the draft prompt alongside the story context.

3. **Prompt Integration** — The extracted profile is always present in the system prompt as an "Author Profile" layer. The drafting instruction is updated to brainstorm personal connections before writing.

---

## 2. Voice Profile Interview

### 2.1 Technology

- **OpenAI Realtime API** via WebSocket connection
- Browser captures audio via `getUserMedia`
- Server creates an ephemeral session token; browser connects directly to OpenAI (no server-side audio proxy)
- Audio streams bidirectionally — user hears AI voice responses
- Requires `OPENAI_API_KEY` environment variable

### 2.2 What We Extract (The 6 Layers)

| Layer | What It Captures | Example |
|-------|-----------------|---------|
| **Mental Models** | The 2-3 frameworks they apply to everything | "I see everything through feedback loops" |
| **Contrarian Convictions** | Where they disagree with consensus | "Premature optimization kills more projects than tech debt" |
| **Scar Tissue** | Recurring failure patterns they've observed | "I've watched 3 migrations fail because teams underestimate feature freeze cost" |
| **Disproportionate Caring** | What they obsess over that others ignore | "Nobody pays attention to developer onboarding but it determines everything" |
| **Vantage Point** | What they see from where they sit | "I've been both IC and VP so I see both altitude perspectives" |
| **Persuasion Style** | How they naturally argue/convince | "Leads with opinion, backs with evidence, uses construction metaphors" |

### 2.3 Interview Flow (5 minutes, 4 phases)

**Phase 0: Pre-Interview (before voice starts)**
- Collect basic info via text form: name, role, company, brief bio
- AI personalizes opening question based on this
- Time: 0 seconds of interview time

**Phase 1: Anchor (0:00–0:45)**
- Purpose: Establish domain, get past the job title
- Question: "What do you *actually* do day-to-day?" or "What part of your work are you most obsessively interested in right now?"
- AI behavior: Listen for specifics. If generic, probe: "What's the problem keeping you up at night?"

**Phase 2: The Dig (0:45–2:30) — Most important phase**
- Purpose: Extract hard-won beliefs and unique lens
- Pick 1-2 questions based on Phase 1:
  - "What does your industry get fundamentally wrong?"
  - "What's the most common advice in your field that's actually wrong?"
  - "What did you have to learn the hard way — something you couldn't learn from a book?"
  - "When you evaluate [domain problem], what do you look at that most people overlook?"
- **Critical rule:** If producing signal, STAY HERE. Don't move on just to cover more ground. Depth > breadth.

**Phase 3: Expand (2:30–4:00)**
- Purpose: Understand cross-domain thinking and mental models
- "Is there a principle or mental model you apply across different situations?"
- "If you could make everyone in your industry understand one thing, what would it be?"

**Phase 4: Close (4:00–5:00)**
- Purpose: Catch what the structure missed
- "Is there something important about how you think or work that we haven't touched on?"
- Often produces the most revealing answer

### 2.4 AI Follow-Up Logic

The AI detects signals and responds:

| Signal | Detection | Response |
|--------|-----------|----------|
| Surface answer | Generic, cliche, or abstract without example | "Can you make that more concrete?" |
| Energy spike | More specific, faster speech | "Say more about that." |
| Casual aside | "Oh, and also..." or "I guess the real thing is..." | "Wait — you said [phrase]. What's behind that?" |
| Contradiction | Conflicts with earlier answer | "Earlier you said X, but now Y — how do those fit?" |
| Thread exhausted | Clear, complete answer with specifics | Brief acknowledge, move to next phase |

### 2.5 Post-Interview Processing

After the conversation ends:
1. Full transcript is saved to `${dataDir}/recordings/` as JSON (directory created if it doesn't exist)
2. Claude (Sonnet) processes the transcript to extract the 6 layers into a structured profile
3. User reviews and edits the extracted profile before saving
4. Profile is stored in the database via upsert (`INSERT OR REPLACE` on `id = 1`)

### 2.6 Re-Interview

Users can re-interview at any time. The AI has access to the existing profile and focuses on gaps or changes: "Last time you mentioned X — has your thinking changed on that?"

### 2.7 Error Handling

- **Microphone permission denied**: Show clear message ("Microphone access is required for the voice interview. Please allow microphone access and try again.") with a fallback option to type answers instead.
- **Session creation failure**: Show error with retry button. Log the error server-side.
- **Mid-interview disconnect**: Save partial transcript. Show "Connection lost" with option to resume or save what was captured. The post-interview extraction still runs on whatever transcript was captured.
- **Ephemeral token expiry**: OpenAI tokens last 60 seconds — the browser must connect within that window. If expired, request a new token automatically.

---

## 3. Personal Connection Input (Generate Flow)

### 3.1 UI Placement

After selecting a story in Step 1 (StorySelection), before generating drafts:
- A text area appears: "What's your personal connection to this?"
- Placeholder example: "We migrated off Heroku to AWS and it took 6 months longer than estimated..."
- Two buttons: "Skip — generate without" and "Generate with connection"
- The personal connection text is passed to the draft generation API

### 3.2 Behavior

- Optional — user can skip it entirely
- **Auto-pick flow**: The "Auto-pick best match" button skips the personal connection step and generates immediately (no interruption to the fast path)
- Not stored for reuse (it's per-generation context, not profile data)
- Stored on the generation record for history/audit purposes
- Injected into the user message alongside story context in the drafter

---

## 4. Prompt Integration

### 4.1 Prompt Assembler Changes

Add a new "Author Profile" layer to `prompt-assembler.ts`:

```
System prompt layers (in order):
1. "You are a LinkedIn post ghostwriter."
2. ## Writing Rules (existing)
3. ## Coaching Insights (existing)
4. ## Author Profile (NEW — always present if profile exists)
5. ## Post Type Template (existing)
6. ## Story Context (existing)
```

The Author Profile layer is injected from the database. Target: ~200 tokens. Increase the token budget from 2000 to 2200. The profile layer gets priority alongside rules — coaching insights are trimmed first if over budget.

The `assemblePrompt` function already receives a `db` parameter. It will query the `author_profile` table internally — no signature change needed. The `AssembledPrompt.layers` type gains an `author_profile: number` field.

### 4.2 Drafter Changes

Update `drafter.ts`:
1. Accept an optional `personalConnection` string parameter
2. If provided, include it in the user message: `## Personal Connection\n{text}`
3. Update the variation instructions to reference the author profile and personal connection

The call chain: `POST /api/generate/drafts` route handler destructures `personal_connection` from the request body, passes it to `generateDrafts(client, db, logger, postType, story, personalConnection)`.

### 4.3 Writing Prompt Update

Add this instruction to the drafting system prompt (within the Author Profile layer or as part of variation instructions):

> "For each story, before writing any draft, brainstorm 2-3 ways this story connects to something the author has personally built, shipped, witnessed, or gotten wrong in their own work (using the Author Profile for context). Then write only 1 draft per story first — the version where the personal connection is in the opening hook or closing question, not buried in the body. Only generate alternate versions if the first draft does not yet have a sharp practitioner claim and a closing question likely to trigger substantive disagreement."

---

## 5. Data Model

### 5.1 New Database Table: `author_profile`

Single-row table (single-user app). Always upsert on `id = 1`.

```sql
CREATE TABLE IF NOT EXISTS author_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- enforce single row
  profile_text TEXT NOT NULL,              -- The ~200 token structured profile for prompt injection
  profile_json TEXT NOT NULL DEFAULT '{}', -- JSON with all 6 layers for the review/edit UI
  interview_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

The `profile_json` field contains:
```json
{
  "mental_models": ["..."],
  "contrarian_convictions": ["..."],
  "scar_tissue": ["..."],
  "disproportionate_caring": ["..."],
  "vantage_point": "...",
  "persuasion_style": "..."
}
```

### 5.2 New Database Table: `profile_interviews`

```sql
CREATE TABLE IF NOT EXISTS profile_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript_json TEXT NOT NULL,        -- Full conversation transcript
  extracted_profile TEXT,               -- What was extracted from this interview
  duration_seconds INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 5.3 Modified Table: `generations`

Add column:
```sql
ALTER TABLE generations ADD COLUMN personal_connection TEXT;
```

The `insertGeneration` function and `GenerationRecord` type must be updated to accept and persist `personal_connection`.

### 5.4 Migration File

All schema changes go in `server/src/db/migrations/010-author-profile.sql`.

---

## 6. API Endpoints

### 6.1 Author Profile Endpoints

Namespaced under `/api/author-profile` to avoid collision with existing `/api/profile` (LinkedIn analytics).

- `GET /api/author-profile` — Returns the current author profile (profile_text + profile_json)
- `PUT /api/author-profile` — Updates the profile (manual edit of profile_text and/or profile_json)
- `POST /api/author-profile/extract` — Sends interview transcript, returns extracted profile via Claude

Dashboard API client methods: `getAuthorProfile()`, `saveAuthorProfile()`, `extractAuthorProfile()`.

### 6.2 Interview Session

- `POST /api/author-profile/interview/session` — Creates an OpenAI Realtime API session with the interviewer system prompt baked in, returns ephemeral client token
- The browser connects directly to OpenAI's Realtime API using the ephemeral token
- Server assembles the interviewer system prompt (interview flow, existing profile for re-interviews)

### 6.3 Modified Endpoints

- `POST /api/generate/drafts` — Add optional `personal_connection` string parameter in request body

---

## 7. UI Components

### 7.1 Settings → Profile Section

Keep the existing photo upload. Add below it:
- **Interview section** — "Build your profile" heading with "Start Interview" button that opens the interview modal
- **Profile editor** — Textarea showing `profile_text`, editable, with save button
- **Structured view** — Collapsible section showing the 6 layers from `profile_json` with inline editing
- **Interview history** — Collapsible list of past interviews with timestamps and duration

### 7.2 Interview Modal

- Large modal overlay
- **Pre-interview state**: Text fields for name/role/company/bio (pre-filled if already set), guided prompts showing what topics will be covered, "Start" button
- **During interview**:
  - Animated visual indicator (pulsing ring or waveform) showing AI is listening/speaking
  - Timer showing elapsed time (counts up to 5:00)
  - Current phase indicator (subtle)
  - "End interview early" button
- **Post-interview**:
  - Loading state while Claude extracts the profile
  - Shows extracted profile with 6 labeled sections
  - Each section is editable inline
  - "Save profile" button
- **Error states**: Mic permission denial, connection lost (with partial save option)

### 7.3 Generate Flow — Personal Connection

Integrated into StorySelection component:
- Appears inline after user selects a story and clicks "Generate drafts" (not a new step/page)
- Shows selected story headline at top for context
- Text area for personal connection with placeholder
- "Skip" and "Generate with connection" buttons
- Auto-pick path bypasses this entirely

---

## 8. Technical Considerations

### 8.1 OpenAI Realtime API

- Uses `gpt-4o-realtime-preview` model
- Requires `OPENAI_API_KEY` environment variable (separate from `TRUSTMIND_LLM_API_KEY`)
- Session flow: server creates session via REST → returns ephemeral token → browser connects via WebSocket to `wss://api.openai.com/v1/realtime`
- The interviewer system prompt is assembled server-side with the full interview flow logic, follow-up decision framework, and any existing profile context

### 8.2 Token Budget

Increase prompt assembler `TOKEN_BUDGET` from 2000 to 2200. Author profile (~200 tokens) gets priority alongside rules. Coaching insights remain the first to be trimmed if over budget.

### 8.3 Cost Estimates

- Interview: ~$0.06-0.12 per 5-minute session (Realtime API pricing)
- Profile extraction: ~$0.01 (Sonnet, one call)
- Per-generation overhead: ~200 tokens for profile layer (negligible cost increase)

---

## 9. Out of Scope

- Story/anecdote bank with RAG retrieval (profile captures the lens, not individual stories)
- Embedding-based retrieval (not needed at this scale)
- Local transcription via Whisper (using Realtime API for two-way conversation)
- Automated profile updates from generated posts
- Multi-user support
- Text-based interview fallback (v1 is voice-only; manual typing into profile editor is the fallback)
