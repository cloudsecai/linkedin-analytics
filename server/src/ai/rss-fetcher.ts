import type Database from "better-sqlite3";
import Parser from "rss-parser";

export interface RssItem {
  title: string;
  link: string;
  summary: string;
  pubDate: Date;
  sourceName?: string;
}

export interface RssSource {
  id: number;
  name: string;
  feed_url: string;
  source_type: string;
  enabled: number;
}

const FEED_TIMEOUT_MS = 5000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function parseRssItems(xml: string): Promise<RssItem[]> {
  const parser = new Parser();
  const feed = await parser.parseString(xml);
  return (feed.items ?? []).map((item) => ({
    title: item.title ?? "",
    link: item.link ?? "",
    summary: (item.contentSnippet ?? item.content ?? item.summary ?? "").substring(0, 500),
    pubDate: item.pubDate ? new Date(item.pubDate) : new Date(0),
  }));
}

export function filterToThisWeek(items: RssItem[]): RssItem[] {
  const cutoff = Date.now() - ONE_WEEK_MS;
  return items.filter((item) => item.pubDate.getTime() > cutoff);
}

async function fetchFeed(url: string, sourceName: string): Promise<RssItem[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      console.warn(`[rss-fetcher] ${sourceName}: HTTP ${response.status}`);
      return [];
    }
    const xml = await response.text();
    const items = await parseRssItems(xml);
    return items.map((item) => ({ ...item, sourceName }));
  } catch (err: any) {
    console.warn(`[rss-fetcher] ${sourceName}: ${err.message}`);
    return [];
  }
}

export function getEnabledSources(db: Database.Database): RssSource[] {
  return db
    .prepare("SELECT * FROM research_sources WHERE enabled = 1")
    .all() as RssSource[];
}

export async function fetchAllFeeds(db: Database.Database): Promise<RssItem[]> {
  const sources = getEnabledSources(db);
  if (sources.length === 0) {
    throw new Error("No RSS sources configured");
  }
  const results = await Promise.all(
    sources.map((source) => fetchFeed(source.feed_url, source.name))
  );
  const allItems = results.flat();
  if (allItems.length === 0) {
    throw new Error("All RSS feeds failed or returned no items");
  }
  const recentItems = filterToThisWeek(allItems);
  if (recentItems.length === 0) {
    throw new Error("No stories found from the past week");
  }
  return recentItems;
}
