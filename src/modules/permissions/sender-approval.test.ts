/**
 * Integration tests for the unknown-sender request_approval flow
 * (ACTION-ITEMS item 5).
 *
 * Covers:
 *  - request_approval policy fires `requestSenderApproval` on first unknown
 *    message from a sender
 *  - In-flight dedup: second message from the same sender while pending is
 *    silently dropped (no second card, no second row)
 *  - Approve path: member added, original message replayed via routeInbound,
 *    container woken
 *  - Deny path: pending row deleted, no member added
 */
import fs from 'fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { initTestDb, closeDb, runMigrations } from '../../db/index.js';
import { createAgentGroup } from '../../db/agent-groups.js';
import { createMessagingGroup, createMessagingGroupAgent } from '../../db/messaging-groups.js';
import { upsertUser } from './db/users.js';
import { grantRole } from './db/user-roles.js';

vi.mock('../../container-runner.js', () => ({
  wakeContainer: vi.fn().mockResolvedValue(undefined),
  isContainerRunning: vi.fn().mockReturnValue(false),
  getActiveContainerCount: vi.fn().mockReturnValue(0),
  killContainer: vi.fn(),
}));

const deliverMock = vi.fn().mockResolvedValue('plat-msg-id');
vi.mock('../../delivery.js', () => ({
  getDeliveryAdapter: () => ({
    deliver: deliverMock,
  }),
}));

vi.mock('./user-dm.js', () => ({
  ensureUserDm: vi.fn(async (userId: string) => {
    const { getDb } = await import('../../db/connection.js');
    const stmt = getDb().prepare(
      `SELECT mg.* FROM messaging_groups mg
         JOIN user_dms ud ON ud.messaging_group_id = mg.id
        WHERE ud.user_id = ?`,
    );
    stmt.bind([userId]);
    const row: any = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }),
}));

vi.mock('../../config.js', async () => {
  const actual = await vi.importActual('../../config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-test-sender-approval' };
});

const TEST_DIR = '/tmp/nanoclaw-test-sender-approval';

function now() {
  return new Date().toISOString();
}

function queryAll(db: any, sql: string): any[] {
  const stmt = db.prepare(sql);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(db: any, sql: string, params?: any[]): any {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const row: any = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return row;
}

beforeEach(async () => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const db = await initTestDb();
  runMigrations(db);

  await import('./index.js');

  createAgentGroup({ id: 'ag-1', name: 'Agent', folder: 'agent', agent_provider: null, created_at: now() });

  createMessagingGroup({
    id: 'mg-chat',
    channel_type: 'telegram',
    platform_id: 'chat-123',
    name: 'Group Chat',
    is_group: 1,
    unknown_sender_policy: 'request_approval',
    created_at: now(),
  });
  createMessagingGroupAgent({
    id: 'mga-1',
    messaging_group_id: 'mg-chat',
    agent_group_id: 'ag-1',
    engage_mode: 'pattern',
    engage_pattern: '.',
    sender_scope: 'all',
    ignored_message_policy: 'drop',
    session_mode: 'shared',
    priority: 0,
    created_at: now(),
  });

  upsertUser({ id: 'telegram:owner', kind: 'telegram', display_name: 'Owner', created_at: now() });
  grantRole({
    user_id: 'telegram:owner',
    role: 'owner',
    agent_group_id: null,
    granted_by: null,
    granted_at: now(),
  });
  createMessagingGroup({
    id: 'mg-dm-owner',
    channel_type: 'telegram',
    platform_id: 'dm-owner',
    name: 'Owner DM',
    is_group: 0,
    unknown_sender_policy: 'public',
    created_at: now(),
  });
  const { getDb } = await import('../../db/connection.js');
  getDb().run(
    `INSERT INTO user_dms (user_id, channel_type, messaging_group_id, resolved_at)
     VALUES (?, ?, ?, ?)`,
    ['telegram:owner', 'telegram', 'mg-dm-owner', now()],
  );

  deliverMock.mockClear();
});

