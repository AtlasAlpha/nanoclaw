import fs from 'fs';
import path from 'path';
import type { Database as SqlJsDatabase } from 'sql.js';

import { getSqlJs, initSql } from './sqlite-init.js';
import { queryOne } from './sql-helpers.js';
import { log } from '../log.js';

let _db: SqlJsDatabase | null = null;
let _dbPath: string | null = null;
let _saveInterval: ReturnType<typeof setInterval> | null = null;
let _lastLoadMtime: number = 0;

export function getDb(): SqlJsDatabase {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

function reloadDb(): void {
  if (!_db || !_dbPath) return;
  try {
    const SQL = getSqlJs();
    const buffer = fs.readFileSync(_dbPath);
    _db.close();
    _db = new SQL.Database(buffer);
    _db.run('PRAGMA journal_mode = WAL');
    _db.run('PRAGMA foreign_keys = ON');
    _lastLoadMtime = fs.statSync(_dbPath).mtimeMs;
    log.info('Central DB reloaded from disk');
  } catch (err) {
    log.error('Failed to reload central DB from disk', { err });
  }
}

export function saveDb(): void {
  if (!_db || !_dbPath) return;
  // Check if file was modified externally (e.g. by scripts/q.ts).
  // If so, reload from disk instead of overwriting — the external change
  // wins over any unsaved in-memory state from the last ~5s window.
  try {
    const stat = fs.statSync(_dbPath);
    if (stat.mtimeMs > _lastLoadMtime) {
      log.warn('Central DB was modified externally — reloading from disk');
      reloadDb();
      return;
    }
  } catch {
    // File may not exist yet on first save
  }
  const data = _db.export();
  fs.writeFileSync(_dbPath, Buffer.from(data));
  _lastLoadMtime = fs.statSync(_dbPath).mtimeMs;
}

export async function initDb(dbPath: string): Promise<SqlJsDatabase> {
  const SQL = await initSql();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const buffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : Buffer.alloc(0);
  _db = new SQL.Database(buffer.length > 0 ? buffer : undefined);
  _db.run('PRAGMA journal_mode = WAL');
  _db.run('PRAGMA foreign_keys = ON');
  _dbPath = dbPath;
  _lastLoadMtime = fs.existsSync(dbPath) ? fs.statSync(dbPath).mtimeMs : 0;
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
  const row = queryOne<{ '1': number }>(db, "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1", [
    name,
  ]);
  return row !== undefined;
}
