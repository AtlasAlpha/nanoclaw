/**
 * Integration tests for the v2 host core.
 * Tests routing, session creation, message writing, and delivery
 * without spawning actual containers.
 */
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';

import {
  initTestDb,
  closeDb,
  runMigrations,
  createAgentGroup,
  createMessagingGroup,
  createMessagingGroupAgent,
} from './db/index.js';
import {
  resolveSession,
  writeSessionMessage,
  initSessionFolder,
  sessionDir,
  inboundDbPath,
  outboundDbPath,
  readOutboxFiles,
  clearOutbox,
} from './session-manager.js';
import { getSession, findSession } from './db/sessions.js';
import type { InboundEvent } from './channels/adapter.js';

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => {
  SQL = await initSqlJs();
});

vi.mock('./container-runner.js', () => ({
  wakeContainer: vi.fn().mockResolvedValue(undefined),
  isContainerRunning: vi.fn().mockReturnValue(false),
  getActiveContainerCount: vi.fn().mockReturnValue(0),
  killContainer: vi.fn(),
}));

vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-test-host' };
});

function now() {
  return new Date().toISOString();
}

const TEST_DIR = '/tmp/nanoclaw-test-host';

beforeEach(async () => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const db = await initTestDb();
  runMigrations(db);
});

