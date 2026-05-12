import type { AgentGroup } from '../types.js';
import { getDb } from './connection.js';
import { queryAll, queryOne } from './sql-helpers.js';

export function createAgentGroup(group: AgentGroup): void {
  getDb().run(
    `INSERT INTO agent_groups (id, name, folder, agent_provider, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [group.id, group.name, group.folder, group.agent_provider, group.created_at],
  );
}

export function getAgentGroup(id: string): AgentGroup | undefined {
  return queryOne<AgentGroup>(getDb(), 'SELECT * FROM agent_groups WHERE id = ?', [id]);
}

export function getAgentGroupByFolder(folder: string): AgentGroup | undefined {
  return queryOne<AgentGroup>(getDb(), 'SELECT * FROM agent_groups WHERE folder = ?', [folder]);
}

export function getAllAgentGroups(): AgentGroup[] {
  return queryAll<AgentGroup>(getDb(), 'SELECT * FROM agent_groups ORDER BY name');
}

export function updateAgentGroup(id: string, updates: Partial<Pick<AgentGroup, 'name' | 'agent_provider'>>): void {
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
  getDb().run(`UPDATE agent_groups SET ${fields.join(', ')} WHERE id = ?`, params as never);
}

export function deleteAgentGroup(id: string): void {
  getDb().run('DELETE FROM agent_groups WHERE id = ?', [id]);
}
