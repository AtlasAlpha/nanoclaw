/**
 * Tests for the scheduling module's task DB helpers — focused on the
 * series_id invariant that lets cancel/pause/resume/update reach the live
 * next occurrence of a recurring task, even after the row the agent
 * remembers has completed and been replaced by a follow-up.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';

import { initSql } from '../../db/sqlite-init.js';
import { ensureSchema, openInboundDb } from '../../db/session-db.js';
import {
  insertTask,
  insertRecurrence,
  cancelTask,
  pauseTask,
  resumeTask,
  updateTask,
  getCompletedRecurring,
  type RecurringMessage,
} from './db.js';

const TEST_DIR = '/tmp/nanoclaw-scheduling-db-test';
const DB_PATH = path.join(TEST_DIR, 'inbound.db');

beforeAll(async () => {
  await initSql();
});

function freshDb() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  ensureSchema(DB_PATH, 'inbound');
  return openInboundDb(DB_PATH);
}

function insertBasicTask(db: ReturnType<typeof openInboundDb>, id: string, recurrence: string | null) {
  insertTask(db, {
    id,
    processAfter: new Date().toISOString(),
    recurrence,
    platformId: null,
    channelType: null,
    threadId: null,
    content: JSON.stringify({ prompt: 'noop' }),
  });
}

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('insertTask', () => {
  it('stamps series_id = id on insert', () => {
    const db = freshDb();
    insertBasicTask(db, 'task-1', null);
    const stmt = db.prepare('SELECT series_id FROM messages_in WHERE id = ?');
    stmt.bind(['task-1']);
    const row: { series_id: string } | undefined = stmt.step()
      ? (stmt.getAsObject() as { series_id: string })
      : undefined;
    stmt.free();
    expect(row!.series_id).toBe('task-1');
    db.close();
  });
});

describe('cancelTask / pauseTask / resumeTask series matching', () => {
  function seedRecurringChain(db: ReturnType<typeof openInboundDb>) {
    insertBasicTask(db, 'task-orig', '0 9 * * *');
    db.run("UPDATE messages_in SET status = 'completed' WHERE id = 'task-orig'");

    const msg: RecurringMessage = {
      id: 'task-orig',
      kind: 'task',
      content: JSON.stringify({ prompt: 'noop' }),
      recurrence: '0 9 * * *',
      process_after: null,
      platform_id: null,
      channel_type: null,
      thread_id: null,
      series_id: 'task-orig',
    };
    insertRecurrence(db, msg, 'task-next', new Date(Date.now() + 86400000).toISOString());
  }

  it('cancel by original id reaches the live follow-up via series_id', () => {
    const db = freshDb();
    seedRecurringChain(db);

    cancelTask(db, 'task-orig');

    const liveStmt = db.prepare("SELECT id, status, recurrence FROM messages_in WHERE status = 'pending'");
    const live: Array<{ id: string; status: string; recurrence: string | null }> = [];
    while (liveStmt.step()) live.push(liveStmt.getAsObject() as { id: string; status: string; recurrence: string | null });
    liveStmt.free();
    expect(live).toHaveLength(0);

    const fuStmt = db.prepare("SELECT status, recurrence FROM messages_in WHERE id = 'task-next'");
    const followUp: { status: string; recurrence: string | null } | undefined = fuStmt.step()
      ? (fuStmt.getAsObject() as { status: string; recurrence: string | null })
      : undefined;
    fuStmt.free();
    expect(followUp!.status).toBe('completed');
    expect(followUp!.recurrence).toBeNull();
    db.close();
  });

  it('cancelled task is not picked up by getCompletedRecurring', () => {
    const db = freshDb();
    insertBasicTask(db, 'task-1', '0 9 * * *');
    cancelTask(db, 'task-1');

    const recurring = getCompletedRecurring(db);
    expect(recurring).toHaveLength(0);
    db.close();
  });

  it('pause by original id pauses the live follow-up', () => {
    const db = freshDb();
    seedRecurringChain(db);

    pauseTask(db, 'task-orig');

    const fuStmt = db.prepare("SELECT status FROM messages_in WHERE id = 'task-next'");
    const followUp: { status: string } | undefined = fuStmt.step()
      ? (fuStmt.getAsObject() as { status: string })
      : undefined;
    fuStmt.free();
    expect(followUp!.status).toBe('paused');
    db.close();
  });

  it('resume by original id resumes the live follow-up', () => {
    const db = freshDb();
    seedRecurringChain(db);

    db.run("UPDATE messages_in SET status = 'paused' WHERE id = 'task-next'");
    resumeTask(db, 'task-orig');

    const fuStmt = db.prepare("SELECT status FROM messages_in WHERE id = 'task-next'");
    const followUp: { status: string } | undefined = fuStmt.step()
      ? (fuStmt.getAsObject() as { status: string })
      : undefined;
    fuStmt.free();
    expect(followUp!.status).toBe('pending');
    db.close();
  });
});

describe('updateTask', () => {
  it('merges supplied fields into content JSON without clobbering others', () => {
    const db = freshDb();
    insertTask(db, {
      id: 'task-1',
      processAfter: new Date().toISOString(),
      recurrence: null,
      platformId: null,
      channelType: null,
      threadId: null,
      content: JSON.stringify({ prompt: 'old', script: 'echo old', extra: 'keep me' }),
    });

    const touched = updateTask(db, 'task-1', { prompt: 'new' });
    expect(touched).toBe(1);

    const stmt = db.prepare('SELECT content FROM messages_in WHERE id = ?');
    stmt.bind(['task-1']);
    const row: { content: string } | undefined = stmt.step()
      ? (stmt.getAsObject() as { content: string })
      : undefined;
    stmt.free();
    const parsed = JSON.parse(row!.content);
    expect(parsed.prompt).toBe('new');
    expect(parsed.script).toBe('echo old');
    expect(parsed.extra).toBe('keep me');
  });

  it('updates recurrence and process_after when supplied', () => {
    const db = freshDb();
    insertTask(db, {
      id: 'task-1',
      processAfter: '2026-01-01T00:00:00Z',
      recurrence: '0 9 * * *',
      platformId: null,
      channelType: null,
      threadId: null,
      content: JSON.stringify({ prompt: 'p' }),
    });

    updateTask(db, 'task-1', { recurrence: '0 18 * * *', processAfter: '2026-02-01T00:00:00Z' });

    const stmt = db.prepare('SELECT recurrence, process_after FROM messages_in WHERE id = ?');
    stmt.bind(['task-1']);
    const row: { recurrence: string; process_after: string } | undefined = stmt.step()
      ? (stmt.getAsObject() as { recurrence: string; process_after: string })
      : undefined;
    stmt.free();
    expect(row!.recurrence).toBe('0 18 * * *');
    expect(row!.process_after).toBe('2026-02-01T00:00:00Z');
  });

  it('clears recurrence when null is passed', () => {
    const db = freshDb();
    insertTask(db, {
      id: 'task-1',
      processAfter: '2026-01-01T00:00:00Z',
      recurrence: '0 9 * * *',
      platformId: null,
      channelType: null,
      threadId: null,
      content: JSON.stringify({ prompt: 'p' }),
    });

    updateTask(db, 'task-1', { recurrence: null });

    const stmt = db.prepare('SELECT recurrence FROM messages_in WHERE id = ?');
    stmt.bind(['task-1']);
    const row: { recurrence: string | null } | undefined = stmt.step()
      ? (stmt.getAsObject() as { recurrence: string | null })
      : undefined;
    stmt.free();
    expect(row!.recurrence).toBeNull();
  });

  it('reaches the live follow-up via series_id when called with the original id', () => {
    const db = freshDb();
    insertTask(db, {
      id: 'task-orig',
      processAfter: new Date().toISOString(),
      recurrence: '0 9 * * *',
      platformId: null,
      channelType: null,
      threadId: null,
      content: JSON.stringify({ prompt: 'old' }),
    });
    db.run("UPDATE messages_in SET status = 'completed' WHERE id = 'task-orig'");

    const msg: RecurringMessage = {
      id: 'task-orig',
      kind: 'task',
      content: JSON.stringify({ prompt: 'old' }),
      recurrence: '0 9 * * *',
      process_after: null,
      platform_id: null,
      channel_type: null,
      thread_id: null,
      series_id: 'task-orig',
    };
    insertRecurrence(db, msg, 'task-next', new Date(Date.now() + 86400000).toISOString());

    const touched = updateTask(db, 'task-orig', { prompt: 'new' });
    expect(touched).toBe(1);

    const liveStmt = db.prepare("SELECT content FROM messages_in WHERE id = 'task-next'");
    const live: { content: string } | undefined = liveStmt.step()
      ? (liveStmt.getAsObject() as { content: string })
      : undefined;
    liveStmt.free();
    expect(JSON.parse(live!.content).prompt).toBe('new');

    const origStmt = db.prepare("SELECT content FROM messages_in WHERE id = 'task-orig'");
    const orig: { content: string } | undefined = origStmt.step()
      ? (origStmt.getAsObject() as { content: string })
      : undefined;
    origStmt.free();
    expect(JSON.parse(orig!.content).prompt).toBe('old');
  });

  it('returns 0 when no live task matches', () => {
    const db = freshDb();
    insertTask(db, {
      id: 'task-1',
      processAfter: new Date().toISOString(),
      recurrence: null,
      platformId: null,
      channelType: null,
      threadId: null,
      content: JSON.stringify({ prompt: 'p' }),
    });
    db.run("UPDATE messages_in SET status = 'completed' WHERE id = 'task-1'");

    const touched = updateTask(db, 'task-1', { prompt: 'new' });
    expect(touched).toBe(0);
  });
});

describe('insertRecurrence', () => {
  it('copies series_id forward', () => {
    const db = freshDb();
    insertBasicTask(db, 'task-orig', '0 9 * * *');
    db.run("UPDATE messages_in SET status = 'completed' WHERE id = 'task-orig'");

    const msg: RecurringMessage = {
      id: 'task-orig',
      kind: 'task',
      content: '{}',
      recurrence: '0 9 * * *',
      process_after: null,
      platform_id: null,
      channel_type: null,
      thread_id: null,
      series_id: 'task-orig',
    };
    insertRecurrence(db, msg, 'task-next', new Date().toISOString());

    const stmt = db.prepare('SELECT series_id FROM messages_in WHERE id = ?');
    stmt.bind(['task-next']);
    const row: { series_id: string } | undefined = stmt.step()
      ? (stmt.getAsObject() as { series_id: string })
      : undefined;
    stmt.free();
    expect(row!.series_id).toBe('task-orig');
    db.close();
  });
});
