import type { PendingApproval, PendingQuestion, Session } from '../types.js';
import { getDb, hasTable } from './connection.js';
import { queryAll, queryOne } from './sql-helpers.js';

// ── Sessions ──

const sessionInsertSql = `INSERT INTO sessions (id, agent_group_id, messaging_group_id, thread_id, agent_provider, status, container_status, last_active, created_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function createSession(session: Session): void {
  getDb().run(sessionInsertSql, [
    session.id, session.agent_group_id, session.messaging_group_id,
    session.thread_id, session.agent_provider, session.status,
    session.container_status, session.last_active, session.created_at,
  ]);
}

export function getSession(id: string): Session | undefined {
  return queryOne<Session>(getDb(), 'SELECT * FROM sessions WHERE id = ?', [id]);
}

export function findSession(messagingGroupId: string, threadId: string | null): Session | undefined {
  if (threadId) {
    return queryOne<Session>(
      getDb(),
      'SELECT * FROM sessions WHERE messaging_group_id = ? AND thread_id = ? AND status = ?',
      [messagingGroupId, threadId, 'active'],
    );
  }
  return queryOne<Session>(
    getDb(),
    'SELECT * FROM sessions WHERE messaging_group_id = ? AND thread_id IS NULL AND status = ?',
    [messagingGroupId, 'active'],
  );
}

/**
 * Session lookup scoped to a specific agent group. Needed when multiple
 * agents are wired to the same messaging group + thread (fan-out) — the
 * plain `findSession` would return whichever agent's session happened to
 * be first and route to the wrong container.
 */
export function findSessionForAgent(
  agentGroupId: string,
  messagingGroupId: string,
  threadId: string | null,
): Session | undefined {
  if (threadId) {
    return queryOne<Session>(
      getDb(),
      "SELECT * FROM sessions WHERE agent_group_id = ? AND messaging_group_id = ? AND thread_id = ? AND status = 'active'",
      [agentGroupId, messagingGroupId, threadId],
    );
  }
  return queryOne<Session>(
    getDb(),
    "SELECT * FROM sessions WHERE agent_group_id = ? AND messaging_group_id = ? AND thread_id IS NULL AND status = 'active'",
    [agentGroupId, messagingGroupId],
  );
}

/** Find an active session scoped to an agent group (ignoring messaging group). */
export function findSessionByAgentGroup(agentGroupId: string): Session | undefined {
  return queryOne<Session>(
    getDb(),
    "SELECT * FROM sessions WHERE agent_group_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [agentGroupId],
  );
}

export function getSessionsByAgentGroup(agentGroupId: string): Session[] {
  return queryAll<Session>(getDb(), 'SELECT * FROM sessions WHERE agent_group_id = ?', [agentGroupId]);
}

export function getActiveSessions(): Session[] {
  return queryAll<Session>(getDb(), "SELECT * FROM sessions WHERE status = 'active'");
}

export function getRunningSessions(): Session[] {
  return queryAll<Session>(getDb(), "SELECT * FROM sessions WHERE container_status IN ('running', 'idle')");
}

export function updateSession(
  id: string,
  updates: Partial<Pick<Session, 'status' | 'container_status' | 'last_active' | 'agent_provider'>>,
): void {
  const fields: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }
  if (fields.length === 0) return;

  params.push(id);
  getDb().run(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, params as never);
}

export function deleteSession(id: string): void {
  getDb().run('DELETE FROM sessions WHERE id = ?', [id]);
}

// ── Pending Questions ──

/**
 * Insert a pending question row. Idempotent: when delivery fails and retries,
 * the second attempt calls this with the same question_id — without `OR
 * IGNORE` that would throw UNIQUE and prevent the retry from reaching the
 * actual send step. Returns true if a new row was inserted.
 */
export function createPendingQuestion(pq: PendingQuestion): boolean {
  getDb().run(
    `INSERT OR IGNORE INTO pending_questions (question_id, session_id, message_out_id, platform_id, channel_type, thread_id, title, options_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      pq.question_id, pq.session_id, pq.message_out_id,
      pq.platform_id, pq.channel_type, pq.thread_id,
      pq.title, JSON.stringify(pq.options), pq.created_at,
    ],
  );
  return getDb().getRowsModified() > 0;
}

