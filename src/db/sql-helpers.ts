/**
 * Query helpers for sql.js — wraps the prepare → bind → step → getAsObject → free cycle.
 * Mirrors better-sqlite3's .get() and .all() convenience.
 */
import type { Database } from 'sql.js';

export function queryAll<T>(db: Database, sql: string, params?: unknown[] | Record<string, unknown>): T[] {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params as never);
  const results: T[] = [];
  while (stmt.step()) results.push(stmt.getAsObject() as T);
  stmt.free();
  return results;
}

export function queryOne<T>(db: Database, sql: string, params?: unknown[] | Record<string, unknown>): T | undefined {
  return queryAll<T>(db, sql, params)[0];
}

export function run(db: Database, sql: string, params?: unknown[] | Record<string, unknown>): { changes: number } {
  db.run(sql, params as never);
  return { changes: db.getRowsModified() };
}
