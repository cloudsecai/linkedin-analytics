import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  getAuthorProfile,
  upsertAuthorProfile,
  insertProfileInterview,
  getProfileInterviews,
  incrementInterviewCount,
} from "../db/profile-queries.js";
import { getPersonaId } from "../utils.js";

export function registerProfileRoutes(app: FastifyInstance, db: Database.Database): void {
  // Get current profile
  app.get("/api/author-profile", async (request) => {
    const personaId = getPersonaId(request);
    const profile = getAuthorProfile(db, personaId);
    return {
      profile_text: profile?.profile_text ?? "",
      profile_json: profile?.profile_json ? JSON.parse(profile.profile_json) : {},
      interview_count: profile?.interview_count ?? 0,
    };
  });

  // Update profile (manual edit)
  app.put("/api/author-profile", async (request) => {
    const personaId = getPersonaId(request);
    const { profile_text, profile_json } = request.body as {
      profile_text: string;
      profile_json?: Record<string, any>;
    };
    upsertAuthorProfile(db, personaId, {
      profile_text,
      profile_json: profile_json ? JSON.stringify(profile_json) : undefined,
    });
    return { ok: true };
  });

  // Create interview session (returns ephemeral token for OpenAI Realtime)
  app.post("/api/author-profile/interview/session", async (request, reply) => {
    const personaId = getPersonaId(request);
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return reply.status(422).send({ error: "OPENAI_API_KEY is not configured. Add OPENAI_API_KEY=sk-... to your server/.env file and restart the server." });
    }

    const existingProfile = getAuthorProfile(db, personaId);

    // Build the interviewer system prompt
    const { buildInterviewerPrompt } = await import("../ai/interviewer-prompt.js");
    const personalizedInstructions = buildInterviewerPrompt(existingProfile?.profile_text);

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
          output_modalities: ["audio"],
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                silence_duration_ms: 500,
              },
            },
            output: {
              voice: "shimmer",
              speed: 1.3,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[Interview] OpenAI session creation failed:", err);
      return reply.status(500).send({ error: `OpenAI session creation failed: ${err}` });
    }

    const data = await response.json();
    console.log("[Interview] Session created successfully");
    return { client_secret: data.client_secret?.value ?? data.value, model: "gpt-realtime" };
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

    const { createClient } = await import("../ai/client.js");
    const client = createClient(apiKey);

    const { extractProfile } = await import("../ai/profile-extractor.js");
    const result = await extractProfile(client, transcript);

    const personaId = getPersonaId(request);

    // Save interview record
    insertProfileInterview(db, personaId, {
      transcript_json: transcript,
      extracted_profile: JSON.stringify(result),
      duration_seconds,
    });

    // Update profile
    upsertAuthorProfile(db, personaId, {
      profile_text: result.profile_text,
      profile_json: JSON.stringify(result.profile_json),
    });
    incrementInterviewCount(db, personaId);

    return result;
  });

  // Get interview history
  app.get("/api/author-profile/interviews", async (request) => {
    const personaId = getPersonaId(request);
    const interviews = getProfileInterviews(db, personaId);
    return { interviews };
  });
}
