import type Database from "better-sqlite3";
import { calculateCostCents } from "../../ai/client.js";

// ── Types ──────────────────────────────────────────────────

export interface AiLogInput {
  run_id: number;
  step: string;
  model: string;
  input_messages: string;
  output_text: string;
  tool_calls: string | null;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  duration_ms: number;
}

// ── ai_runs ────────────────────────────────────────────────

export function createRun(
  db: Database.Database,
  personaId: number,
  triggered_by: string,
  post_count: number
): number {
  const result = db
    .prepare(
      `INSERT INTO ai_runs (persona_id, triggered_by, post_count) VALUES (?, ?, ?)`
    )
    .run(personaId, triggered_by, post_count);
  return Number(result.lastInsertRowid);
}

export function completeRun(
  db: Database.Database,
  runId: number,
  stats: { input_tokens: number; output_tokens: number; cost_cents: number }
): void {
  db.prepare(
    `UPDATE ai_runs
     SET status = 'completed',
         completed_at = CURRENT_TIMESTAMP,
         total_input_tokens = ?,
         total_output_tokens = ?,
         total_cost_cents = ?
     WHERE id = ?`
  ).run(stats.input_tokens, stats.output_tokens, stats.cost_cents, runId);
}

export function failRun(
  db: Database.Database,
  runId: number,
  error: string
): void {
  db.prepare(
    `UPDATE ai_runs
     SET status = 'failed',
         completed_at = CURRENT_TIMESTAMP,
         error = ?
     WHERE id = ?`
  ).run(error, runId);
}

export function getRunningRun(
  db: Database.Database,
  personaId: number
): { id: number; started_at: string } | null {
  return (
    (db
      .prepare("SELECT id, started_at FROM ai_runs WHERE status = 'running' AND persona_id = ? LIMIT 1")
      .get(personaId) as { id: number; started_at: string } | undefined) ?? null
  );
}

export function getLatestCompletedRun(
  db: Database.Database,
  personaId: number
): { id: number; status: string; post_count: number; completed_at: string } | null {
  return (
    (db
      .prepare(
        "SELECT ar.id, ar.status, ar.post_count, ar.completed_at FROM ai_runs ar JOIN ai_overview ao ON ao.run_id = ar.id WHERE ar.status = 'completed' AND ar.persona_id = ? ORDER BY ar.id DESC LIMIT 1"
      )
      .get(personaId) as
      | { id: number; status: string; post_count: number; completed_at: string }
      | undefined) ?? null
  );
}

export function getRunLogs(
  db: Database.Database,
  runId: number
): Array<{ model: string; input_tokens: number; output_tokens: number }> {
  return db
    .prepare("SELECT model, input_tokens, output_tokens FROM ai_logs WHERE run_id = ?")
    .all(runId) as Array<{ model: string; input_tokens: number; output_tokens: number }>;
}

export function getRunCost(
  db: Database.Database,
  runId: number
): { input_tokens: number; output_tokens: number; cost_cents: number } {
  const logs = getRunLogs(db, runId);
  return {
    input_tokens: logs.reduce((s, l) => s + l.input_tokens, 0),
    output_tokens: logs.reduce((s, l) => s + l.output_tokens, 0),
    cost_cents: calculateCostCents(logs),
  };
}

// ── ai_logs ────────────────────────────────────────────────

export function insertAiLog(
  db: Database.Database,
  input: AiLogInput
): void {
  db.prepare(
    `INSERT INTO ai_logs (run_id, step, model, input_messages, output_text, tool_calls, input_tokens, output_tokens, thinking_tokens, duration_ms)
     VALUES (@run_id, @step, @model, @input_messages, @output_text, @tool_calls, @input_tokens, @output_tokens, @thinking_tokens, @duration_ms)`
  ).run(input);
}

export function getAiLogsForRun(db: Database.Database, runId: number): any[] {
  return db.prepare("SELECT * FROM ai_logs WHERE run_id = ? ORDER BY id").all(runId);
}

// ── completed runs list ────────────────────────────────────

export function listCompletedRuns(db: Database.Database, personaId: number): any[] {
  return db
    .prepare(
      `SELECT id, triggered_by, post_count, status, started_at, completed_at,
              total_input_tokens, total_output_tokens, total_cost_cents
       FROM ai_runs
       WHERE status = 'completed' AND persona_id = ?
       ORDER BY id DESC LIMIT 20`
    )
    .all(personaId);
}

export function getTotalCostForPersona(db: Database.Database, personaId: number): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(total_cost_cents), 0) as total FROM ai_runs WHERE status = 'completed' AND persona_id = ?")
    .get(personaId) as { total: number };
  return row.total;
}

export function getLastFullRun(
  db: Database.Database,
  personaId: number
): { id: number; triggered_by: string; post_count: number; completed_at: string } | undefined {
  return db
    .prepare(
      `SELECT id, triggered_by, post_count, completed_at
       FROM ai_runs WHERE status = 'completed'
         AND triggered_by NOT LIKE '%tagging%'
         AND persona_id = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(personaId) as any;
}

// ── Cost backfill ──────────────────────────────────────────

export function getRunsNeedingCostBackfill(db: Database.Database): { id: number }[] {
  return db
    .prepare("SELECT id FROM ai_runs WHERE status = 'completed' AND (total_cost_cents = 0 OR total_cost_cents IS NULL)")
    .all() as { id: number }[];
}

export function backfillRunCost(db: Database.Database, runId: number, costCents: number): void {
  db.prepare("UPDATE ai_runs SET total_cost_cents = ? WHERE id = ?").run(costCents, runId);
}

// ── log pruning ────────────────────────────────────────────

export function pruneOldAiLogs(db: Database.Database, retentionDays: number = 30): number {
  const result = db.prepare(
    "DELETE FROM ai_logs WHERE created_at < datetime('now', '-' || ? || ' days')"
  ).run(retentionDays);
  return result.changes;
}
