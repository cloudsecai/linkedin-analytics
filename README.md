# ReachLab

Your LinkedIn data is trapped behind a dashboard you don't own.

ReachLab gets it out. A Chrome extension collects your post metrics automatically, stores everything locally in SQLite, and gives you an AI-powered writing studio that learns what you write about and helps you write more of it.

No SaaS. No data sharing. Runs on your machine.

## What it does

**Collects everything LinkedIn shows you, automatically.** The extension runs in the background and captures post impressions, reactions, comments, reposts, new followers, follower growth, profile views, and search appearances. Video posts are automatically transcribed locally using whisper.cpp so their content is searchable and analyzable alongside text posts.

**Builds a real content history.** LinkedIn only shows you the last year of posts with limited filtering. This stores every post with full text, images, content type classification, and complete metric history — giving you a dataset that gets more valuable over time.

**Analyzes what's actually driving your engagement.** The AI coach discovers your content taxonomy (the topics you actually write about), tracks which topics, hook types, and formats perform best, identifies trends across your posting history, and generates specific recommendations with evidence. Insights persist across analysis runs — the system tracks which patterns are strengthening, reversing, or fading.

**Generates posts in your voice.** The Generate tab is a full writing studio: it scans your RSS sources for timely topics, drafts multiple variations with your style and expertise baked in, runs an AI coach-check against your best practices, and lets you revise through conversation. After publishing, a retro step helps you track what worked.

