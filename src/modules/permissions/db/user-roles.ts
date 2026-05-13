import type { UserRole, UserRoleKind } from '../../../types.js';
import { getDb } from '../../../db/connection.js';
import { queryOne, queryAll } from '../../../db/sql-helpers.js';

/**
 * Grant a role. Owner rows must have agent_group_id = null (enforced here,
 * not by schema, so callers get a clean error path).
 */
export function grantRole(row: UserRole): void {
  if (row.role === 'owner' && row.agent_group_id !== null) {
    throw new Error('owner role must be global (agent_group_id = null)');
  }
  getDb().run(
    `INSERT INTO user_roles (user_id, role, agent_group_id, granted_by, granted_at)
     VALUES (?, ?, ?, ?, ?)`,
    [row.user_id, row.role, row.agent_group_id, row.granted_by, row.granted_at],
  );
}

export function revokeRole(userId: string, role: UserRoleKind, agentGroupId: string | null): void {
  if (agentGroupId === null) {
    getDb().run('DELETE FROM user_roles WHERE user_id = ? AND role = ? AND agent_group_id IS NULL', [userId, role]);
  } else {
    getDb().run('DELETE FROM user_roles WHERE user_id = ? AND role = ? AND agent_group_id = ?', [
      userId,
      role,
      agentGroupId,
    ]);
  }
}

export function getUserRoles(userId: string): UserRole[] {
  return queryAll<UserRole>(getDb(), 'SELECT * FROM user_roles WHERE user_id = ?', [userId]);
}

export function isOwner(userId: string): boolean {
  const row = queryOne<Record<string, unknown>>(
    getDb(),
    'SELECT 1 FROM user_roles WHERE user_id = ? AND role = ? AND agent_group_id IS NULL LIMIT 1',
    [userId, 'owner'],
  );
  return !!row;
}

export function isGlobalAdmin(userId: string): boolean {
  const row = queryOne<Record<string, unknown>>(
    getDb(),
    'SELECT 1 FROM user_roles WHERE user_id = ? AND role = ? AND agent_group_id IS NULL LIMIT 1',
    [userId, 'admin'],
  );
  return !!row;
}

export function isAdminOfAgentGroup(userId: string, agentGroupId: string): boolean {
  const row = queryOne<Record<string, unknown>>(
    getDb(),
    'SELECT 1 FROM user_roles WHERE user_id = ? AND role = ? AND agent_group_id = ? LIMIT 1',
    [userId, 'admin', agentGroupId],
  );
  return !!row;
}

/** Any admin privilege over this agent group: global admin OR scoped admin. */
export function hasAdminPrivilege(userId: string, agentGroupId: string): boolean {
  return isOwner(userId) || isGlobalAdmin(userId) || isAdminOfAgentGroup(userId, agentGroupId);
}

export function getOwners(): UserRole[] {
  return queryAll<UserRole>(
    getDb(),
    'SELECT * FROM user_roles WHERE role = ? AND agent_group_id IS NULL ORDER BY granted_at',
    ['owner'],
  );
}

export function hasAnyOwner(): boolean {
  const row = queryOne<Record<string, unknown>>(
    getDb(),
    'SELECT 1 FROM user_roles WHERE role = ? AND agent_group_id IS NULL LIMIT 1',
    ['owner'],
  );
  return !!row;
}

export function getGlobalAdmins(): UserRole[] {
  return queryAll<UserRole>(
    getDb(),
    'SELECT * FROM user_roles WHERE role = ? AND agent_group_id IS NULL ORDER BY granted_at',
    ['admin'],
  );
}

export function getAdminsOfAgentGroup(agentGroupId: string): UserRole[] {
  return queryAll<UserRole>(
    getDb(),
    'SELECT * FROM user_roles WHERE role = ? AND agent_group_id = ? ORDER BY granted_at',
    ['admin', agentGroupId],
  );
}
