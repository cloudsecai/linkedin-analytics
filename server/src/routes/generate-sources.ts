import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { createDbClient } from "../db/client.js";
import { listSources, sourceExists, insertSource, getSource, updateSource, deleteSource, getTaxonomyNames } from "../db/source-queries.js";
import { createRun, completeRun, failRun, getRunCost, getSetting, upsertSetting } from "../db/ai-queries.js";
import { createClient } from "../ai/client.js";
import { AiLogger } from "../ai/logger.js";
import { discoverTopics } from "../ai/discovery.js";
import { discoverFeeds, discoverFeedsByGuessing } from "../ai/feed-discoverer.js";
import { getPersonaId } from "../utils.js";
import { validateBody } from "../validation.js";
import { sourceUrlBody, sourceUpdateBody, sourceDiscoverBody } from "../schemas/generate.js";

export function registerSourceRoutes(app: FastifyInstance, db: Database.Database): void {
  const dbc = createDbClient(db);
  // ── Discovery ──────────────────────────────────────────────

  app.post("/api/generate/discover", async (request, reply) => {
    const personaId = getPersonaId(request);
    const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
    if (!apiKey) throw new Error("TRUSTMIND_LLM_API_KEY is required");
    const client = createClient(apiKey);
    const runId = createRun(db, personaId, "generate_discover", 0);
    const logger = new AiLogger(db, runId);

    try {
      // Pass previously discovered topics so the LLM avoids repeating them
      const prevRaw = getSetting(db, "last_discovery_labels");
      const previousLabels = prevRaw ? JSON.parse(prevRaw) as string[] : [];

      const result = await discoverTopics(client, db, logger, previousLabels);

      // Store this round's labels for next time
      const allLabels = result.categories.flatMap(c => c.topics.map(t => t.label));
      upsertSetting(db, "last_discovery_labels", JSON.stringify(allLabels));

      completeRun(db, runId, getRunCost(db, runId));

      return result;
    } catch (err: any) {
      failRun(db, runId, err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Sources management ─────────────────────────────────

  app.get("/api/sources", async (request) => {
    const personaId = getPersonaId(request);
    return { sources: listSources(dbc, personaId) };
  });

  app.post("/api/sources", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { url } = validateBody(sourceUrlBody, request.body);

    // Auto-discover feeds from the URL
    let feeds = await discoverFeeds(url.trim());
    if (feeds.length === 0) {
      feeds = await discoverFeedsByGuessing(url.trim());
    }
    if (feeds.length === 0) {
      return reply.status(404).send({ error: "No feed found at that URL. Try a blog, newsletter, or news site." });
    }

    // Use the first discovered feed
    const feed = feeds[0];

    // Check for duplicate within this persona
    if (sourceExists(dbc, feed.feed_url, personaId)) {
      return reply.status(409).send({ error: "This source is already added." });
    }

    const sourceId = insertSource(dbc, feed.title, feed.feed_url, personaId);

    return {
      source: {
        id: sourceId,
        name: feed.title,
        feed_url: feed.feed_url,
        enabled: 1,
      },
    };
  });

  app.patch("/api/sources/:id", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { id } = request.params as { id: string };
    const { enabled, name } = validateBody(sourceUpdateBody, request.body);

    if (!getSource(dbc, Number(id), personaId)) {
      return reply.status(404).send({ error: "Source not found" });
    }

    updateSource(dbc, Number(id), personaId, { enabled, name });

    return { ok: true };
  });

  app.delete("/api/sources/:id", async (request, reply) => {
    const personaId = getPersonaId(request);
    const { id } = request.params as { id: string };
    if (!deleteSource(dbc, Number(id), personaId)) {
      return reply.status(404).send({ error: "Source not found" });
    }
    return { ok: true };
  });

  // ── Source Discovery ─────────────────────────────────────

  app.post("/api/sources/discover", async (request) => {
    const { topics } = validateBody(sourceDiscoverBody, request.body);

    // Fall back to taxonomy topics if none provided
    let topicList = topics;
    if (!topicList || topicList.length === 0) {
      topicList = getTaxonomyNames(dbc);
    }

    if (topicList.length === 0) {
      return { sources: [] };
    }

    const { discoverSources } = await import("../ai/source-discoverer.js");
    const sources = await discoverSources(topicList);
    return { sources };
  });
}
