import type { UserDm } from '../../../types.js';
import { getDb } from '../../../db/connection.js';
import { queryOne, queryAll } from '../../../db/sql-helpers.js';

export function upsertUserDm(row: UserDm): void {
  getDb().run(
    `INSERT INTO user_dms (user_id, channel_type, messaging_group_id, resolved_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, channel_type) DO UPDATE SET
       messaging_group_id = excluded.messaging_group_id,
       resolved_at = excluded.resolved_at`,
    [row.user_id, row.channel_type, row.messaging_group_id, row.resolved_at],
  );
}

export function getUserDm(userId: string, channelType: string): UserDm | undefined {
  return queryOne<UserDm>(getDb(), 'SELECT * FROM user_dms WHERE user_id = ? AND channel_type = ?', [
    userId,
    channelType,
  ]);
}

export function getUserDmsForUser(userId: string): UserDm[] {
  return queryAll<UserDm>(getDb(), 'SELECT * FROM user_dms WHERE user_id = ?', [userId]);
}

export function deleteUserDm(userId: string, channelType: string): void {
  getDb().run('DELETE FROM user_dms WHERE user_id = ? AND channel_type = ?', [userId, channelType]);
}
