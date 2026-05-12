/**
 * Tests for core per-session messages_in schema maintenance.
 *
 * Task-specific DB tests (insertTask, cancel/pause/resume, updateTask,
 * insertRecurrence) live in `src/modules/scheduling/db.test.ts` with the
 * rest of the scheduling module.
 */
import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';

import { migrateMessagesInTable } from './session-db.js';

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => {
  SQL = await initSqlJs();
});

const TEST_DIR = '/tmp/nanoclaw-session-db-test';
const DB_PATH = path.join(TEST_DIR, 'inbound.db');

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('migrateMessagesInTable', () => {
  it('backfills series_id = id on legacy rows and is idempotent', () => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });

    const db = new SQL.Database();
    db.run(`
      CREATE TABLE messages_in (
        id             TEXT PRIMARY KEY,
        seq            INTEGER UNIQUE,
        kind           TEXT NOT NULL,
        timestamp      TEXT NOT NULL,
        status         TEXT DEFAULT 'pending',
        process_after  TEXT,
        recurrence     TEXT,
        tries          INTEGER DEFAULT 0,
        platform_id    TEXT,
        channel_type   TEXT,
        thread_id      TEXT,
        content        TEXT NOT NULL
      );
    `);
    db.run(
      "INSERT INTO messages_in (id, seq, kind, timestamp, status, content) VALUES (?, ?, 'task', datetime('now'), 'pending', '{}')",
      ['legacy-1', 2],
    );

    migrateMessagesInTable(db);
    migrateMessagesInTable(db); // idempotent

    const stmt = db.prepare('SELECT series_id FROM messages_in WHERE id = ?');
    stmt.bind(['legacy-1']);
    const row: { series_id: string } | undefined = stmt.step()
      ? (stmt.getAsObject() as { series_id: string })
      : undefined;
    stmt.free();
    expect(row!.series_id).toBe('legacy-1');
    db.close();
  });
});
