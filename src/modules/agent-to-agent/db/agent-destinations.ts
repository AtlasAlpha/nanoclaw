import type { AgentDestination } from '../../../types.js';
import { getDb } from '../../../db/connection.js';
import { queryAll, queryOne } from '../../../db/sql-helpers.js';

export function createDestination(row: AgentDestination): void {
  getDb().run(
    `INSERT INTO agent_destinations (agent_group_id, local_name, target_type, target_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [row.agent_group_id, row.local_name, row.target_type, row.target_id, row.created_at],
  );
}

export function getDestinations(agentGroupId: string): AgentDestination[] {
  return queryAll<AgentDestination>(getDb(), 'SELECT * FROM agent_destinations WHERE agent_group_id = ?', [
    agentGroupId,
  ]);
}

export function getDestinationByName(agentGroupId: string, localName: string): AgentDestination | undefined {
  return queryOne<AgentDestination>(
    getDb(),
    'SELECT * FROM agent_destinations WHERE agent_group_id = ? AND local_name = ?',
    [agentGroupId, localName],
  );
}

export function getDestinationByTarget(
  agentGroupId: string,
  targetType: 'channel' | 'agent',
  targetId: string,
): AgentDestination | undefined {
  return queryOne<AgentDestination>(
    getDb(),
    'SELECT * FROM agent_destinations WHERE agent_group_id = ? AND target_type = ? AND target_id = ?',
    [agentGroupId, targetType, targetId],
  );
}

export function hasDestination(agentGroupId: string, targetType: 'channel' | 'agent', targetId: string): boolean {
  const row = queryOne<Record<string, unknown>>(
    getDb(),
    'SELECT 1 FROM agent_destinations WHERE agent_group_id = ? AND target_type = ? AND target_id = ? LIMIT 1',
    [agentGroupId, targetType, targetId],
  );
  return !!row;
}

export function deleteDestination(agentGroupId: string, localName: string): void {
  getDb().run('DELETE FROM agent_destinations WHERE agent_group_id = ? AND local_name = ?', [agentGroupId, localName]);
}

export function deleteAllDestinationsTouching(agentGroupId: string): void {
  getDb().run('DELETE FROM agent_destinations WHERE agent_group_id = ? OR (target_type = ? AND target_id = ?)', [
    agentGroupId,
    'agent',
    agentGroupId,
  ]);
}

export function getDestinationReferencers(targetAgentGroupId: string): string[] {
  const rows = queryAll<{ agent_group_id: string }>(
    getDb(),
    "SELECT DISTINCT agent_group_id FROM agent_destinations WHERE target_type = 'agent' AND target_id = ? AND agent_group_id != ?",
    [targetAgentGroupId, targetAgentGroupId],
  );
  return rows.map((r) => r.agent_group_id);
}

export function normalizeName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unnamed'
  );
}