afterEach(() => {
  closeDb();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('session manager', () => {
  beforeEach(() => {
    createAgentGroup({
      id: 'ag-1',
      name: 'Test Agent',
      folder: 'test-agent',
      agent_provider: null,
      created_at: now(),
    });
    createMessagingGroup({
      id: 'mg-1',
      channel_type: 'discord',
      platform_id: 'chan-123',
      name: 'General',
      is_group: 1,
      unknown_sender_policy: 'strict',
      created_at: now(),
    });
  });

  it('should create session folder and both DBs', () => {
    initSessionFolder('ag-1', 'sess-test');
    const dir = sessionDir('ag-1', 'sess-test');
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'outbox'))).toBe(true);

    const inPath = inboundDbPath('ag-1', 'sess-test');
    expect(fs.existsSync(inPath)).toBe(true);
    const inContent = fs.readFileSync(inPath);
    const inDb = new SQL.Database(inContent);
    const inStmt = inDb.prepare("SELECT name FROM sqlite_master WHERE type='table'");
    const inTables: Array<{ name: string }> = [];
    while (inStmt.step()) inTables.push(inStmt.getAsObject() as { name: string });
    inStmt.free();
    expect(inTables.map((t) => t.name)).toContain('messages_in');
    expect(inTables.map((t) => t.name)).toContain('delivered');
    inDb.close();

    const outPath = outboundDbPath('ag-1', 'sess-test');
    expect(fs.existsSync(outPath)).toBe(true);
    const outContent = fs.readFileSync(outPath);
    const outDb = new SQL.Database(outContent);
    const outStmt = outDb.prepare("SELECT name FROM sqlite_master WHERE type='table'");
    const outTables: Array<{ name: string }> = [];
    while (outStmt.step()) outTables.push(outStmt.getAsObject() as { name: string });
    outStmt.free();
    expect(outTables.map((t) => t.name)).toContain('messages_out');
    expect(outTables.map((t) => t.name)).toContain('processing_ack');
    outDb.close();
  });

  it('should reject outbound attachment filenames that escape the message outbox', () => {
    initSessionFolder('ag-1', 'sess-test');
    const dir = sessionDir('ag-1', 'sess-test');
    const msgOutbox = path.join(dir, 'outbox', 'msg-1');
    fs.mkdirSync(msgOutbox, { recursive: true });

    const outside = path.join(TEST_DIR, 'outside.txt');
    fs.writeFileSync(outside, 'outside secret');

    expect(readOutboxFiles('ag-1', 'sess-test', 'msg-1', ['../../../../../outside.txt'])).toBeUndefined();
  });

  it('should reject outbound attachment symlinks that escape the message outbox', () => {
    initSessionFolder('ag-1', 'sess-test');
    const dir = sessionDir('ag-1', 'sess-test');
    const msgOutbox = path.join(dir, 'outbox', 'msg-1');
    fs.mkdirSync(msgOutbox, { recursive: true });

    const outside = path.join(TEST_DIR, 'outside.txt');
    fs.writeFileSync(outside, 'outside secret');
    fs.symlinkSync('../../../../../outside.txt', path.join(msgOutbox, 'safe-name.txt'));

    expect(readOutboxFiles('ag-1', 'sess-test', 'msg-1', ['safe-name.txt'])).toBeUndefined();
  });

  it('should not recursively delete outside the outbox for unsafe message ids', () => {
    initSessionFolder('ag-1', 'sess-test');
    const victimDir = path.join(TEST_DIR, 'victim-dir');
    fs.mkdirSync(victimDir, { recursive: true });
    fs.writeFileSync(path.join(victimDir, 'keep.txt'), 'do not delete');

    clearOutbox('ag-1', 'sess-test', '../../../../victim-dir');

    expect(fs.existsSync(path.join(victimDir, 'keep.txt'))).toBe(true);
  });

  it('should still read and clear normal basename outbox files', () => {
    initSessionFolder('ag-1', 'sess-test');
    const dir = sessionDir('ag-1', 'sess-test');
    const msgOutbox = path.join(dir, 'outbox', 'msg-1');
    fs.mkdirSync(msgOutbox, { recursive: true });
    fs.writeFileSync(path.join(msgOutbox, 'result.txt'), 'ok');

    const files = readOutboxFiles('ag-1', 'sess-test', 'msg-1', ['result.txt']);
    expect(files).toHaveLength(1);
    expect(files?.[0]?.filename).toBe('result.txt');
    expect(files?.[0]?.data.toString()).toBe('ok');

    clearOutbox('ag-1', 'sess-test', 'msg-1');
    expect(fs.existsSync(msgOutbox)).toBe(false);
  });

  it('should reject inbound attachment writes through a pre-placed symlinked inbox dir', () => {
    initSessionFolder('ag-1', 'sess-test');
    const { session } = resolveSession('ag-1', 'mg-1', null, 'shared');

    const inboxRoot = path.join(sessionDir('ag-1', session.id), 'inbox');
    fs.mkdirSync(inboxRoot, { recursive: true });
    const evilTarget = path.join(TEST_DIR, 'evil-target');
    fs.mkdirSync(evilTarget, { recursive: true });
    fs.symlinkSync(evilTarget, path.join(inboxRoot, 'msg-evil'));

    writeSessionMessage('ag-1', session.id, {
      id: 'msg-evil',
      kind: 'chat',
      timestamp: now(),
      content: JSON.stringify({
        text: 'evil',
        attachments: [{ name: 'photo.png', data: Buffer.from('PNGBYTES').toString('base64'), size: 8 }],
      }),
    });

    expect(fs.existsSync(path.join(evilTarget, 'photo.png'))).toBe(false);
  });

  it('should refuse to follow a pre-existing symlink at the inbound attachment path', () => {
    initSessionFolder('ag-1', 'sess-test');
    const { session } = resolveSession('ag-1', 'mg-1', null, 'shared');

    const inboxDir = path.join(sessionDir('ag-1', session.id), 'inbox', 'msg-sym');
    fs.mkdirSync(inboxDir, { recursive: true });
    const outside = path.join(TEST_DIR, 'outside.txt');
    fs.writeFileSync(outside, 'ORIGINAL');
    fs.symlinkSync(outside, path.join(inboxDir, 'photo.png'));

    writeSessionMessage('ag-1', session.id, {
      id: 'msg-sym',
      kind: 'chat',
      timestamp: now(),
      content: JSON.stringify({
        text: 'sym',
        attachments: [{ name: 'photo.png', data: Buffer.from('PNGBYTES').toString('base64'), size: 8 }],
      }),
    });

    expect(fs.readFileSync(outside, 'utf-8')).toBe('ORIGINAL');
  });

  it('should reject inbound attachments when messageId is unsafe', () => {
    initSessionFolder('ag-1', 'sess-test');
    const { session } = resolveSession('ag-1', 'mg-1', null, 'shared');

    writeSessionMessage('ag-1', session.id, {
      id: '../../escape',
      kind: 'chat',
      timestamp: now(),
      content: JSON.stringify({
        text: 'msgid',
        attachments: [{ name: 'photo.png', data: Buffer.from('PNGBYTES').toString('base64'), size: 8 }],
      }),
    });

    const inboxRoot = path.join(sessionDir('ag-1', session.id), 'inbox');
    if (fs.existsSync(inboxRoot)) {
      expect(fs.readdirSync(inboxRoot)).toEqual([]);
    }
  });

  it('should still save inbound attachments with safe basenames', () => {
    initSessionFolder('ag-1', 'sess-test');
    const { session } = resolveSession('ag-1', 'mg-1', null, 'shared');

    writeSessionMessage('ag-1', session.id, {
      id: 'msg-ok',
      kind: 'chat',
      timestamp: now(),
      content: JSON.stringify({
        text: 'ok',
        attachments: [{ name: 'photo.png', data: Buffer.from('PNGBYTES').toString('base64'), size: 8 }],
      }),
    });

    const expected = path.join(sessionDir('ag-1', session.id), 'inbox', 'msg-ok', 'photo.png');
    expect(fs.existsSync(expected)).toBe(true);
    expect(fs.readFileSync(expected, 'utf-8')).toBe('PNGBYTES');
  });

  it('should resolve to existing session (shared mode)', () => {
    const { session: s1, created: c1 } = resolveSession('ag-1', 'mg-1', null, 'shared');
    expect(c1).toBe(true);

    const { session: s2, created: c2 } = resolveSession('ag-1', 'mg-1', null, 'shared');
    expect(c2).toBe(false);
    expect(s2.id).toBe(s1.id);
  });

  it('should create separate sessions per thread (per-thread mode)', () => {
    const { session: s1 } = resolveSession('ag-1', 'mg-1', 'thread-1', 'per-thread');
    const { session: s2 } = resolveSession('ag-1', 'mg-1', 'thread-2', 'per-thread');
    expect(s1.id).not.toBe(s2.id);
  });

  it('should reuse session for same thread', () => {
    const { session: s1 } = resolveSession('ag-1', 'mg-1', 'thread-1', 'per-thread');
    const { session: s2, created } = resolveSession('ag-1', 'mg-1', 'thread-1', 'per-thread');
    expect(created).toBe(false);
    expect(s2.id).toBe(s1.id);
  });

  it('should write message to inbound DB', () => {
    const { session } = resolveSession('ag-1', 'mg-1', null, 'shared');

    writeSessionMessage('ag-1', session.id, {
      id: 'msg-1',
      kind: 'chat',
      timestamp: now(),
      platformId: 'chan-123',
      channelType: 'discord',
      threadId: null,
      content: JSON.stringify({ sender: 'User', text: 'Hello' }),
    });

    const dbPath = inboundDbPath('ag-1', session.id);
    const dbContent = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbContent);
    const stmt = db.prepare('SELECT * FROM messages_in');
    const rows: Array<{
      id: string;
      kind: string;
      status: string;
      content: string;
    }> = [];
    while (stmt.step())
      rows.push(
        stmt.getAsObject() as {
          id: string;
          kind: string;
          status: string;
          content: string;
        },
      );
    stmt.free();
    db.close();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('msg-1');
    expect(rows[0].status).toBe('pending');
    expect(JSON.parse(rows[0].content).text).toBe('Hello');
  });

  it('should update last_active on message write', () => {
    const { session } = resolveSession('ag-1', 'mg-1', null, 'shared');
    expect(getSession(session.id)!.last_active).toBeNull();

    writeSessionMessage('ag-1', session.id, {
      id: 'msg-1',
      kind: 'chat',
      timestamp: now(),
      content: JSON.stringify({ text: 'hi' }),
    });

    expect(getSession(session.id)!.last_active).not.toBeNull();
  });

  it('should refuse path-traversal in attachment filenames', () => {
    const { session } = resolveSession('ag-1', 'mg-1', null, 'shared');
    const inboxBase = path.join(sessionDir('ag-1', session.id), 'inbox');
    const escapeTarget = path.join('/tmp', 'nanoclaw-traversal-canary');
    if (fs.existsSync(escapeTarget)) fs.rmSync(escapeTarget);

    writeSessionMessage('ag-1', session.id, {
      id: 'msg-attack',
      kind: 'chat',
      timestamp: now(),
      content: JSON.stringify({
        text: 'pwn',
        attachments: [
          {
            type: 'document',
            name: '../../../../../../../../tmp/nanoclaw-traversal-canary',
            data: Buffer.from('owned').toString('base64'),
          },
        ],
      }),
    });

    expect(fs.existsSync(escapeTarget)).toBe(false);
    const inboxDir = path.join(inboxBase, 'msg-attack');
    expect(fs.existsSync(inboxDir)).toBe(true);
    const written = fs.readdirSync(inboxDir);
    expect(written).toHaveLength(1);
    expect(written[0]).not.toContain('/');
    expect(written[0]).not.toContain('..');
  });
});

