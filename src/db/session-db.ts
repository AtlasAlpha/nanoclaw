/**
 * SQL operations on per-session inbound/outbound DBs.
 *
 * These are NOT the central app DB — they're the cross-mount SQLite files
 * shared between host and container. Callers own the connection lifecycle
 * (open-write-close per op). See session-manager.ts header for invariants.
 *
 * sql.js is in-memory: every write operation must export() and persist
 * to disk before close. Read-only operations just close.
 * Call persistDb(db, dbPath) before db.close() for any write operation.
 */
import fs from 'fs';
import path from 'path';
import type { Database } from 'sql.js';

import { getSqlJs } from './sqlite-init.js';
import { queryAll, queryOne, run } from './sql-helpers.js';
import { INBOUND_SCHEMA, OUTBOUND_SCHEMA } from './schema.js';

export function persistDb(db: Database, dbPath: string): void {
  const data = db.export();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(data));
}

/** Create empty DB file if it doesn't exist. */
function ensureDbFile(dbPath: string): void {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, Buffer.alloc(0));
  }
}

function openDb(dbPath: string, readOnly = false): Database {
  ensureDbFile(dbPath);
  const SQL = getSqlJs();
  const content = fs.readFileSync(dbPath);
  const db = new SQL.Database(content.length > 0 ? content : undefined);
  db.run('PRAGMA journal_mode = DELETE');
  db.run('PRAGMA busy_timeout = 5000');
  return { db, readOnly } as unknown as Database;
}

/** Apply the inbound or outbound schema to a DB file. Idempotent. */
export function ensureSchema(dbPath: string, schema: 'inbound' | 'outbound'): void {
  ensureDbFile(dbPath);
  const SQL = getSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA journal_mode = DELETE');
  db.run(schema === 'inbound' ? INBOUND_SCHEMA : OUTBOUND_SCHEMA);
  if (schema === 'inbound') {
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_in_pending_due ON messages_in(status, trigger, process_after)');
  }
  persistDb(db, dbPath);
  db.close();
}

/** Open the inbound DB for a session (host reads/writes). */
export function openInboundDb(dbPath: string): Database {
  ensureDbFile(dbPath);
  const SQL = getSqlJs();
  const content = fs.readFileSync(dbPath);
  const db = new SQL.Database(content.length > 0 ? content : undefined);
  db.run('PRAGMA journal_mode = DELETE');
  db.run('PRAGMA busy_timeout = 5000');
  return db;
}

/** Open the outbound DB for a session (host reads only). */
export function openOutboundDb(dbPath: string): Database {
  return openInboundDb(dbPath);
}

/** Open the outbound DB for a session with write access. Only safe to call when no container is running. */
export function openOutboundDbRw(dbPath: string): Database {
  return openInboundDb(dbPath);
}

export function upsertSessionRouting(
  db: Database,
  routing: { channel_type: string | null; platform_id: string | null; thread_id: string | null },
): void {
  db.run(
    `INSERT INTO session_routing (id, channel_type, platform_id, thread_id)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       channel_type = excluded.channel_type,
       platform_id  = excluded.platform_id,
       thread_id    = excluded.thread_id`,
    [routing.channel_type, routing.platform_id, routing.thread_id],
  );
}

export interface DestinationRow {
  name: string;
  display_name: string | null;
  type: 'channel' | 'agent';
  channel_type: string | null;
  platform_id: string | null;
  agent_group_id: string | null;
}

