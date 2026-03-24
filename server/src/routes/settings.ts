import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getSetting,
  upsertSetting,
  saveWritingPromptHistory,
  getWritingPromptHistory,
} from "../db/ai-queries.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);

// Validate that a timezone string is recognized by Intl
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Keys users can configure through the UI
const CONFIGURABLE_KEYS: Record<string, { label: string; required: boolean; prefix: string; url: string }> = {
  TRUSTMIND_LLM_API_KEY: {
    label: "OpenRouter API Key",
    required: true,
    prefix: "sk-or-",
    url: "https://openrouter.ai/keys",
  },
  OPENAI_API_KEY: {
    label: "OpenAI API Key",
    required: false,
    prefix: "sk-",
    url: "https://platform.openai.com/api-keys",
  },
};

function getEnvPath(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.join(__dirname, "../.env");
}

function readEnvFile(): Map<string, string> {
  const envPath = getEnvPath();
  const entries = new Map<string, string>();
  if (!fs.existsSync(envPath)) return entries;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      entries.set(trimmed.slice(0, eqIdx).trim(), trimmed.slice(eqIdx + 1).trim());
    }
  }
  return entries;
}

function writeEnvFile(entries: Map<string, string>): void {
  const envPath = getEnvPath();
  const lines: string[] = [];
  for (const [key, value] of entries) {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(envPath, lines.join("\n") + "\n", "utf-8");
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  dataDir: string,
  db: Database.Database
): void {
  const photoPath = path.join(dataDir, "author-reference.jpg");

  // ── Author photo (unchanged) ───────────────────────────────

  app.get("/api/settings/author-photo", async (_request, reply) => {
    if (!fs.existsSync(photoPath)) {
      return reply.status(404).send({ error: "No author photo uploaded" });
    }
    return reply.type("image/jpeg").send(fs.readFileSync(photoPath));
  });

  app.post("/api/settings/author-photo", async (request, reply) => {
    const contentType = request.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file provided" });
      if (!ALLOWED_TYPES.has(data.mimetype))
        return reply.status(400).send({ error: "Only JPEG and PNG files are allowed" });
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (buffer.length > MAX_FILE_SIZE)
        return reply.status(400).send({ error: "File too large. Max 5MB." });
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(photoPath, buffer);
      return { ok: true };
    }
    if (!ALLOWED_TYPES.has(contentType.split(";")[0].trim()))
      return reply.status(400).send({ error: "Only JPEG and PNG files are allowed" });
    const body = request.body as Buffer;
    if (!body || body.length === 0)
      return reply.status(400).send({ error: "No file provided" });
    if (body.length > MAX_FILE_SIZE)
      return reply.status(400).send({ error: "File too large. Max 5MB." });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(photoPath, body);
    return { ok: true };
  });

  app.delete("/api/settings/author-photo", async () => {
    if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
    return { ok: true };
  });

  // ── Timezone ───────────────────────────────────────────────

  app.put("/api/settings/timezone", async (request, reply) => {
    const body = request.body as { timezone?: string };
    if (!body.timezone || typeof body.timezone !== "string") {
      return reply.status(400).send({ error: "timezone is required" });
    }
    if (!isValidTimezone(body.timezone)) {
      return reply.status(400).send({ error: "Invalid timezone" });
    }
    upsertSetting(db, "timezone", body.timezone);
    return { ok: true };
  });

  // ── Writing prompt ─────────────────────────────────────────

  app.get("/api/settings/writing-prompt", async () => {
    const text = getSetting(db, "writing_prompt");
    return { text: text ?? null };
  });

  app.put("/api/settings/writing-prompt", async (request, reply) => {
    const body = request.body as { text?: string; source?: string; evidence?: string };
    if (!body.text || typeof body.text !== "string") {
      return reply.status(400).send({ error: "text is required" });
    }
    const source = body.source ?? "manual_edit";
    upsertSetting(db, "writing_prompt", body.text);
    saveWritingPromptHistory(db, {
      prompt_text: body.text,
      source,
      evidence: body.evidence ?? null,
    });
    // Clear prompt suggestions so applied suggestions don't reappear
    if (source === "ai_suggestion") {
      db.prepare(
        `UPDATE ai_overview SET prompt_suggestions_json = NULL
         WHERE id = (SELECT MAX(id) FROM ai_overview)`
      ).run();
    }
    return { ok: true };
  });

  app.get("/api/settings/writing-prompt/history", async () => {
    return { history: getWritingPromptHistory(db) };
  });

  // ── Auto-refresh settings ────────────────────────────────

  app.get("/api/settings/auto-refresh", async () => {
    const schedule = getSetting(db, "auto_interpret_schedule") ?? "weekly";
    const postThreshold = getSetting(db, "auto_interpret_post_threshold") ?? "5";
    return { schedule, post_threshold: parseInt(postThreshold, 10) };
  });

  app.put("/api/settings/auto-refresh", async (request, reply) => {
    const body = request.body as {
      schedule?: string;
      post_threshold?: number;
    };

    if (body.schedule !== undefined) {
      if (!["daily", "weekly", "off"].includes(body.schedule)) {
        return reply.status(400).send({ error: "schedule must be daily, weekly, or off" });
      }
      upsertSetting(db, "auto_interpret_schedule", body.schedule);
    }

    if (body.post_threshold !== undefined) {
      const n = Math.max(1, Math.min(50, Math.round(body.post_threshold)));
      upsertSetting(db, "auto_interpret_post_threshold", String(n));
    }

    return { ok: true };
  });

  // ── Generic setting getter ──────────────────────────────

  app.get("/api/settings/kv/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const value = getSetting(db, key);
    if (value === undefined || value === null) {
      return reply.status(404).send({ error: "Setting not found" });
    }
    return { value };
  });

  const ALLOWED_KV_KEYS = new Set(["onboarding_complete"]);

  app.post("/api/settings/kv", async (request, reply) => {
    const { key, value } = request.body as { key: string; value: string };
    if (!key || typeof key !== "string" || !ALLOWED_KV_KEYS.has(key)) {
      return reply.status(400).send({ error: "Invalid setting key" });
    }
    if (typeof value !== "string" || value.length > 1000) {
      return reply.status(400).send({ error: "Invalid value" });
    }
    upsertSetting(db, key, value);
    return { ok: true };
  });

  // ── Sync health ──────────────────────────────────────────

  app.get("/api/settings/sync-health", async () => {
    const warning = getSetting(db, "sync_warning");
    const staleWarning = getSetting(db, "sync_stale_warning");
    return {
      warnings: [
        ...(warning ? [JSON.parse(warning)] : []),
        ...(staleWarning ? [JSON.parse(staleWarning)] : []),
      ],
    };
  });

  // ── API key configuration ─────────────────────────────────

  app.get("/api/config/keys", async () => {
    const keys = Object.entries(CONFIGURABLE_KEYS).map(([envName, meta]) => ({
      key: envName,
      label: meta.label,
      required: meta.required,
      configured: !!process.env[envName],
      prefix: meta.prefix,
      url: meta.url,
    }));
    return { keys };
  });

  app.post("/api/config/keys", async (request, reply) => {
    const { keys } = request.body as { keys: Record<string, string> };
    if (!keys || typeof keys !== "object") {
      return reply.status(400).send({ error: "keys object is required" });
    }

    // Validate all keys are in the allowlist
    for (const key of Object.keys(keys)) {
      if (!CONFIGURABLE_KEYS[key]) {
        return reply.status(400).send({ error: `Unknown key: ${key}` });
      }
      if (typeof keys[key] !== "string" || keys[key].length > 500) {
        return reply.status(400).send({ error: `Invalid value for ${key}` });
      }
    }

    // Read existing .env, merge new keys, write back
    const entries = readEnvFile();
    for (const [key, value] of Object.entries(keys)) {
      if (value.trim()) {
        entries.set(key, value.trim());
        process.env[key] = value.trim();
      }
    }
    writeEnvFile(entries);

    return { ok: true };
  });
}