describe('router', () => {
  beforeEach(() => {
    createAgentGroup({
      id: 'ag-1',
      name: 'Test Agent',
      folder: 'test-agent',
      agent_provider: null,
      created_at: now(),
    });
    createMessagingGroup({
      id: 'mg-1',
      channel_type: 'discord',
      platform_id: 'chan-123',
      name: 'General',
      is_group: 1,
      unknown_sender_policy: 'public',
      created_at: now(),
    });
    createMessagingGroupAgent({
      id: 'mga-1',
      messaging_group_id: 'mg-1',
      agent_group_id: 'ag-1',
      engage_mode: 'pattern',
      engage_pattern: '.',
      sender_scope: 'all',
      ignored_message_policy: 'drop',
      session_mode: 'shared',
      priority: 0,
      created_at: now(),
    });
  });

  it('should route a message end-to-end', async () => {
    const { routeInbound } = await import('./router.js');
    const { wakeContainer } = await import('./container-runner.js');

    const event: InboundEvent = {
      channelType: 'discord',
      platformId: 'chan-123',
      threadId: null,
      message: {
        id: 'msg-in-1',
        kind: 'chat',
        content: JSON.stringify({ sender: 'User', text: 'Hello agent!' }),
        timestamp: now(),
      },
    };

    await routeInbound(event);

    const session = findSession('mg-1', null);
    expect(session).toBeDefined();

    const dbPath = inboundDbPath('ag-1', session!.id);
    const dbContent = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbContent);
    const stmt = db.prepare('SELECT * FROM messages_in');
    const rows: Array<{ id: string; content: string }> = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as { id: string; content: string });
    stmt.free();
    db.close();

    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].content).text).toBe('Hello agent!');

    expect(wakeContainer).toHaveBeenCalled();
  });

  it('auto-creates messaging group only when the bot is addressed (mention/DM)', async () => {
    const { routeInbound } = await import('./router.js');
    const { getMessagingGroupByPlatform } = await import('./db/messaging-groups.js');

    await routeInbound({
      channelType: 'slack',
      platformId: 'C-PLAIN',
      threadId: null,
      message: {
        id: 'msg-plain',
        kind: 'chat',
        content: JSON.stringify({ sender: 'User', text: 'Hi' }),
        timestamp: now(),
      },
    });
    expect(getMessagingGroupByPlatform('slack', 'C-PLAIN')).toBeUndefined();

    await routeInbound({
      channelType: 'slack',
      platformId: 'C-MENTIONED',
      threadId: null,
      message: {
        id: 'msg-mentioned',
        kind: 'chat',
        content: JSON.stringify({ sender: 'User', text: '@bot hi' }),
        timestamp: now(),
        isMention: true,
      },
    });
    expect(getMessagingGroupByPlatform('slack', 'C-MENTIONED')).toBeDefined();
  });

  it('should route multiple messages to the same session', async () => {
    const { routeInbound } = await import('./router.js');

    await routeInbound({
      channelType: 'discord',
      platformId: 'chan-123',
      threadId: null,
      message: { id: 'msg-a', kind: 'chat', content: JSON.stringify({ sender: 'A', text: 'First' }), timestamp: now() },
    });

    await routeInbound({
      channelType: 'discord',
      platformId: 'chan-123',
      threadId: null,
      message: {
        id: 'msg-b',
        kind: 'chat',
        content: JSON.stringify({ sender: 'B', text: 'Second' }),
        timestamp: now(),
      },
    });

    const session = findSession('mg-1', null);
    const dbPath = inboundDbPath('ag-1', session!.id);
    const dbContent = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbContent);
    const stmt = db.prepare('SELECT * FROM messages_in ORDER BY timestamp');
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    db.close();

    expect(rows).toHaveLength(2);
  });

  it('fans out to every matching agent, each in its own session', async () => {
    const { routeInbound } = await import('./router.js');
    const { wakeContainer } = await import('./container-runner.js');
    (wakeContainer as unknown as ReturnType<typeof vi.fn>).mockClear();

    createAgentGroup({
      id: 'ag-2',
      name: 'Secondary Agent',
      folder: 'secondary-agent',
      agent_provider: null,
      created_at: now(),
    });
    createMessagingGroupAgent({
      id: 'mga-2',
      messaging_group_id: 'mg-1',
      agent_group_id: 'ag-2',
      engage_mode: 'pattern',
      engage_pattern: '.',
      sender_scope: 'all',
      ignored_message_policy: 'drop',
      session_mode: 'shared',
      priority: 0,
      created_at: now(),
    });

    await routeInbound({
      channelType: 'discord',
      platformId: 'chan-123',
      threadId: null,
      message: { id: 'msg-fan', kind: 'chat', content: JSON.stringify({ text: 'hello all' }), timestamp: now() },
    });

    expect(wakeContainer).toHaveBeenCalledTimes(2);

    const { getSessionsByAgentGroup } = await import('./db/sessions.js');
    expect(getSessionsByAgentGroup('ag-1')).toHaveLength(1);
    expect(getSessionsByAgentGroup('ag-2')).toHaveLength(1);
  });

  it('accumulates without waking when engage fails + ignored_message_policy=accumulate', async () => {
    const { routeInbound } = await import('./router.js');
    const { wakeContainer } = await import('./container-runner.js');
    (wakeContainer as unknown as ReturnType<typeof vi.fn>).mockClear();

    const { updateMessagingGroupAgent } = await import('./db/messaging-groups.js');
    updateMessagingGroupAgent('mga-1', {
      engage_mode: 'mention',
      ignored_message_policy: 'accumulate',
    });

    await routeInbound({
      channelType: 'discord',
      platformId: 'chan-123',
      threadId: null,
      message: {
        id: 'msg-nomatch',
        kind: 'chat',
        content: JSON.stringify({ text: 'no mention here' }),
        timestamp: now(),
      },
    });

    expect(wakeContainer).not.toHaveBeenCalled();

    const session = findSession('mg-1', null);
    expect(session).toBeDefined();
    const dbContent = fs.readFileSync(inboundDbPath('ag-1', session!.id));
    const db = new SQL.Database(dbContent);
    const stmt = db.prepare('SELECT id, trigger FROM messages_in');
    const rows: Array<{ id: string; trigger: number }> = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as { id: string; trigger: number });
    stmt.free();
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0].trigger).toBe(0);
  });

  it('drops silently when engage fails + ignored_message_policy=drop', async () => {
    const { routeInbound } = await import('./router.js');
    const { wakeContainer } = await import('./container-runner.js');
    (wakeContainer as unknown as ReturnType<typeof vi.fn>).mockClear();

    const { updateMessagingGroupAgent } = await import('./db/messaging-groups.js');
    updateMessagingGroupAgent('mga-1', { engage_mode: 'mention' });

    await routeInbound({
      channelType: 'discord',
      platformId: 'chan-123',
      threadId: null,
      message: { id: 'msg-drop', kind: 'chat', content: JSON.stringify({ text: 'ignored' }), timestamp: now() },
    });

    expect(wakeContainer).not.toHaveBeenCalled();
    expect(findSession('mg-1', null)).toBeUndefined();
  });
});

