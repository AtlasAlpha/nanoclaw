import type { User } from '../../../types.js';
import { getDb } from '../../../db/connection.js';
import { queryOne, queryAll } from '../../../db/sql-helpers.js';

export function createUser(user: User): void {
  getDb().run(
    `INSERT INTO users (id, kind, display_name, created_at)
     VALUES (?, ?, ?, ?)`,
    [user.id, user.kind, user.display_name, user.created_at],
  );
}

export function upsertUser(user: User): void {
  getDb().run(
    `INSERT INTO users (id, kind, display_name, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, users.display_name)`,
    [user.id, user.kind, user.display_name, user.created_at],
  );
}

export function getUser(id: string): User | undefined {
  return queryOne<User>(getDb(), 'SELECT * FROM users WHERE id = ?', [id]);
}

export function getAllUsers(): User[] {
  return queryAll<User>(getDb(), 'SELECT * FROM users ORDER BY created_at');
}

export function updateDisplayName(id: string, displayName: string): void {
  getDb().run('UPDATE users SET display_name = ? WHERE id = ?', [displayName, id]);
}

export function deleteUser(id: string): void {
  getDb().run('DELETE FROM users WHERE id = ?', [id]);
}