**Learns how you write.** An optional voice interview (using OpenAI's Realtime API) captures your perspective and writing style in a 5-minute conversation. Combined with analysis of your past posts, this builds a writing prompt that any AI can use to write like you.

## Dashboard

- **Overview** — KPI summary with period-over-period comparisons, top performer highlight, and quick insights
- **Posts** — Full post history with sortable metrics, content type filtering, and engagement rate calculations
- **Coach** — AI-generated recommendations with priority/confidence ratings, persistent insights with trend tracking, deep-dive breakdowns by topic, hook type, and image subtype
- **Generate** — Full writing pipeline: topic discovery from RSS feeds → multiple draft variations → AI coach-check and conversational revision → post retro after publishing
- **Timing** — Heatmap of when your posts get the most engagement, broken down by day and hour
- **Followers** — Growth tracking over time
- **Settings** — Writing prompt editor with revision history, author profile, source management, timezone configuration, re-run onboarding wizard

## Onboarding

First-time users get a guided setup wizard that walks through:

1. **Install the Chrome extension** — step-by-step instructions with platform-specific paths
2. **Sync your LinkedIn posts** — connect to LinkedIn analytics and import your history
3. **Analyze your writing** — AI discovers your topics and builds a writing style profile
4. **Voice interview** (optional) — a 5-minute voice conversation to capture your perspective and tone
5. **Source discovery** — auto-discovers relevant RSS feeds based on your topics, or add your own
6. **Done** — drops you into the Generate tab, ready to write

The wizard can be skipped at any step and re-run from Settings.

## Architecture

```
Chrome Extension (Manifest V3)
    ↓ POST to localhost:3210/api/ingest
Local Node Server (Fastify + better-sqlite3)
    ↓ reads/writes
SQLite Database (data/linkedin.db)
    ↓ serves
React Dashboard (Tailwind CSS + Chart.js)
```

The extension uses `webRequest` to passively capture video streaming URLs, DOM scraping for post content and metrics, and background tabs for automated collection. Sync state is stored server-side so reinstalling the extension doesn't lose progress.

The AI pipeline runs through OpenRouter (Claude Haiku for taxonomy and tagging, Sonnet for analysis and drafting) and Perplexity Sonar Pro (for source discovery and research). Source discovery and the voice interview use the OpenAI Realtime API.

## Prerequisites

- **Node.js** >= 20
- **pnpm** (`npm install -g pnpm`)
- **Chrome** or Chromium-based browser
- **OpenRouter API key** (for AI Coach and Generate features)
- **Perplexity API key** (optional, for source discovery and research)
- **OpenAI API key** (optional, for voice interview)
- **ffmpeg** (optional, for video transcription — `brew install ffmpeg`)
- **whisper-cpp** (optional, for video transcription — `brew install whisper-cpp`)

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

This installs all three workspaces (server, dashboard, extension).

### 2. Configure API keys

Create a `.env` file in `server/`:

```
TRUSTMIND_LLM_API_KEY=sk-or-...
```

Optional keys for additional features:
```
PERPLEXITY_API_KEY=pplx-...    # Source discovery & research
OPENAI_API_KEY=sk-...          # Voice interview
```

### 3. Start the app

```bash
pnpm dev
```

This starts both the server and dashboard in development mode. Open **http://localhost:3210** — the onboarding wizard will guide you through the rest.

If this is your first time, the wizard will walk you through installing the extension, syncing your posts, and setting up your writing profile.

### 4. Install the Chrome extension

The onboarding wizard gives you step-by-step instructions, but here's the summary:

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder in your ReachLab directory
5. Pin the extension to your toolbar

### 5. Sync your LinkedIn posts

1. Make sure the server is running (`pnpm dev`)
2. Navigate to your LinkedIn analytics: **linkedin.com** → **Me** → **Analytics** → or go directly to `linkedin.com/analytics/creator/content/`
3. The extension automatically detects the page and begins scraping
4. The first sync may take a minute as it walks through your posts. Subsequent syncs run automatically every 24 hours.

### 6. Run AI analysis

After syncing, go to the **Coach** tab and click **Refresh AI**. This discovers your content taxonomy, classifies posts by topic, identifies engagement patterns, and generates recommendations.

## Production

For production use (no hot-reload, optimized build):

```bash
pnpm build        # Builds dashboard + extension
pnpm start         # Starts server on port 3210
```

Or use the convenience script:
```bash
./start.sh
```

## Video Transcription (Optional)

Video posts are automatically transcribed using local whisper.cpp — no external API calls, no data leaving your machine. The extension captures LinkedIn's DASH streaming URLs via network interception, and the server downloads and transcribes locally.

Setup:
```bash
brew install ffmpeg whisper-cpp
```

Download the whisper model (~148MB, one-time):
```bash
mkdir -p data/models
curl -L -o data/models/ggml-base.en.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
```

Transcription runs automatically on server startup and when new video posts are ingested.

## Development

```bash
pnpm dev           # Server (watch mode, port 3211) + Dashboard (Vite HMR, port 3210)
pnpm test          # Run tests
```

Use `REACHLAB_DB` to point at an alternate database for testing:
```bash
REACHLAB_DB=/tmp/test.db pnpm dev
```

## Project Structure

```
├── server/           # Fastify API server
│   ├── src/
│   │   ├── ai/       # AI analysis, drafting, coaching, transcription
│   │   ├── db/       # SQLite schema, migrations, queries
│   │   ├── routes/   # API endpoints (generate, insights, profile, settings)
│   │   └── index.ts  # Server entrypoint
│   └── package.json
├── dashboard/        # React frontend (Vite + Tailwind)
│   ├── src/
│   │   ├── pages/    # Overview, Posts, Coach, Generate, Timing, Followers, Settings
│   │   │   ├── generate/    # Discovery, drafting, review, retro pipeline
│   │   │   └── onboarding/  # First-run setup wizard
│   │   ├── api/      # API client with TypeScript types
│   │   └── index.css # Design tokens and theme
│   └── package.json
├── extension/        # Chrome extension (Manifest V3)
│   ├── src/
│   │   ├── background/  # Service worker with sync orchestration
│   │   ├── content/     # DOM scraper for LinkedIn analytics
│   │   └── popup/       # Extension popup UI
│   └── manifest.json
├── data/             # SQLite database + models (gitignored)
└── docs/             # Design specs and plans
```