describe('delivery', () => {
  it('should detect undelivered messages in outbound DB', () => {
    createAgentGroup({
      id: 'ag-1',
      name: 'Agent',
      folder: 'agent',
      agent_provider: null,
      created_at: now(),
    });
    createMessagingGroup({
      id: 'mg-test',
      channel_type: 'discord',
      platform_id: 'chan-test',
      name: 'Test',
      is_group: 0,
      unknown_sender_policy: 'strict',
      created_at: now(),
    });

    const { session } = resolveSession('ag-1', 'mg-test', null, 'shared');

    const dbPath = outboundDbPath('ag-1', session.id);
    const dbContent = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbContent);
    db.run(
      `INSERT INTO messages_out (id, timestamp, kind, platform_id, channel_type, content)
       VALUES ('out-1', datetime('now'), 'chat', 'chan-123', 'discord', ?)`,
      [JSON.stringify({ text: 'Agent response' })],
    );

    const stmt = db.prepare('SELECT * FROM messages_out');
    const undelivered: Array<{ id: string; content: string }> = [];
    while (stmt.step()) undelivered.push(stmt.getAsObject() as { id: string; content: string });
    stmt.free();
    db.close();

    expect(undelivered).toHaveLength(1);
    expect(JSON.parse(undelivered[0].content).text).toBe('Agent response');
  });
});
