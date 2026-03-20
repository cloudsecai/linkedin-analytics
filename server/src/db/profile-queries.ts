import type Database from "better-sqlite3";

export interface AuthorProfile {
  id: number;
  profile_text: string;
  profile_json: string;
  interview_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProfileInterview {
  id: number;
  transcript_json: string;
  extracted_profile: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export function getAuthorProfile(db: Database.Database): AuthorProfile | undefined {
  return db.prepare("SELECT * FROM author_profile WHERE id = 1").get() as AuthorProfile | undefined;
}

export function upsertAuthorProfile(
  db: Database.Database,
  data: { profile_text: string; profile_json?: string }
): void {
  const existing = getAuthorProfile(db);
  if (existing) {
    const sets = ["profile_text = ?", "updated_at = CURRENT_TIMESTAMP"];
    const params: any[] = [data.profile_text];
    if (data.profile_json !== undefined) {
      sets.push("profile_json = ?");
      params.push(data.profile_json);
    }
    params.push(1);
    db.prepare(`UPDATE author_profile SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  } else {
    db.prepare(
      "INSERT INTO author_profile (id, profile_text, profile_json) VALUES (1, ?, ?)"
    ).run(data.profile_text, data.profile_json ?? "{}");
  }
}

export function incrementInterviewCount(db: Database.Database): void {
  const existing = getAuthorProfile(db);
  if (existing) {
    db.prepare("UPDATE author_profile SET interview_count = interview_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run();
  }
}

export function insertProfileInterview(
  db: Database.Database,
  data: { transcript_json: string; extracted_profile?: string; duration_seconds?: number }
): number {
  const result = db.prepare(
    "INSERT INTO profile_interviews (transcript_json, extracted_profile, duration_seconds) VALUES (?, ?, ?)"
  ).run(data.transcript_json, data.extracted_profile ?? null, data.duration_seconds ?? null);
  return Number(result.lastInsertRowid);
}

export function getProfileInterviews(db: Database.Database): ProfileInterview[] {
  return db.prepare("SELECT * FROM profile_interviews ORDER BY created_at DESC LIMIT 20").all() as ProfileInterview[];
}
