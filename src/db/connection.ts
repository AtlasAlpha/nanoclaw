import fs from 'fs';
import path from 'path';
import type { Database as SqlJsDatabase } from 'sql.js';

import { getSqlJs, initSql } from './sqlite-init.js';
import { queryOne } from './sql-helpers.js';
import { log } from '../log.js';

let _db: SqlJsDatabase | null = null;
let _dbPath: string | null = null;
let _saveInterval: ReturnType<typeof setInterval> | null = null;

export function getDb(): SqlJsDatabase {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

export function saveDb(): void {
  if (!_db || !_dbPath) return;
  const data = _db.export();
  fs.writeFileSync(_dbPath, Buffer.from(data));
}

export async function initDb(dbPath: string): Promise<SqlJsDatabase> {
  const SQL = await initSql();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const buffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : Buffer.alloc(0);
  _db = new SQL.Database(buffer.length > 0 ? buffer : undefined);
  _db.run('PRAGMA journal_mode = WAL');
  _db.run('PRAGMA foreign_keys = ON');
  _dbPath = dbPath;
  // Periodically flush to disk so crashes don't lose recent writes
  _saveInterval = setInterval(() => saveDb(), 5000);
  _saveInterval.unref();
  log.info('Central DB initialized', { path: dbPath });
  return _db;
}

/** For tests only — creates an in-memory DB and runs migrations. */
export async function initTestDb(): Promise<SqlJsDatabase> {
  const SQL = await initSql();
  _db = new SQL.Database();
  _db.run('PRAGMA foreign_keys = ON');
  return _db;
}

export function closeDb(): void {
  if (_saveInterval) clearInterval(_saveInterval);
  _saveInterval = null;
  saveDb();
  _db?.close();
  _db = null;
  _dbPath = null;
}

/**
 * Check whether a table exists. Used by core code that touches
 * module-owned tables so that an uninstalled module degrades silently
 * instead of raising SQLite errors.
 */
export function hasTable(db: SqlJsDatabase, name: string): boolean {
  const row = queryOne<{ '1': number }>(db, "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1", [name]);
  return row !== undefined;
}
