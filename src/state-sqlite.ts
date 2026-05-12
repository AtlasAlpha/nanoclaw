import crypto from 'crypto';

import type { Database } from 'sql.js';
import type { StateAdapter, QueueEntry } from 'chat';
import { queryOne, queryAll } from './db/sql-helpers.js';
import { getDb } from './db/connection.js';

interface Lock {
  threadId: string;
  token: string;
  expiresAt: number;
}

export class SqliteStateAdapter implements StateAdapter {
  private db!: Database;

  async connect(): Promise<void> {
    this.db = getDb();
    this.cleanup();
  }

  async disconnect(): Promise<void> {}

  // --- Key-value ---

  async get<T = unknown>(key: string): Promise<T | null> {
    this.cleanup();
    const row = queryOne<{ value: string; expires_at: number | null }>(
      this.db,
      'SELECT value, expires_at FROM chat_sdk_kv WHERE key = ?',
      [key],
    );
    if (!row) return null;
    if (row.expires_at && row.expires_at < Date.now()) {
      this.db.run('DELETE FROM chat_sdk_kv WHERE key = ?', [key]);
      return null;
    }
    return JSON.parse(row.value) as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    this.db.run('INSERT OR REPLACE INTO chat_sdk_kv (key, value, expires_at) VALUES (?, ?, ?)', [
      key,
      JSON.stringify(value),
      expiresAt,
    ]);
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    const existing = queryOne<{ expires_at: number | null }>(
      this.db,
      'SELECT expires_at FROM chat_sdk_kv WHERE key = ?',
      [key],
    );
    if (existing?.expires_at && existing.expires_at < Date.now()) {
      this.db.run('DELETE FROM chat_sdk_kv WHERE key = ?', [key]);
    }
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    this.db.run('INSERT OR IGNORE INTO chat_sdk_kv (key, value, expires_at) VALUES (?, ?, ?)', [
      key,
      JSON.stringify(value),
      expiresAt,
    ]);
    return this.db.getRowsModified() > 0;
  }

  async delete(key: string): Promise<void> {
    this.db.run('DELETE FROM chat_sdk_kv WHERE key = ?', [key]);
  }

  // --- Subscriptions ---

  async subscribe(threadId: string): Promise<void> {
    this.db.run('INSERT OR REPLACE INTO chat_sdk_subscriptions (thread_id) VALUES (?)', [threadId]);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.db.run('DELETE FROM chat_sdk_subscriptions WHERE thread_id = ?', [threadId]);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    const row = queryOne<{ '1': number }>(
      this.db,
      'SELECT 1 FROM chat_sdk_subscriptions WHERE thread_id = ? LIMIT 1',
      [threadId],
    );
    return !!row;
  }

  // --- Locks ---

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const now = Date.now();
    const token = crypto.randomUUID();
    const expiresAt = now + ttlMs;
    this.db.run('DELETE FROM chat_sdk_locks WHERE thread_id = ? AND expires_at < ?', [threadId, now]);
    this.db.run('INSERT OR IGNORE INTO chat_sdk_locks (thread_id, token, expires_at) VALUES (?, ?, ?)', [
      threadId,
      token,
      expiresAt,
    ]);
    if (this.db.getRowsModified() === 0) return null;
    return { threadId, token, expiresAt };
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.db.run('DELETE FROM chat_sdk_locks WHERE thread_id = ? AND token = ?', [lock.threadId, lock.token]);
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const newExpiry = Date.now() + ttlMs;
    this.db.run('UPDATE chat_sdk_locks SET expires_at = ? WHERE thread_id = ? AND token = ?', [
      newExpiry,
      lock.threadId,
      lock.token,
    ]);
    if (this.db.getRowsModified() > 0) {
      lock.expiresAt = newExpiry;
      return true;
    }
    return false;
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.db.run('DELETE FROM chat_sdk_locks WHERE thread_id = ?', [threadId]);
  }

  // --- Lists ---

  async appendToList(key: string, value: unknown, options?: { maxLength?: number; ttlMs?: number }): Promise<void> {
    const expiresAt = options?.ttlMs ? Date.now() + options.ttlMs : null;
    const maxRow = queryOne<{ maxIdx: number | null }>(
      this.db,
      'SELECT MAX(idx) as maxIdx FROM chat_sdk_lists WHERE key = ?',
      [key],
    );
    const nextIdx = (maxRow?.maxIdx ?? -1) + 1;
    this.db.run('INSERT INTO chat_sdk_lists (key, idx, value, expires_at) VALUES (?, ?, ?, ?)', [
      key,
      nextIdx,
      JSON.stringify(value),
      expiresAt,
    ]);
    if (options?.maxLength) {
      const cutoff = nextIdx - options.maxLength;
      if (cutoff >= 0) {
        this.db.run('DELETE FROM chat_sdk_lists WHERE key = ? AND idx <= ?', [key, cutoff]);
      }
    }
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    const now = Date.now();
    const rows = queryAll<{ value: string }>(
      this.db,
      'SELECT value FROM chat_sdk_lists WHERE key = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY idx ASC',
      [key, now],
    );
    return rows.map((r) => JSON.parse(r.value) as T);
  }

  // --- Queue ---

  async enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
    const key = `queue:${threadId}`;
    await this.appendToList(key, entry, { maxLength: maxSize });
    return await this.queueDepth(threadId);
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    const key = `queue:${threadId}`;
    const row = queryOne<{ idx: number; value: string }>(
      this.db,
      'SELECT idx, value FROM chat_sdk_lists WHERE key = ? ORDER BY idx ASC LIMIT 1',
      [key],
    );
    if (!row) return null;
    this.db.run('DELETE FROM chat_sdk_lists WHERE key = ? AND idx = ?', [key, row.idx]);
    return JSON.parse(row.value) as QueueEntry;
  }

  async queueDepth(threadId: string): Promise<number> {
    const key = `queue:${threadId}`;
    const row = queryOne<{ count: number }>(
      this.db,
      'SELECT COUNT(*) as count FROM chat_sdk_lists WHERE key = ?',
      [key],
    );
    return row!.count;
  }

  // --- Cleanup ---

  private cleanup(): void {
    const now = Date.now();
    this.db.run('DELETE FROM chat_sdk_kv WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
    this.db.run('DELETE FROM chat_sdk_locks WHERE expires_at < ?', [now]);
    this.db.run('DELETE FROM chat_sdk_lists WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
  }
}
