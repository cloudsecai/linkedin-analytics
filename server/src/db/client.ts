import type Database from "better-sqlite3";

export interface DbClient {
  run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number };
  get<T = any>(sql: string, ...params: any[]): T | undefined;
  all<T = any>(sql: string, ...params: any[]): T[];
  transaction<T>(fn: () => T): T;
  raw: Database.Database; // escape hatch for migration period
}

export function createDbClient(db: Database.Database): DbClient {
  return {
    run(sql, ...params) {
      const result = db.prepare(sql).run(...params);
      return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
    },
    get<T>(sql: string, ...params: any[]): T | undefined {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    all<T>(sql: string, ...params: any[]): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
    raw: db,
  };
}
