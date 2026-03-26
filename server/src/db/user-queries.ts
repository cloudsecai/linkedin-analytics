import type Database from "better-sqlite3";
import crypto from "crypto";

export function ensureDefaultUser(db: Database.Database): { id: number; api_token: string } {
  const existing = db.prepare("SELECT id, api_token FROM users LIMIT 1").get() as { id: number; api_token: string } | undefined;
  if (existing) return existing;

  const token = crypto.randomBytes(32).toString("hex");
  const result = db.prepare(
    "INSERT INTO users (name, api_token) VALUES ('Default User', ?)"
  ).run(token);
  const userId = Number(result.lastInsertRowid);

  // Associate existing personas with this user
  db.prepare("UPDATE personas SET user_id = ? WHERE user_id IS NULL").run(userId);

  return { id: userId, api_token: token };
}

export function getUserByToken(db: Database.Database, token: string): { id: number; name: string } | undefined {
  return db.prepare("SELECT id, name FROM users WHERE api_token = ?").get(token) as any;
}

export function getUserToken(db: Database.Database): string | null {
  const row = db.prepare("SELECT api_token FROM users LIMIT 1").get() as { api_token: string } | undefined;
  return row?.api_token ?? null;
}
