import type { AgentGroupMember } from '../../../types.js';
import { getDb } from '../../../db/connection.js';
import { queryOne, queryAll } from '../../../db/sql-helpers.js';
import { isAdminOfAgentGroup, isGlobalAdmin, isOwner } from './user-roles.js';

export function addMember(row: AgentGroupMember): void {
  getDb().run(
    `INSERT OR IGNORE INTO agent_group_members (user_id, agent_group_id, added_by, added_at)
     VALUES (?, ?, ?, ?)`,
    [row.user_id, row.agent_group_id, row.added_by, row.added_at],
  );
}

export function removeMember(userId: string, agentGroupId: string): void {
  getDb().run('DELETE FROM agent_group_members WHERE user_id = ? AND agent_group_id = ?', [userId, agentGroupId]);
}

export function getMembers(agentGroupId: string): AgentGroupMember[] {
  return queryAll<AgentGroupMember>(
    getDb(),
    'SELECT * FROM agent_group_members WHERE agent_group_id = ? ORDER BY added_at',
    [agentGroupId],
  );
}

/**
 * Is the user "known" in this agent group?
 * Owner, global admin, and scoped admin are implicitly members.
 */
export function isMember(userId: string, agentGroupId: string): boolean {
  if (isOwner(userId) || isGlobalAdmin(userId) || isAdminOfAgentGroup(userId, agentGroupId)) {
    return true;
  }
  const row = queryOne<Record<string, unknown>>(
    getDb(),
    'SELECT 1 FROM agent_group_members WHERE user_id = ? AND agent_group_id = ? LIMIT 1',
    [userId, agentGroupId],
  );
  return !!row;
}

/** Direct row lookup — does not honor the admin/owner implicit-membership rule. */
export function hasMembershipRow(userId: string, agentGroupId: string): boolean {
  const row = queryOne<Record<string, unknown>>(
    getDb(),
    'SELECT 1 FROM agent_group_members WHERE user_id = ? AND agent_group_id = ? LIMIT 1',
    [userId, agentGroupId],
  );
  return !!row;
}
