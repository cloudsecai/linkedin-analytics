# Linkling

Your LinkedIn data is trapped behind a dashboard you don't own.

Linkling gets it out. A Chrome extension collects your post metrics automatically, stores everything locally in SQLite, and runs an AI coach that tells you what's working and what to write next.

No SaaS. No data sharing. Runs on your machine.

## What it does

**Collects everything LinkedIn shows you, automatically.** The extension runs in the background and captures post impressions, reactions, comments, reposts, follower growth, profile views, and search appearances. Video posts are automatically transcribed locally using whisper.cpp so their content is searchable and analyzable alongside text posts.

**Builds a real content history.** LinkedIn only shows you the last year of posts with limited filtering. This stores every post with full text, images, content type classification, and complete metric history — giving you a dataset that gets more valuable over time.

**Analyzes what's actually driving your engagement.** The AI coach doesn't just tell you your numbers went up. It discovers your content taxonomy (the topics you actually write about), tracks which topics and formats perform best, identifies trends across your posting history, and generates specific recommendations with evidence. Insights persist across analysis runs — the system tracks which patterns are strengthening, reversing, or fading.

**Helps you write better posts.** A writing prompt system exports a ready-to-use prompt with your top-performing posts as a style guide. Paste it into any LLM and it already knows how you write.

## Dashboard

- **Overview** — KPI summary with period-over-period comparisons, top performer highlight, and quick insights
- **Posts** — Full post history with sortable metrics, content type filtering, and engagement rate calculations
- **Coach** — AI-generated recommendations with priority/confidence ratings, persistent insights with trend tracking, deep-dive analytics (category performance, engagement quality, timing analysis)
- **Timing** — Heatmap of when your posts get the most engagement, broken down by day and hour
- **Followers** — Growth tracking over time
- **Settings** — Writing prompt editor with revision history, author photo for image classification, timezone configuration

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

The AI pipeline runs locally through OpenRouter (Claude Haiku for taxonomy and tagging, Sonnet for analysis, Haiku for summaries) and can be triggered automatically after data collection or manually from the dashboard.

## Prerequisites

- **Node.js** >= 20
- **npm** (comes with Node)
- **Chrome** or Chromium-based browser
- **OpenRouter API key** (optional, for AI Coach features)
- **ffmpeg** (optional, for video transcription — `brew install ffmpeg`)
- **whisper-cpp** (optional, for video transcription — `brew install whisper-cpp`)

## Quick Start

### 1. Install dependencies

```bash
npm install
```

This installs all three workspaces (server, dashboard, extension).

### 2. Build the dashboard

```bash
npm run build:dashboard
```

The server serves the built dashboard as static files.

### 3. Start the server

```bash
npm start
```

The server starts on **http://localhost:3210**. On first run, it creates the SQLite database at `data/linkedin.db` and runs all migrations automatically.

### 4. Install the Chrome extension

1. Build the extension:
   ```bash
   npm run build:extension
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `extension/dist/` directory
6. Pin the extension to your toolbar

### 5. Run the initial data collection

1. Make sure the server is running (`npm start`)
2. Open LinkedIn in Chrome and navigate to your analytics page:
   - Go to **linkedin.com** → Click your profile → **Analytics & tools** → **Post impressions**
3. The extension will automatically detect the analytics pages and begin scraping
4. You can also click the extension icon and hit **Sync Now** to trigger a manual collection
5. The extension collects: post metrics, follower counts, profile views, and search appearances

The first sync may take a minute as it walks through your posts. Subsequent syncs run automatically every 24 hours when Chrome is open with the extension active.

### 6. Open the dashboard

Go to **http://localhost:3210** in your browser. You should see your posts and metrics populating.

## AI Coach (Optional)

The AI Coach analyzes your posting patterns and generates actionable recommendations. To enable it:

1. Get an API key from [OpenRouter](https://openrouter.ai/keys)
2. Create a `.env` file in the project root:
   ```
   TRUSTMIND_LLM_API_KEY=sk-or-...
   ```
3. Restart the server
4. Go to the **Coach** tab in the dashboard and click **Refresh AI**

The AI pipeline discovers your content taxonomy, classifies posts by topic and format, identifies engagement patterns, and generates prioritized recommendations with evidence. It tracks insights across runs so you can see which patterns are strengthening or fading over time.

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
# Run server in watch mode (auto-restarts on changes)
npm run dev

# Run dashboard dev server (hot reload on port 5173, proxies API to 3210)
cd dashboard && npm run dev

# Run tests
npm test
```

## Project Structure

```
├── server/           # Fastify API server
│   ├── src/
│   │   ├── ai/       # AI analysis pipeline, video transcription
│   │   ├── db/       # SQLite schema, migrations, queries
│   │   ├── routes/   # API endpoints
│   │   └── index.ts  # Server entrypoint
│   └── package.json
├── dashboard/        # React frontend (Vite + Tailwind)
│   ├── src/
│   │   ├── pages/    # Overview, Posts, Coach, Timing, Followers, Settings
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
└── docs/             # Design specs and research
```