export function replaceDestinations(db: Database, entries: DestinationRow[]): void {
  db.run('BEGIN');
  try {
    db.run('DELETE FROM destinations');
    for (const row of entries) {
      db.run(
        `INSERT INTO destinations (name, display_name, type, channel_type, platform_id, agent_group_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row.name, row.display_name, row.type, row.channel_type, row.platform_id, row.agent_group_id],
      );
    }
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// messages_in
// ---------------------------------------------------------------------------

/**
 * Next even seq number for host-owned inbound.db.
 *
 * Exported so the scheduling module's task helpers can maintain the
 * host-writes-even-seq invariant without duplicating the logic. Not part of
 * the general public API — imported by `src/modules/scheduling/db.ts` only.
 */
export function nextEvenSeq(db: Database): number {
  const row = queryOne<{ m: number }>(db, 'SELECT COALESCE(MAX(seq), 0) AS m FROM messages_in');
  const maxSeq = row?.m ?? 0;
  return maxSeq < 2 ? 2 : maxSeq + 2 - (maxSeq % 2);
}

export function insertMessage(
  db: Database,
  message: {
    id: string;
    kind: string;
    timestamp: string;
    platformId: string | null;
    channelType: string | null;
    threadId: string | null;
    content: string;
    processAfter: string | null;
    recurrence: string | null;
    trigger?: 0 | 1;
  },
): void {
  db.run(
    `INSERT INTO messages_in (id, seq, kind, timestamp, status, platform_id, channel_type, thread_id, content, process_after, recurrence, series_id, trigger)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      nextEvenSeq(db),
      message.kind,
      message.timestamp,
      message.platformId ?? null,
      message.channelType ?? null,
      message.threadId ?? null,
      message.content,
      message.processAfter ?? null,
      message.recurrence ?? null,
      message.id,
      message.trigger ?? 1,
    ],
  );
}

export function countDueMessages(db: Database): number {
  const row = queryOne<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM messages_in
     WHERE status = 'pending'
       AND trigger = 1
       AND (process_after IS NULL OR process_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
  );
  return row?.count ?? 0;
}

export function markMessageFailed(db: Database, messageId: string): void {
  db.run("UPDATE messages_in SET status = 'failed' WHERE id = ?", [messageId]);
}

export function retryWithBackoff(db: Database, messageId: string, backoffSec: number): void {
  const offset = `+${backoffSec} seconds`;
  db.run(
    "UPDATE messages_in SET tries = tries + 1, process_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) WHERE id = ?",
    [offset, messageId],
  );
}

export function getMessageForRetry(
  db: Database,
  messageId: string,
  status: string,
): { id: string; tries: number; processAfter: string | null } | undefined {
  return queryOne<{ id: string; tries: number; processAfter: string | null }>(
    db,
    'SELECT id, tries, process_after as processAfter FROM messages_in WHERE id = ? AND status = ?',
    [messageId, status],
  );
}

export function syncProcessingAcks(inDb: Database, outDb: Database): void {
  const completed = queryAll<{ message_id: string }>(
    outDb,
    "SELECT message_id FROM processing_ack WHERE status IN ('completed', 'failed')",
  );

  if (completed.length === 0) return;

  inDb.run('BEGIN');
  try {
    for (const { message_id } of completed) {
      inDb.run("UPDATE messages_in SET status = 'completed' WHERE id = ? AND status != 'completed'", [message_id]);
    }
    inDb.run('COMMIT');
  } catch (err) {
    inDb.run('ROLLBACK');
    throw err;
  }
}

export function getStuckProcessingIds(outDb: Database): string[] {
  const rows = queryAll<{ message_id: string }>(
    outDb,
    "SELECT message_id FROM processing_ack WHERE status = 'processing'",
  );
  return rows.map((r) => r.message_id);
}

export interface ProcessingClaim {
  message_id: string;
  status_changed: string;
}

/** Return processing_ack rows still in 'processing' with their claim timestamps. */
export function getProcessingClaims(outDb: Database): ProcessingClaim[] {
  return queryAll<ProcessingClaim>(
    outDb,
    "SELECT message_id, status_changed FROM processing_ack WHERE status = 'processing'",
  );
}

/**
 * Delete orphan 'processing' rows. Called by the host after killing a
 * container so the leftover claim doesn't trip claim-stuck on the next sweep
 * tick (which would kill the freshly respawned container before its
 * agent-runner can run its own startup cleanup).
 *
 * Safe because the host only writes to outbound.db when no container is
 * running (we just killed it). Returns the number of rows deleted.
 */
export function deleteOrphanProcessingClaims(outDb: Database): number {
  outDb.run("DELETE FROM processing_ack WHERE status = 'processing'");
  return outDb.getRowsModified();
}

export interface ContainerState {
  current_tool: string | null;
  tool_declared_timeout_ms: number | null;
  tool_started_at: string | null;
}

/**
 * Read the container's current tool-in-flight state, if any. Returns null
 * when either the table doesn't exist yet (older session DB) or no tool is
 * active. Host sweep reads this to widen stuck-detection tolerance while
 * Bash is running with a long declared timeout.
 */
export function getContainerState(outDb: Database): ContainerState | null {
  try {
    const row = queryOne<ContainerState>(
      outDb,
      'SELECT current_tool, tool_declared_timeout_ms, tool_started_at FROM container_state WHERE id = 1',
    );
    return row ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// messages_out (read-only from host)
// ---------------------------------------------------------------------------

export interface OutboundMessage {
  id: string;
  kind: string;
  platform_id: string | null;
  channel_type: string | null;
  thread_id: string | null;
  content: string;
}

export function getDueOutboundMessages(db: Database): OutboundMessage[] {
  return queryAll<OutboundMessage>(
    db,
    `SELECT * FROM messages_out
     WHERE (deliver_after IS NULL OR deliver_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ORDER BY timestamp ASC`,
  );
}

// ---------------------------------------------------------------------------
// delivered
// ---------------------------------------------------------------------------

export function getDeliveredIds(db: Database): Set<string> {
  const rows = queryAll<{ message_out_id: string }>(db, 'SELECT message_out_id FROM delivered');
  return new Set(rows.map((r) => r.message_out_id));
}

export function markDelivered(db: Database, messageOutId: string, platformMessageId: string | null): void {
  db.run(
    "INSERT OR IGNORE INTO delivered (message_out_id, platform_message_id, status, delivered_at) VALUES (?, ?, 'delivered', datetime('now'))",
    [messageOutId, platformMessageId ?? null],
  );
}

export function markDeliveryFailed(db: Database, messageOutId: string): void {
  db.run(
    "INSERT OR IGNORE INTO delivered (message_out_id, platform_message_id, status, delivered_at) VALUES (?, NULL, 'failed', datetime('now'))",
    [messageOutId],
  );
}

/** Ensure the delivered table has columns added after initial schema. */
export function migrateDeliveredTable(db: Database): void {
  const cols = new Set(queryAll<{ name: string }>(db, "PRAGMA table_info('delivered')").map((c) => c.name));
  if (!cols.has('platform_message_id')) {
    db.run('ALTER TABLE delivered ADD COLUMN platform_message_id TEXT');
  }
  if (!cols.has('status')) {
    db.run("ALTER TABLE delivered ADD COLUMN status TEXT NOT NULL DEFAULT 'delivered'");
  }
}

// Adds columns added to messages_in after the initial v2 schema to
// pre-existing session DBs. No-op on fresh installs where the columns are
// in the baseline schema. Backfills existing rows so invariants hold.
export function migrateMessagesInTable(db: Database): void {
  const cols = new Set(queryAll<{ name: string }>(db, "PRAGMA table_info('messages_in')").map((c) => c.name));
  if (!cols.has('series_id')) {
    db.run('ALTER TABLE messages_in ADD COLUMN series_id TEXT');
    db.run('UPDATE messages_in SET series_id = id WHERE series_id IS NULL');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_in_series ON messages_in(series_id)');
  }
  if (!cols.has('trigger')) {
    db.run('ALTER TABLE messages_in ADD COLUMN trigger INTEGER NOT NULL DEFAULT 1');
  }
}