export function getPendingQuestion(questionId: string): PendingQuestion | undefined {
  const row = queryOne<Omit<PendingQuestion, 'options'> & { options_json: string }>(
    getDb(),
    'SELECT * FROM pending_questions WHERE question_id = ?',
    [questionId],
  );
  if (!row) return undefined;
  const { options_json, ...rest } = row;
  return { ...rest, options: JSON.parse(options_json) };
}

export function deletePendingQuestion(questionId: string): void {
  getDb().run('DELETE FROM pending_questions WHERE question_id = ?', [questionId]);
}

// ── Pending Approvals ──

/**
 * Insert a pending approval row. Idempotent for the same reason as
 * createPendingQuestion: delivery retries with the same approval_id must not
 * fail on UNIQUE before the send step gets a chance to succeed.
 */
export function createPendingApproval(
  pa: Partial<PendingApproval> &
    Pick<
      PendingApproval,
      'approval_id' | 'request_id' | 'action' | 'payload' | 'created_at' | 'title' | 'options_json'
    >,
): boolean {
  getDb().run(
    `INSERT OR IGNORE INTO pending_approvals
       (approval_id, session_id, request_id, action, payload, created_at,
        agent_group_id, channel_type, platform_id, platform_message_id, expires_at, status,
        title, options_json)
     VALUES
       (?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?)`,
    [
      pa.approval_id,
      pa.session_id ?? null,
      pa.request_id,
      pa.action,
      pa.payload,
      pa.created_at,
      pa.agent_group_id ?? null,
      pa.channel_type ?? null,
      pa.platform_id ?? null,
      pa.platform_message_id ?? null,
      pa.expires_at ?? null,
      pa.status ?? 'pending',
      pa.title,
      pa.options_json,
    ],
  );
  return getDb().getRowsModified() > 0;
}

export function getPendingApproval(approvalId: string): PendingApproval | undefined {
  return queryOne<PendingApproval>(
    getDb(),
    'SELECT * FROM pending_approvals WHERE approval_id = ?',
    [approvalId],
  );
}

export function updatePendingApprovalStatus(approvalId: string, status: PendingApproval['status']): void {
  getDb().run('UPDATE pending_approvals SET status = ? WHERE approval_id = ?', [status, approvalId]);
}

export function deletePendingApproval(approvalId: string): void {
  getDb().run('DELETE FROM pending_approvals WHERE approval_id = ?', [approvalId]);
}

export function getPendingApprovalsByAction(action: string): PendingApproval[] {
  return queryAll<PendingApproval>(getDb(), 'SELECT * FROM pending_approvals WHERE action = ?', [action]);
}

/**
 * Resolve ask_question render metadata (title + normalized options) for any
 * card, regardless of whether it was persisted as a pending_question (generic
 * ask_user_question) or a pending_approval (self-mod / OneCLI credential).
 */
export function getAskQuestionRender(
  id: string,
): { title: string; options: import('../channels/ask-question.js').NormalizedOption[] } | undefined {
  const q = getPendingQuestion(id);
  if (q) return { title: q.title, options: q.options };
  const a = queryOne<{ title: string; options_json: string }>(
    getDb(),
    'SELECT title, options_json FROM pending_approvals WHERE approval_id = ?',
    [id],
  );
  if (a?.title) return { title: a.title, options: JSON.parse(a.options_json) };

  // Channel-registration + unknown-sender approvals persist title/options_json
  // the same way pending_approvals does — just SELECT and return.
  if (hasTable(getDb(), 'pending_channel_approvals')) {
    const c = queryOne<{ title: string; options_json: string }>(
      getDb(),
      'SELECT title, options_json FROM pending_channel_approvals WHERE messaging_group_id = ?',
      [id],
    );
    if (c?.title) return { title: c.title, options: JSON.parse(c.options_json) };
  }

  if (hasTable(getDb(), 'pending_sender_approvals')) {
    const s = queryOne<{ title: string; options_json: string }>(
      getDb(),
      'SELECT title, options_json FROM pending_sender_approvals WHERE id = ?',
      [id],
    );
    if (s?.title) return { title: s.title, options: JSON.parse(s.options_json) };
  }

  return undefined;
}
