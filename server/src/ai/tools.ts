import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";

const ALLOWED_TABLES = new Set([
  "posts",
  "post_metrics",
  "follower_snapshots",
  "profile_snapshots",
  "ai_tags",
  "ai_post_topics",
  "ai_taxonomy",
]);

// ── Tool definitions ────────────────────────────────────────

export function createQueryDbTool(): Anthropic.Messages.Tool {
  return {
    name: "query_db",
    description:
      "Run a read-only SQL query against the LinkedIn analytics database. " +
      "Allowed tables: posts, post_metrics, follower_snapshots, profile_snapshots, " +
      "ai_tags, ai_post_topics, ai_taxonomy. Only SELECT statements are permitted. " +
      "Results are returned as a markdown table (max 100 rows).",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description: "A SELECT SQL query to execute against the database.",
        },
      },
      required: ["sql"],
    },
  };
}

export function createSubmitAnalysisTool(): Anthropic.Messages.Tool {
  return {
    name: "submit_analysis",
    description:
      "Submit your final analysis with structured insights and recommendations.",
    input_schema: {
      type: "object" as const,
      properties: {
        insights: {
          type: "array",
          description: "Array of insight objects discovered from the data.",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              stable_key: { type: "string" },
              claim: { type: "string" },
              evidence: { type: "string" },
              confidence: { type: "number" },
              direction: { type: "string" },
            },
            required: [
              "category",
              "stable_key",
              "claim",
              "evidence",
              "confidence",
              "direction",
            ],
          },
        },
        recommendations: {
          type: "array",
          description: "Array of actionable recommendations.",
          items: {
            type: "object",
            properties: {
              key: {
                type: "string",
                description:
                  "A stable, short snake_case identifier for this recommendation (e.g. 'shift_to_image_format'). Used for cross-run matching.",
              },
              type: { type: "string" },
              priority: { type: "number" },
              confidence: { type: "number" },
              headline: { type: "string" },
              detail: { type: "string" },
              action: { type: "string" },
              evidence: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: [
              "key",
              "type",
              "priority",
              "confidence",
              "headline",
              "detail",
              "action",
              "evidence",
            ],
          },
        },
        overview: {
          type: "object",
          description: "High-level summary of the analysis.",
          properties: {
            summary_text: { type: "string" },
            top_performer_post_id: { type: "string" },
            top_performer_reason: { type: "string" },
            quick_insights: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["summary_text", "quick_insights"],
        },
      },
      required: ["insights", "recommendations", "overview"],
    },
  };
}

// ── SQL execution ───────────────────────────────────────────

export function executeQueryDb(db: Database.Database, sql: string): string {
  const trimmed = sql.trim();

  // Only SELECT allowed
  if (!/^SELECT\b/i.test(trimmed)) {
    return "Error: Only SELECT statements are allowed.";
  }

  // Extract table names and check allowlist
  const tablePattern = /(?:from|join)\s+(\w+)/gi;
  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(trimmed)) !== null) {
    const table = match[1].toLowerCase();
    if (!ALLOWED_TABLES.has(table)) {
      return `Error: Table "${match[1]}" is not allowed. Allowed tables: ${[...ALLOWED_TABLES].join(", ")}`;
    }
  }

  // Auto-append LIMIT 100 if no LIMIT present
  let query = trimmed;
  if (!/\bLIMIT\b/i.test(query)) {
    // Remove trailing semicolon before appending
    query = query.replace(/;\s*$/, "");
    query += " LIMIT 100";
  }

  try {
    const rows = db.prepare(query).all() as Record<string, unknown>[];

    if (rows.length === 0) {
      return "(no results)";
    }

    // Format as markdown table
    const columns = Object.keys(rows[0]);
    const header = "| " + columns.join(" | ") + " |";
    const separator =
      "| " + columns.map(() => "---").join(" | ") + " |";
    const dataRows = rows.map(
      (row) =>
        "| " +
        columns.map((col) => String(row[col] ?? "")).join(" | ") +
        " |"
    );

    return [header, separator, ...dataRows].join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}
