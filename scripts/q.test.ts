import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import initSqlJs from 'sql.js';

const SQL = await initSqlJs();

/**
 * Smoke tests for the q.ts sqlite-CLI replacement wrapper.
 *
 * Verifies the two modes (SELECT prints rows in sqlite3 default "list"
 * format; mutation runs via db.run) and a few edge cases that real
 * skill invocations rely on.
 */

const Q = path.resolve(__dirname, 'q.ts');

describe('scripts/q.ts', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-test-'));
    dbPath = path.join(tempDir, 'test.db');
    const db = new SQL.Database();
    db.run(`
      CREATE TABLE t (id INTEGER, name TEXT, note TEXT);
      INSERT INTO t (id, name, note) VALUES (1, 'alice', 'hi'), (2, 'bob', NULL);
    `);
    const data = db.export();
    fs.writeFileSync(dbPath, data);
    db.close();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function run(sql: string): { stdout: string; stderr: string; status: number } {
    const r = spawnSync('pnpm', ['exec', 'tsx', Q, dbPath, sql], {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
  }

  it('SELECT prints pipe-separated rows in default order', () => {
    const r = run('SELECT id, name FROM t ORDER BY id');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('1|alice\n2|bob');
  });

  it('SELECT renders NULL as empty string (matches sqlite3 default mode)', () => {
    const r = run('SELECT id, note FROM t ORDER BY id');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('1|hi\n2|');
  });

  it('SELECT with no rows prints nothing', () => {
    const r = run("SELECT id FROM t WHERE name = 'nobody'");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('INSERT runs via db.exec and persists', () => {
    const r = run("INSERT INTO t (id, name) VALUES (3, 'carol')");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');

    const data = fs.readFileSync(dbPath);
    const db = new SQL.Database(data);
    const stmt = db.prepare('SELECT name FROM t WHERE id = 3');
    stmt.step();
    const row = stmt.getAsObject() as { name: string };
    stmt.free();
    db.close();
    expect(row.name).toBe('carol');
  });

  it('compound mutation statements execute together', () => {
    const r = run("DELETE FROM t WHERE id = 1; INSERT INTO t (id, name) VALUES (9, 'zed');");
    expect(r.status).toBe(0);

    const data = fs.readFileSync(dbPath);
    const db = new SQL.Database(data);
    const stmt = db.prepare('SELECT id FROM t ORDER BY id');
    const ids: number[] = [];
    while (stmt.step()) {
      ids.push((stmt.getAsObject() as { id: number }).id);
    }
    stmt.free();
    db.close();
    expect(ids).toEqual([2, 9]);
  });

  it('WITH...DELETE is treated as a mutation, not a query', () => {
    const r = run("WITH stale AS (SELECT id FROM t WHERE name = 'alice') DELETE FROM t WHERE id IN (SELECT id FROM stale)");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');

    const data = fs.readFileSync(dbPath);
    const db = new SQL.Database(data);
    const stmt = db.prepare('SELECT name FROM t');
    const rows: { name: string }[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as { name: string });
    }
    stmt.free();
    db.close();
    expect(rows).toEqual([{ name: 'bob' }]);
  });

  it('exits 2 with usage when args are missing', () => {
    const r = spawnSync('pnpm', ['exec', 'tsx', Q], {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Usage/);
  });
});
