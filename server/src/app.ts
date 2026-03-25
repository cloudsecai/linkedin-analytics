import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { initDatabase } from "./db/index.js";
import {
  postExists,
  queryPosts,
  queryMetrics,
  queryOverview,
  queryTiming,
  queryFollowers,
  queryProfile,
  queryHealth,
  getPostsNeedingImageDownload,
  setImageLocalPaths,
} from "./db/queries.js";
import { getSetting, upsertSetting } from "./db/ai-queries.js";
import multipart from "@fastify/multipart";
import { registerInsightsRoutes } from "./routes/insights.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerGenerateRoutes } from "./routes/generate.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerPersonaRoutes } from "./routes/personas.js";
import { registerIngestRoutes } from "./routes/ingest.js";

import { getPersonaId } from "./utils.js";

export function buildApp(dbPath: string) {
  const app = Fastify({ logger: false });
  const db = initDatabase(dbPath);

  app.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        origin.startsWith("chrome-extension://") ||
        origin.startsWith("http://localhost")
      ) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
  });

  app.addHook("onClose", () => {
    db.close();
  });

  // Register scoped routes under both persona-specific and backward-compat prefixes
  function registerScopedRoutes(prefix: string) {
    // Health
    app.get(`${prefix}/health`, async (request) => {
      const personaId = getPersonaId(request);
      return queryHealth(db, personaId);
    });

    // Sync state — stored server-side so extension reinstalls don't trigger full re-scrape
    app.get(`${prefix}/sync-state`, async (request) => {
      const personaId = getPersonaId(request);
      const value = getSetting(db, `last_sync_at:${personaId}`);
      return { last_sync_at: value ? Number(value) : null };
    });

    app.put(`${prefix}/sync-state`, async (request) => {
      const personaId = getPersonaId(request);
      const body = request.body as { last_sync_at: number };
      upsertSetting(db, `last_sync_at:${personaId}`, String(body.last_sync_at));
      return { ok: true };
    });

    // Ingest, images, and extension helper endpoints
    registerIngestRoutes(app, db, prefix, dbPath);

    // Posts
    app.get(`${prefix}/posts`, async (request) => {
      const personaId = getPersonaId(request);
      const q = request.query as any;
      return queryPosts(db, personaId, {
        content_type: q.content_type,
        since: q.since,
        until: q.until,
        min_impressions: q.min_impressions != null ? Number(q.min_impressions) : undefined,
        sort_by: q.sort_by,
        sort_order: q.sort_order,
        offset: q.offset ? Number(q.offset) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
      });
    });

    // Metrics for a single post
    app.get(`${prefix}/metrics/:postId`, async (request, reply) => {
      const { postId } = request.params as { postId: string };
      if (!postExists(db, postId)) {
        return reply.status(404).send({ error: "Post not found" });
      }
      const metrics = queryMetrics(db, postId);
      return { post_id: postId, metrics };
    });

    // Overview KPIs
    app.get(`${prefix}/overview`, async (request) => {
      const personaId = getPersonaId(request);
      const q = request.query as any;
      return queryOverview(db, personaId, {
        since: q.since,
        until: q.until,
      });
    });

    // Timing heatmap
    app.get(`${prefix}/timing`, async (request) => {
      const personaId = getPersonaId(request);
      const slots = queryTiming(db, personaId);
      return { slots };
    });

    // Followers
    app.get(`${prefix}/followers`, async (request) => {
      const personaId = getPersonaId(request);
      const snapshots = queryFollowers(db, personaId);
      return { snapshots };
    });

    // Profile
    app.get(`${prefix}/profile`, async (request) => {
      const personaId = getPersonaId(request);
      const snapshots = queryProfile(db, personaId);
      return { snapshots };
    });
  }

  // Register routes for both persona-scoped and backward-compatible prefixes
  registerScopedRoutes("/api/personas/:personaId");
  registerScopedRoutes("/api");

  // AI Insights routes
  registerInsightsRoutes(app, db);

  // Settings routes (author photo upload/serve/delete)
  app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  app.addContentTypeParser(
    ["image/jpeg", "image/png"],
    { parseAs: "buffer" },
    (_req: any, body: Buffer, done: (err: null, body: Buffer) => void) => {
      done(null, body);
    }
  );
  const dataDir = path.dirname(dbPath);
  registerSettingsRoutes(app, dataDir, db);

  // Generation routes (post generation pipeline)
  registerGenerateRoutes(app, db);

  // Author profile routes (voice interview, profile extraction)
  registerProfileRoutes(app, db);

  // Persona management routes
  registerPersonaRoutes(app, db);

  // On startup, retry image downloads for posts that have URLs but no local files
  app.addHook("onReady", async () => {
    const postsNeedingDownload = getPostsNeedingImageDownload(db);

    if (postsNeedingDownload.length > 0) {
      console.log(`[Image Download] Retrying downloads for ${postsNeedingDownload.length} posts...`);
      import("./ai/image-downloader.js").then(({ downloadPostImages }) => {
        const imagesDir = path.join(path.dirname(dbPath), "images");
        for (const post of postsNeedingDownload) {
          const urls = JSON.parse(post.image_urls) as string[];
          downloadPostImages(post.id, urls, imagesDir).then((paths) => {
            if (paths.length > 0) {
              setImageLocalPaths(db, post.id, JSON.stringify(paths));
            }
          }).catch((err: any) => {
            console.error(`[Image Download] Retry failed for ${post.id}:`, err.message);
          });
        }
      }).catch(() => {});
    }

    // Also auto-transcribe any video posts that need it
    import("./ai/video-transcriber.js").then(({ transcribeAllPending }) => {
      transcribeAllPending(db, dataDir).catch((err: any) => {
        console.error("[Transcribe] Startup transcription failed:", err.message);
      });
    }).catch(() => {});
  });

  // Serve dashboard static files (production only — in dev, Vite handles this)
  if (process.env.NODE_ENV !== "development") {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const dashboardDir = path.join(__dirname, "../../dashboard/dist");
    if (fs.existsSync(dashboardDir)) {
      app.register(fastifyStatic, {
        root: dashboardDir,
        prefix: "/",
      });
      // SPA fallback — serve index.html for non-API routes
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith("/api/")) {
          return reply.status(404).send({ error: "Not found" });
        }
        return reply.sendFile("index.html");
      });
    }
  }

  return app;
}
