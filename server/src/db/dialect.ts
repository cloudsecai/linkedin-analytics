// Helpers that abstract SQLite-specific SQL. When migrating to Postgres,
// only this file needs to change.

export function now(): string {
  return "CURRENT_TIMESTAMP";
}

export function dateSubtract(column: string, days: number | string): string {
  // SQLite: datetime('now', '-N days')
  // Postgres: NOW() - INTERVAL 'N days'
  return `datetime('now', '-' || ${typeof days === "string" ? days : days} || ' days')`;
}

export function upsertConflict(conflictTarget: string, updateCols: string[]): string {
  // SQLite and Postgres share this syntax
  const sets = updateCols.map((c) => `${c} = excluded.${c}`).join(", ");
  return `ON CONFLICT(${conflictTarget}) DO UPDATE SET ${sets}`;
}
