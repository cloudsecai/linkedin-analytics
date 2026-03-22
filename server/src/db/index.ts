import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function initDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");

  // Split on semicolons and execute each statement
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    // Skip PRAGMA in schema.sql — we handle it above
    if (stmt.toUpperCase().startsWith("PRAGMA")) continue;
    db.exec(stmt);
  }

  runMigrations(db);

  // Clean up stale "running" AI pipelines from previous crashes
  db.prepare(
    `UPDATE ai_runs SET status = 'failed', completed_at = datetime('now')
     WHERE status = 'running' AND started_at < datetime('now', '-1 hour')`
  ).run();

  return db;
}

export function runMigrations(db: Database.Database): void {
  const migrationsDir = path.join(__dirname, "migrations");
  if (!fs.existsSync(migrationsDir)) return;

  // Get current version
  const currentVersion = db
    .prepare(
      "SELECT COALESCE(MAX(version), 0) as v FROM schema_version"
    )
    .get() as { v: number };

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const version = parseInt(file.split("-")[0] || file, 10);
    if (isNaN(version) || version <= currentVersion.v) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    db.exec(sql);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
  }
}
