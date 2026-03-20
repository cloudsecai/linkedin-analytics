/**
 * Auto-discovers RSS/Atom feed URLs from a website URL.
 * User pastes "krebsonsecurity.com" → we find the feed.
 */

const DISCOVER_TIMEOUT_MS = 8000;

export interface DiscoveredFeed {
  feed_url: string;
  title: string;
}

/** Try to find RSS/Atom feeds from a website URL */
export async function discoverFeeds(siteUrl: string): Promise<DiscoveredFeed[]> {
  const normalized = normalizeUrl(siteUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVER_TIMEOUT_MS);

  try {
    const response = await fetch(normalized, {
      signal: controller.signal,
      headers: { "User-Agent": "ReachLab/1.0 Feed Discoverer" },
      redirect: "follow",
    });
    if (!response.ok) return [];

    const contentType = response.headers.get("content-type") ?? "";

    // If the URL itself is a feed, return it directly
    if (contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom")) {
      const text = await response.text();
      const title = extractFeedTitle(text);
      return [{ feed_url: normalized, title: title || hostnameLabel(normalized) }];
    }

    // Otherwise parse HTML for <link> tags pointing to feeds
    const html = await response.text();
    return extractFeedLinks(html, normalized);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Try common feed paths as fallback */
export async function discoverFeedsByGuessing(siteUrl: string): Promise<DiscoveredFeed[]> {
  const base = normalizeUrl(siteUrl).replace(/\/$/, "");
  const candidates = [
    `${base}/feed`,
    `${base}/feed/`,
    `${base}/rss`,
    `${base}/rss.xml`,
    `${base}/atom.xml`,
    `${base}/index.xml`,
    `${base}/feed.xml`,
  ];

  for (const url of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "ReachLab/1.0 Feed Discoverer" },
        redirect: "follow",
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "";
      const text = await res.text();
      if (ct.includes("xml") || ct.includes("rss") || ct.includes("atom") || text.trimStart().startsWith("<?xml") || text.trimStart().startsWith("<rss") || text.trimStart().startsWith("<feed")) {
        const title = extractFeedTitle(text);
        return [{ feed_url: url, title: title || hostnameLabel(url) }];
      }
    } catch {
      clearTimeout(timeout);
    }
  }
  return [];
}

// ── Helpers ────────────────────────────────────────────────

function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  return url;
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractFeedLinks(html: string, baseUrl: string): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];
  // Match <link> tags with rel="alternate" and type containing rss/atom
  const linkRegex = /<link[^>]*rel=["']alternate["'][^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    const typeMatch = tag.match(/type=["']([^"']+)["']/);
    if (!typeMatch) continue;
    const type = typeMatch[1].toLowerCase();
    if (!type.includes("rss") && !type.includes("atom") && !type.includes("xml")) continue;

    const hrefMatch = tag.match(/href=["']([^"']+)["']/);
    if (!hrefMatch) continue;

    let feedUrl = hrefMatch[1];
    // Resolve relative URLs
    if (feedUrl.startsWith("/")) {
      try {
        const base = new URL(baseUrl);
        feedUrl = `${base.origin}${feedUrl}`;
      } catch { continue; }
    }

    const titleMatch = tag.match(/title=["']([^"']+)["']/);
    feeds.push({
      feed_url: feedUrl,
      title: titleMatch?.[1] || hostnameLabel(baseUrl),
    });
  }
  return feeds;
}

function extractFeedTitle(xml: string): string {
  const titleMatch = xml.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch?.[1]?.trim() ?? "";
}
