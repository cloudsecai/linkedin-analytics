import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type Database from "better-sqlite3";
import { updatePostTranscript } from "../db/queries.js";

const execFileAsync = promisify(execFile);

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 3000, 10000];

// Default model path — relative to server/data/models/
const DEFAULT_MODEL = "ggml-base.en.bin";

interface TranscriptionResult {
  postId: string;
  transcript: string | null;
  error?: string;
}

/**
 * Find the whisper-cli binary path.
 */
function findWhisperCli(): string | null {
  const candidates = [
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli",
    "whisper-cli",
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      // not found, try next
    }
  }
  return null;
}

/**
 * Download a video file with retry logic.
 */
async function downloadVideo(
  url: string,
  destPath: string
): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      fs.writeFileSync(destPath, Buffer.from(data));
      return;
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Extract audio from video using ffmpeg → WAV (16kHz mono, required by whisper).
 */
async function extractAudio(
  videoPath: string,
  audioPath: string
): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-ar", "16000",    // 16kHz sample rate (whisper requirement)
    "-ac", "1",         // mono
    "-c:a", "pcm_s16le", // 16-bit PCM WAV
    "-y",               // overwrite
    audioPath,
  ], { timeout: 120000 });
}

/**
 * Transcribe audio using whisper-cli.
 */
async function transcribeAudio(
  whisperPath: string,
  modelPath: string,
  audioPath: string
): Promise<string> {
  const { stdout } = await execFileAsync(whisperPath, [
    "-m", modelPath,
    "-f", audioPath,
    "--no-timestamps",
    "--threads", "4",
  ], { timeout: 300000 }); // 5 minute timeout for long videos

  return stdout.trim();
}

/**
 * Get video posts that need transcription:
 * - content_type = 'video'
 * - have a video_url
 * - full_text is just the hook text (short) or null
 */
export function getPostsNeedingTranscription(
  db: Database.Database
): { id: string; video_url: string; hook_text: string | null }[] {
  return db
    .prepare(
      `SELECT id, video_url, hook_text FROM posts
       WHERE content_type = 'video'
         AND video_url IS NOT NULL
         AND (full_text IS NULL OR full_text = hook_text OR length(full_text) < 100)
       ORDER BY published_at DESC`
    )
    .all() as { id: string; video_url: string; hook_text: string | null }[];
}

/**
 * Transcribe a single video post: download → extract audio → whisper → update DB.
 */
export async function transcribePost(
  db: Database.Database,
  postId: string,
  videoUrl: string,
  dataDir: string,
  modelPath?: string
): Promise<TranscriptionResult> {
  const whisperCli = findWhisperCli();
  if (!whisperCli) {
    return { postId, transcript: null, error: "whisper-cli not found. Install with: brew install whisper-cpp" };
  }

  const resolvedModel = modelPath || path.join(dataDir, "models", DEFAULT_MODEL);
  if (!fs.existsSync(resolvedModel)) {
    return { postId, transcript: null, error: `Whisper model not found at ${resolvedModel}` };
  }

  const tmpDir = path.join(dataDir, "tmp-video");
  fs.mkdirSync(tmpDir, { recursive: true });

  const videoPath = path.join(tmpDir, `${postId}.mp4`);
  const audioPath = path.join(tmpDir, `${postId}.wav`);

  try {
    const isDash = videoUrl.includes("/playlist/vid/");

    if (isDash) {
      // DASH stream: ffmpeg downloads and extracts audio directly from the manifest URL
      console.log(`[Transcribe] Downloading DASH stream and extracting audio for post ${postId}...`);
      await execFileAsync("ffmpeg", [
        "-i", videoUrl,
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        "-y",
        audioPath,
      ], { timeout: 120000 });
    } else {
      // Direct video file: download then extract
      console.log(`[Transcribe] Downloading video for post ${postId}...`);
      await downloadVideo(videoUrl, videoPath);

      console.log(`[Transcribe] Extracting audio...`);
      await extractAudio(videoPath, audioPath);
    }

    // Step 3: Transcribe
    console.log(`[Transcribe] Running whisper...`);
    const transcript = await transcribeAudio(whisperCli, resolvedModel, audioPath);

    if (!transcript) {
      return { postId, transcript: null, error: "Whisper produced empty transcript" };
    }

    // Step 4: Update post full_text with transcript
    updatePostTranscript(db, postId, transcript);

    console.log(`[Transcribe] Post ${postId}: ${transcript.length} chars transcribed`);
    return { postId, transcript };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Transcribe] Failed for post ${postId}: ${msg}`);
    return { postId, transcript: null, error: msg };
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(videoPath); } catch {}
    try { fs.unlinkSync(audioPath); } catch {}
  }
}

/**
 * Transcribe all video posts that need it.
 */
export async function transcribeAllPending(
  db: Database.Database,
  dataDir: string
): Promise<TranscriptionResult[]> {
  const posts = getPostsNeedingTranscription(db);
  if (posts.length === 0) {
    console.log("[Transcribe] No video posts need transcription");
    return [];
  }

  console.log(`[Transcribe] ${posts.length} video post(s) need transcription`);
  const results: TranscriptionResult[] = [];

  for (const post of posts) {
    const result = await transcribePost(db, post.id, post.video_url, dataDir);
    results.push(result);
  }

  return results;
}
