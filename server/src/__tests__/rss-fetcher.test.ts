import { describe, it, expect } from "vitest";
import { parseRssItems, filterToThisWeek, type RssItem } from "../ai/rss-fetcher.js";

describe("filterToThisWeek", () => {
  it("keeps items from the past 7 days", () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const items: RssItem[] = [
      { title: "Recent", link: "https://example.com/1", summary: "s", pubDate: threeDaysAgo },
      { title: "Old", link: "https://example.com/2", summary: "s", pubDate: tenDaysAgo },
    ];
    const filtered = filterToThisWeek(items);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("Recent");
  });

  it("returns empty array when no items are recent", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const items: RssItem[] = [
      { title: "Old", link: "https://example.com/1", summary: "s", pubDate: tenDaysAgo },
    ];
    expect(filterToThisWeek(items)).toHaveLength(0);
  });
});

describe("parseRssItems", () => {
  it("extracts title, link, summary, pubDate from RSS XML", async () => {
    const now = new Date();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <item>
          <title>Test Article</title>
          <link>https://example.com/article</link>
          <description>This is a test article about security.</description>
          <pubDate>${now.toUTCString()}</pubDate>
        </item>
      </channel>
    </rss>`;

    const items = await parseRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Test Article");
    expect(items[0].link).toBe("https://example.com/article");
    expect(items[0].summary).toBe("This is a test article about security.");
    expect(items[0].pubDate.getTime()).toBeCloseTo(now.getTime(), -4);
  });

  it("handles missing fields gracefully", async () => {
    const xml = `<?xml version="1.0"?>
    <rss version="2.0"><channel><title>T</title>
      <item><title>No Link</title></item>
    </channel></rss>`;
    const items = await parseRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("No Link");
    expect(items[0].link).toBe("");
    expect(items[0].summary).toBe("");
  });

  it("truncates long summaries to 500 chars", async () => {
    const longContent = "x".repeat(1000);
    const xml = `<?xml version="1.0"?>
    <rss version="2.0"><channel><title>T</title>
      <item><title>Long</title><description>${longContent}</description></item>
    </channel></rss>`;
    const items = await parseRssItems(xml);
    expect(items[0].summary.length).toBe(500);
  });
});
