/**
 * Discovers relevant news sources for a list of topics using Perplexity search,
 * then attempts to find RSS feeds for each discovered source.
 */

import { parseSonarResponse } from "./perplexity.js";
import { discoverFeeds, discoverFeedsByGuessing } from "./feed-discoverer.js";

export interface DiscoveredSource {
  name: string;
  url: string;
  feed_url: string | null;
  description: string;
}

/** Lightweight Sonar search without requiring AiLogger (no run context needed) */
async function searchSonar(prompt: string): Promise<string> {
  const apiKey = process.env.TRUSTMIND_LLM_API_KEY;
  if (!apiKey) {
    throw new Error("TRUSTMIND_LLM_API_KEY is required for source discovery");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "perplexity/sonar-pro",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Sonar API error: ${response.status}`);
    }

    const json = await response.json();
    const result = parseSonarResponse(json);
    return result.content;
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverSources(topics: string[]): Promise<DiscoveredSource[]> {
  const topicStr = topics.slice(0, 10).join(", ");

  const query = `Find 10-15 high-quality blogs, newsletters, and news sources that regularly publish about: ${topicStr}. For each, provide the name, URL, and a one-sentence description. Focus on individual expert blogs and niche publications, not generic news sites like CNN or BBC. Return as a JSON array with fields: name, url, description. Only return the JSON array, no other text.`;

  const content = await searchSonar(query);

  // Parse response to extract sources
  let sources: DiscoveredSource[] = [];
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      sources = parsed
        .map((s: any) => ({
          name: String(s.name || "").slice(0, 200),
          url: String(s.url || "").slice(0, 500),
          feed_url: null,
          description: String(s.description || "").slice(0, 500),
        }))
        .filter((s: DiscoveredSource) => s.name && s.url);
    }
  } catch {
    return [];
  }

  // Try to discover RSS feeds for each source in parallel
  await Promise.allSettled(
    sources.map(async (source) => {
      try {
        const feeds = await discoverFeeds(source.url);
        if (feeds.length > 0) {
          source.feed_url = feeds[0].feed_url;
        } else {
          const guessed = await discoverFeedsByGuessing(source.url);
          if (guessed.length > 0) {
            source.feed_url = guessed[0].feed_url;
          }
        }
      } catch {
        // Feed discovery is best-effort
      }
    })
  );

  return sources;
}
