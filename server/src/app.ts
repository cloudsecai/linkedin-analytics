import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { initDatabase } from "./db/index.js";
import {
  upsertPost,
  insertPostMetrics,
  upsertFollowerSnapshot,
  upsertProfileSnapshot,
  upsertCommentStats,
  logScrape,
  postExists,
  queryPosts,
  queryMetrics,
  queryOverview,
  queryTiming,
  queryFollowers,
  queryProfile,
  queryHealth,
  getPostIdsNeedingMetrics,
} from "./db/queries.js";
import { ingestPayloadSchema } from "./schemas.js";
import multipart from "@fastify/multipart";
import { registerInsightsRoutes } from "./routes/insights.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerGenerateRoutes } from "./routes/generate.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerPersonaRoutes } from "./routes/personas.js";

function getPersonaId(request: any): number {
  const params = request.params as any;
  return params.personaId ? Number(params.personaId) : 1;
}

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
      const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(`last_sync_at:${personaId}`) as { value: string } | undefined;
      return { last_sync_at: row?.value ? Number(row.value) : null };
    });

    app.put(`${prefix}/sync-state`, async (request) => {
      const personaId = getPersonaId(request);
      const body = request.body as { last_sync_at: number };
      const key = `last_sync_at:${personaId}`;
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP")
        .run(key, String(body.last_sync_at), String(body.last_sync_at));
      return { ok: true };
    });

    // Ingest
    app.post(`${prefix}/ingest`, async (request, reply) => {
      const personaId = getPersonaId(request);
      const parseResult = ingestPayloadSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          ok: false,
          error: parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
        });
      }

      const payload = parseResult.data;
      let postsUpserted = 0;
      let metricsInserted = 0;
      const errors: string[] = [];

      let postsStatus = "pending";
      let followersStatus = "pending";
      let profileStatus = "pending";

      // Upsert posts
      if (payload.posts) {
        try {
          for (const post of payload.posts) {
            upsertPost(db, personaId, post);
            postsUpserted++;
            // Persist comment stats if present
            if (post.author_replies != null || post.has_threads != null) {
              upsertCommentStats(
                db,
                post.id,
                post.author_replies ?? 0,
                post.has_threads ?? false
              );
            }
          }
          postsStatus = "success";
        } catch (e: any) {
          postsStatus = "error";
          errors.push(`Posts upsert failed: ${e.message}`);
        }
      }

      // Insert metrics
      if (payload.post_metrics) {
        if (postsStatus === "pending") postsStatus = "success";
        for (const m of payload.post_metrics) {
          if (!postExists(db, m.post_id)) {
            errors.push(`Post ${m.post_id} does not exist, skipping metrics`);
            continue;
          }
          try {
            insertPostMetrics(db, m);
            metricsInserted++;
          } catch (e: any) {
            errors.push(`Metrics insert failed for ${m.post_id}: ${e.message}`);
          }
        }
        if (metricsInserted === 0 && payload.post_metrics.length > 0) {
          postsStatus = "error";
        }
      }

      // Followers
      if (payload.followers) {
        try {
          upsertFollowerSnapshot(db, personaId, payload.followers.total_followers);
          followersStatus = "success";
        } catch (e: any) {
          followersStatus = "error";
          errors.push(`Followers failed: ${e.message}`);
        }
      }

      // Profile
      if (payload.profile) {
        try {
          upsertProfileSnapshot(db, personaId, payload.profile);
          profileStatus = "success";
        } catch (e: any) {
          profileStatus = "error";
          errors.push(`Profile failed: ${e.message}`);
        }
      }

      // Log the scrape
      const errorDetails: Record<string, string> = {};
      if (errors.length > 0) {
        errorDetails.details = errors.join("; ");
      }

      logScrape(db, personaId, {
        posts_status: postsStatus,
        followers_status: followersStatus,
        profile_status: profileStatus,
        posts_count: postsUpserted,
        error_details: errors.length > 0 ? JSON.stringify(errorDetails) : null,
      });

      // Sync health check: detect post count anomalies
      // Only check when post_metrics are also present (full sync), not partial content updates
      if (payload.posts && payload.posts.length > 0 && payload.post_metrics && payload.post_metrics.length > 0) {
        const avgRow = db
          .prepare(
            `SELECT AVG(posts_count) as avg_count FROM (
               SELECT posts_count FROM scrape_log
               WHERE posts_count > 0 AND persona_id = ?
               ORDER BY id DESC LIMIT 10
             )`
          )
          .get(personaId) as { avg_count: number | null };

        const syncWarningKey = `sync_warning:${personaId}`;
        if (avgRow.avg_count && payload.posts.length < avgRow.avg_count * 0.3) {
          const warning = `Post count anomaly: got ${payload.posts.length}, expected ~${Math.round(avgRow.avg_count)}. LinkedIn may have changed their page structure.`;
          console.warn(`[Sync Health] ${warning}`);
          db.prepare(
            `INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
          ).run(syncWarningKey, JSON.stringify({
            message: warning,
            detected_at: new Date().toISOString(),
            expected: Math.round(avgRow.avg_count),
            actual: payload.posts.length,
          }));
        } else {
          // Clear warning if count looks normal
          db.prepare("DELETE FROM settings WHERE key = ?").run(syncWarningKey);
        }
      }

      // Staleness detection: newest scraped post shouldn't be much older than expected
      if (payload.posts && payload.posts.length > 0) {
        const postsWithDate = payload.posts.filter((p): p is typeof p & { published_at: string } => !!p.published_at);
        const syncStaleWarningKey = `sync_stale_warning:${personaId}`;
        if (postsWithDate.length === 0) {
          db.prepare("DELETE FROM settings WHERE key = ?").run(syncStaleWarningKey);
        } else {
        const newestPost = postsWithDate.reduce((a, b) =>
          new Date(a.published_at) > new Date(b.published_at) ? a : b
        );
        const newestAge = Date.now() - new Date(newestPost.published_at).getTime();
        const twoDaysMs = 48 * 60 * 60 * 1000;

        // Check average posting frequency from DB
        const freqRow = db
          .prepare(
            `SELECT COUNT(*) as count FROM posts
             WHERE published_at > datetime('now', '-30 days') AND persona_id = ?`
          )
          .get(personaId) as { count: number };

        // If user posts frequently (>2/week) but newest scraped post is >48h old, warn
        if (freqRow.count >= 8 && newestAge > twoDaysMs) {
          const warning = `Stale sync: newest scraped post is ${Math.round(newestAge / 3600000)}h old, but you typically post ${freqRow.count} times/month. A recent post may be missing.`;
          console.warn(`[Sync Health] ${warning}`);
          db.prepare(
            `INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
          ).run(syncStaleWarningKey, JSON.stringify({
            message: warning,
            detected_at: new Date().toISOString(),
            newest_post_age_hours: Math.round(newestAge / 3600000),
          }));
        } else {
          db.prepare("DELETE FROM settings WHERE key = ?").run(syncStaleWarningKey);
        }
        } // end else (postsWithDate.length > 0)
      }

      // Auto-download author profile photo if provided
      if (payload.author_photo_url) {
        const photoDir = path.dirname(dbPath);
        const photoPath = path.join(photoDir, "author-reference.jpg");
        // Only download if we don't already have one
        if (!fs.existsSync(photoPath)) {
          fetch(payload.author_photo_url)
            .then(async (res) => {
              if (!res.ok) return;
              const buffer = Buffer.from(await res.arrayBuffer());
              if (buffer.length > 0) {
                fs.mkdirSync(photoDir, { recursive: true });
                fs.writeFileSync(photoPath, buffer);
                console.log("[Author Photo] Downloaded profile photo from LinkedIn");
              }
            })
            .catch((err: any) => {
              console.error("[Author Photo] Download failed:", err.message);
            });
        }
      }

      // Auto-trigger image downloads for posts with image_urls
      if (payload.posts) {
        const postsWithImages = payload.posts.filter(
          (p) => p.image_urls && p.image_urls.length > 0
        );
        if (postsWithImages.length > 0) {
          // Fire and forget — don't block the response
          import("./ai/image-downloader.js").then(({ downloadPostImages }) => {
            const dataDir = path.join(path.dirname(dbPath), "images");
            for (const post of postsWithImages) {
              // Check if already downloaded
              const existing = db
                .prepare("SELECT image_local_paths FROM posts WHERE id = ?")
                .get(post.id) as { image_local_paths: string | null } | undefined;
              if (existing?.image_local_paths) continue;

              downloadPostImages(post.id, post.image_urls!, dataDir).then((paths) => {
                if (paths.length > 0) {
                  db.prepare("UPDATE posts SET image_local_paths = ? WHERE id = ?").run(
                    JSON.stringify(paths),
                    post.id
                  );
                }
              }).catch((err: any) => {
                console.error(`[Image Download] Failed for ${post.id}:`, err.message);
              });
            }
          }).catch(() => {});
        }
      }

      // Auto-trigger video transcription for video posts with URLs
      if (payload.posts?.some((p) => p.video_url)) {
        import("./ai/video-transcriber.js").then(({ transcribeAllPending }) => {
          const dataDir = path.dirname(dbPath);
          transcribeAllPending(db, dataDir).catch((err: any) => {
            console.error("[Transcribe] Auto-transcription failed:", err.message);
          });
        }).catch(() => {});
      }

      // Auto-trigger AI pipeline (two-tier)
      const aiApiKey = process.env.TRUSTMIND_LLM_API_KEY;
      if (aiApiKey) {
        Promise.all([
          import("./ai/orchestrator.js"),
          import("./db/ai-queries.js"),
          import("./ai/client.js"),
        ]).then(([{ runTaggingPipeline, runFullPipeline }, { getPostCountWithMetrics, getLatestCompletedRun, getRunningRun, getSetting, getUntaggedPostIds }, { createClient }]) => {
          // Skip if nothing to do: no new posts upserted AND no untagged posts
          const untaggedIds = getUntaggedPostIds(db, personaId);
          if (postsUpserted === 0 && untaggedIds.length === 0) return;
          if (getRunningRun(db, personaId)) return;
          const postCount = getPostCountWithMetrics(db, personaId);
          if (postCount < 10) return;

          const client = createClient(aiApiKey);

          // Always run cheap tagging pipeline on sync
          runTaggingPipeline(client, db, personaId, "sync_tagging").then(() => {
            // After tagging, check if full interpretation should run
            const schedule = getSetting(db, "auto_interpret_schedule") ?? "weekly";
            if (schedule === "off") return;

            // Only consider full pipeline runs (not tagging-only)
            const lastFullRun = db.prepare(
              "SELECT id, post_count, completed_at FROM ai_runs WHERE status = 'completed' AND triggered_by NOT LIKE '%tagging%' AND persona_id = ? ORDER BY id DESC LIMIT 1"
            ).get(personaId) as { id: number; post_count: number; completed_at: string } | undefined;

            const newPosts = lastFullRun ? postCount - lastFullRun.post_count : postCount;
            if (newPosts < 1) return; // No new posts, skip

            // Check post threshold
            const postThreshold = parseInt(getSetting(db, "auto_interpret_post_threshold") ?? "5", 10);
            const postThresholdMet = newPosts >= postThreshold;

            // Check time threshold
            let timeThresholdMet = !lastFullRun; // Always run if never run before
            if (lastFullRun && schedule !== "off") {
              const lastRunTime = new Date(lastFullRun.completed_at + "Z").getTime();
              const now = Date.now();
              const msPerDay = 86400000;
              const interval = schedule === "daily" ? msPerDay : 7 * msPerDay;
              timeThresholdMet = (now - lastRunTime) >= interval;
            }

            if (postThresholdMet || timeThresholdMet) {
              runFullPipeline(client, db, personaId, "auto").catch((err: any) => {
                console.error("[AI Pipeline] Auto-trigger failed:", err.message);
              });
            }
          }).catch((err: any) => {
            console.error("[AI Pipeline] Auto-trigger failed:", err.message);
          });
        }).catch(() => {});
      }

    // Auto-retro: match new posts with full_text to existing drafts
    if (aiApiKey && payload.posts) {
      const postsWithText = payload.posts.filter((p) => p.full_text);
      if (postsWithText.length > 0) {
        Promise.all([
          import("./ai/auto-retro.js"),
          import("./ai/client.js"),
        ])
          .then(([{ runAutoRetro }, { createClient }]) => {
            const client = createClient(aiApiKey);
            runAutoRetro(
              client,
              db,
              personaId,
              postsWithText.map((p) => p.id)
            ).catch((err: any) => {
              console.error("[Auto-Retro] Failed:", err.message);
            });
          })
          .catch(() => {});
      }
    }

      // Include posts needing scraping so the extension doesn't need separate API calls
      const needsContent = payload.posts
        ? (db.prepare("SELECT id FROM posts WHERE full_text IS NULL AND persona_id = ? ORDER BY published_at DESC").all(personaId) as { id: string }[]).map(r => r.id)
        : undefined;
      const needsImages = payload.posts
        ? (db.prepare(
            `SELECT id FROM posts
             WHERE persona_id = ?
               AND content_type IN ('image', 'carousel')
               AND (image_local_paths IS NULL OR image_local_paths = '[]')
               AND (image_urls IS NULL OR image_urls = '[]')
             ORDER BY published_at DESC`
          ).all(personaId) as { id: string }[]).map(r => r.id)
        : undefined;
      const needsVideoUrl = payload.posts
        ? (db.prepare(
            `SELECT id FROM posts
             WHERE persona_id = ?
               AND content_type = 'video' AND video_url IS NULL
             ORDER BY published_at DESC`
          ).all(personaId) as { id: string }[]).map(r => r.id)
        : undefined;
      // Posts that have recent metrics (scraped within last 12 hours)
      const hasRecentMetrics = payload.posts
        ? (db.prepare(
            `SELECT DISTINCT pm.post_id FROM post_metrics pm
             JOIN posts p ON p.id = pm.post_id
             WHERE pm.scraped_at > datetime('now', '-12 hours')
               AND p.persona_id = ?`
          ).all(personaId) as { post_id: string }[]).map(r => r.post_id)
        : undefined;
      // Recent posts that have never had metrics scraped (not on top-posts page)
      // Scoped to last 14 days — after that, stats rarely increment
      const needsMetrics = payload.posts
        ? getPostIdsNeedingMetrics(db, personaId)
        : undefined;

      return {
        ok: true,
        posts_upserted: postsUpserted,
        metrics_inserted: metricsInserted,
        ...(errors.length > 0 ? { errors } : {}),
        ...(needsContent ? { needs_content: needsContent } : {}),
        ...(needsImages ? { needs_images: needsImages } : {}),
        ...(needsVideoUrl ? { needs_video_url: needsVideoUrl } : {}),
        ...(hasRecentMetrics ? { has_recent_metrics: hasRecentMetrics } : {}),
        ...(needsMetrics ? { needs_metrics: needsMetrics } : {}),
      };
    });

    // Serve post images
    app.get(`${prefix}/images/:postId/:index`, async (request, reply) => {
      const { postId, index } = request.params as { postId: string; index: string };

      // Validate params to prevent path traversal
      if (!/^[\w:.-]+$/.test(postId) || !/^\d+$/.test(index)) {
        return reply.status(400).send({ error: "Invalid path" });
      }

      const dataDir = path.resolve(path.dirname(dbPath), "images");
      const imagePath = path.resolve(dataDir, postId, `${index}.jpg`);

      // Containment check
      if (!imagePath.startsWith(dataDir + path.sep)) {
        return reply.status(400).send({ error: "Invalid path" });
      }

      if (!fs.existsSync(imagePath)) {
        return reply.status(404).send({ error: "Image not found" });
      }

      return reply.type("image/jpeg").send(fs.readFileSync(imagePath));
    });

    // Posts needing content scraping
    app.get(`${prefix}/posts/needs-content`, async (request) => {
      const personaId = getPersonaId(request);
      const rows = db
        .prepare("SELECT id FROM posts WHERE full_text IS NULL AND persona_id = ? ORDER BY published_at DESC")
        .all(personaId) as { id: string }[];
      return { post_ids: rows.map((r) => r.id) };
    });

    // Posts needing image scraping (visual content types with no downloaded images AND no URLs yet)
    app.get(`${prefix}/posts/needs-images`, async (request) => {
      const personaId = getPersonaId(request);
      const rows = db
        .prepare(
          `SELECT id FROM posts
           WHERE persona_id = ?
             AND content_type IN ('image', 'carousel')
             AND (image_local_paths IS NULL OR image_local_paths = '[]')
             AND (image_urls IS NULL OR image_urls = '[]')
           ORDER BY published_at DESC`
        )
        .all(personaId) as { id: string }[];
      return { post_ids: rows.map((r) => r.id) };
    });

    // Video posts needing video URL scraping
    app.get(`${prefix}/posts/needs-video-url`, async (request) => {
      const personaId = getPersonaId(request);
      const rows = db
        .prepare(
          `SELECT id FROM posts
           WHERE persona_id = ?
             AND content_type = 'video'
             AND video_url IS NULL
           ORDER BY published_at DESC`
        )
        .all(personaId) as { id: string }[];
      return { post_ids: rows.map((r) => r.id) };
    });

    // Recent posts that have never had metrics scraped (debugging/future use)
    app.get(`${prefix}/posts/needs-metrics`, async (request) => {
      const personaId = getPersonaId(request);
      return { post_ids: getPostIdsNeedingMetrics(db, personaId) };
    });

    // Top-performing posts (excluding announcements)
    app.get(`${prefix}/posts/top-examples`, async (request) => {
      const personaId = getPersonaId(request);
      const q = request.query as any;
      const limit = q.limit ? Number(q.limit) : 10;

      const rows = db
        .prepare(
          `SELECT p.id, p.full_text, p.published_at, p.content_type,
            m.impressions, m.reactions, m.comments, m.reposts,
            CASE WHEN m.impressions > 0
              THEN CAST(COALESCE(m.reactions, 0) + COALESCE(m.comments, 0) + COALESCE(m.reposts, 0) AS REAL) / m.impressions
              ELSE NULL
            END AS engagement_rate
          FROM posts p
          LEFT JOIN post_metrics m ON m.post_id = p.id
            AND m.id = (SELECT MAX(id) FROM post_metrics WHERE post_id = p.id)
          LEFT JOIN ai_tags t ON t.post_id = p.id
          WHERE p.persona_id = ?
            AND p.full_text IS NOT NULL
            AND LENGTH(p.full_text) >= 200
            AND m.impressions IS NOT NULL
            AND (t.post_category IS NULL OR t.post_category != 'announcement')
          ORDER BY m.impressions DESC
          LIMIT ?`
        )
        .all(personaId, limit) as any[];

      return { posts: rows };
    });

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
    const postsNeedingDownload = db
      .prepare(
        `SELECT id, image_urls FROM posts
         WHERE image_urls IS NOT NULL AND image_urls != '[]'
           AND (image_local_paths IS NULL OR image_local_paths = '[]')`
      )
      .all() as { id: string; image_urls: string }[];

    if (postsNeedingDownload.length > 0) {
      console.log(`[Image Download] Retrying downloads for ${postsNeedingDownload.length} posts...`);
      import("./ai/image-downloader.js").then(({ downloadPostImages }) => {
        const imagesDir = path.join(path.dirname(dbPath), "images");
        for (const post of postsNeedingDownload) {
          const urls = JSON.parse(post.image_urls) as string[];
          downloadPostImages(post.id, urls, imagesDir).then((paths) => {
            if (paths.length > 0) {
              db.prepare("UPDATE posts SET image_local_paths = ? WHERE id = ?").run(
                JSON.stringify(paths),
                post.id
              );
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