afterEach(() => {
  closeDb();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

function stranger(text: string) {
  return {
    channelType: 'telegram',
    platformId: 'chat-123',
    threadId: null,
    message: {
      id: `stranger-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'chat' as const,
      content: JSON.stringify({
        senderId: 'tg:stranger',
        senderName: 'Stranger',
        text,
      }),
      timestamp: now(),
    },
  };
}

describe('unknown-sender request_approval flow', () => {
  it('delivers an approval card on first unknown message', async () => {
    const { routeInbound } = await import('../../router.js');
    await routeInbound(stranger('hi'));

    await new Promise((r) => setTimeout(r, 10));

    expect(deliverMock).toHaveBeenCalledTimes(1);
    const [channel, platformId, thread, kind, content] = deliverMock.mock.calls[0];
    expect(channel).toBe('telegram');
    expect(platformId).toBe('dm-owner');
    expect(thread).toBeNull();
    expect(kind).toBe('chat-sdk');
    const payload = JSON.parse(content as string);
    expect(payload.type).toBe('ask_question');
    expect(payload.questionId).toMatch(/^nsa-/);

    const { getDb } = await import('../../db/connection.js');
    const rows = queryAll(getDb(), 'SELECT * FROM pending_sender_approvals');
    expect(rows).toHaveLength(1);
  });

  it('dedups a second message from the same stranger while pending', async () => {
    const { routeInbound } = await import('../../router.js');
    await routeInbound(stranger('hello'));
    await new Promise((r) => setTimeout(r, 10));
    await routeInbound(stranger('are you there?'));
    await new Promise((r) => setTimeout(r, 10));

    expect(deliverMock).toHaveBeenCalledTimes(1);
    const { getDb } = await import('../../db/connection.js');
    const row = queryOne(getDb(), 'SELECT COUNT(*) AS c FROM pending_sender_approvals');
    expect(row.c).toBe(1);
  });

  it('approve -> adds member and replays the original message', async () => {
    const { routeInbound } = await import('../../router.js');
    const { getResponseHandlers } = await import('../../response-registry.js');
    const { wakeContainer } = await import('../../container-runner.js');
    (wakeContainer as unknown as ReturnType<typeof vi.fn>).mockClear();

    await routeInbound(stranger('please let me in'));
    await new Promise((r) => setTimeout(r, 10));

    const { getDb } = await import('../../db/connection.js');
    const pending = queryOne(getDb(), 'SELECT id FROM pending_sender_approvals') as { id: string };
    expect(pending).toBeDefined();

    for (const handler of getResponseHandlers()) {
      const claimed = await handler({
        questionId: pending.id,
        value: 'approve',
        userId: 'owner',
        channelType: 'telegram',
        platformId: 'dm-owner',
        threadId: null,
      });
      if (claimed) break;
    }

    const member = queryOne(getDb(), 'SELECT 1 AS x FROM agent_group_members WHERE user_id = ? AND agent_group_id = ?', ['tg:stranger', 'ag-1']);
    expect(member).toBeDefined();

    const stillPending = queryOne(getDb(), 'SELECT COUNT(*) AS c FROM pending_sender_approvals');
    expect(stillPending.c).toBe(0);

    expect(wakeContainer).toHaveBeenCalled();
  });

  it('deny -> deletes the pending row without adding a member', async () => {
    const { routeInbound } = await import('../../router.js');
    const { getResponseHandlers } = await import('../../response-registry.js');

    await routeInbound(stranger('hello'));
    await new Promise((r) => setTimeout(r, 10));

    const { getDb } = await import('../../db/connection.js');
    const pending = queryOne(getDb(), 'SELECT id FROM pending_sender_approvals') as { id: string };
    expect(pending).toBeDefined();

    for (const handler of getResponseHandlers()) {
      const claimed = await handler({
        questionId: pending.id,
        value: 'reject',
        userId: 'owner',
        channelType: 'telegram',
        platformId: 'dm-owner',
        threadId: null,
      });
      if (claimed) break;
    }

    const count = queryOne(getDb(), 'SELECT COUNT(*) AS c FROM pending_sender_approvals');
    expect(count.c).toBe(0);
    const member = queryOne(getDb(), 'SELECT 1 AS x FROM agent_group_members WHERE user_id = ? AND agent_group_id = ?', ['tg:stranger', 'ag-1']);
    expect(member).toBeUndefined();
  });

  it('rejects clicks from an unauthorized user (prevents self-admit via forwarded card)', async () => {
    const { routeInbound } = await import('../../router.js');
    const { getResponseHandlers } = await import('../../response-registry.js');

    await routeInbound(stranger('can I play'));
    await new Promise((r) => setTimeout(r, 10));

    const { getDb } = await import('../../db/connection.js');
    const pending = queryOne(getDb(), 'SELECT id FROM pending_sender_approvals') as { id: string };
    expect(pending).toBeDefined();

    for (const handler of getResponseHandlers()) {
      const claimed = await handler({
        questionId: pending.id,
        value: 'approve',
        userId: 'random-bystander',
        channelType: 'telegram',
        platformId: 'dm-random',
        threadId: null,
      });
      if (claimed) break;
    }

    const member = queryOne(getDb(), 'SELECT 1 AS x FROM agent_group_members WHERE user_id = ? AND agent_group_id = ?', ['tg:stranger', 'ag-1']);
    expect(member).toBeUndefined();

    const stillPending = queryOne(getDb(), 'SELECT COUNT(*) AS c FROM pending_sender_approvals');
    expect(stillPending.c).toBe(1);
  });

  it('accepts a click from a global admin even if they are not the designated approver', async () => {
    upsertUser({ id: 'telegram:admin-bob', kind: 'telegram', display_name: 'Bob', created_at: now() });
    grantRole({
      user_id: 'telegram:admin-bob',
      role: 'admin',
      agent_group_id: null,
      granted_by: 'telegram:owner',
      granted_at: now(),
    });

    const { routeInbound } = await import('../../router.js');
    const { getResponseHandlers } = await import('../../response-registry.js');

    await routeInbound(stranger('knock knock'));
    await new Promise((r) => setTimeout(r, 10));

    const { getDb } = await import('../../db/connection.js');
    const pending = queryOne(getDb(), 'SELECT id FROM pending_sender_approvals') as { id: string };
    expect(pending).toBeDefined();

    for (const handler of getResponseHandlers()) {
      const claimed = await handler({
        questionId: pending.id,
        value: 'approve',
        userId: 'admin-bob',
        channelType: 'telegram',
        platformId: 'dm-bob',
        threadId: null,
      });
      if (claimed) break;
    }

    const member = queryOne(getDb(), 'SELECT 1 AS x FROM agent_group_members WHERE user_id = ? AND agent_group_id = ?', ['tg:stranger', 'ag-1']);
    expect(member).toBeDefined();
  });
});
