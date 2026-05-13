import { getDb } from '../../db/connection.js';
import { registerResource } from '../crud.js';

registerResource({
  name: 'member',
  plural: 'members',
  table: 'agent_group_members',
  description: 'Agent group member — grants an unprivileged user permission to interact with an agent group. Users with admin or owner roles on the group are implicitly members.',
  idColumn: 'user_id',
  columns: [
    { name: 'user_id', type: 'string', description: 'The user to grant membership. Must reference users.id.' },
    { name: 'agent_group_id', type: 'string', description: 'The agent group to grant access to. Must reference agent_groups.id.' },
    { name: 'added_by', type: 'string', description: 'User ID of whoever added this member.' },
    { name: 'added_at', type: 'string', description: 'ISO 8601 timestamp.' },
  ],
  operations: { list: 'open' },
  customOperations: {
    add: {
      access: 'approval',
      description: 'Add a user as a member of an agent group. Use --user-id and --agent-group-id.',
      handler: async (args) => {
        const userId = args.user_id as string;
        const groupId = args.agent_group_id as string;
        const addedBy = (args.added_by as string) ?? null;
        if (!userId) throw new Error('--user-id is required');
        if (!groupId) throw new Error('--agent-group-id is required');
        getDb().run("INSERT OR IGNORE INTO agent_group_members (user_id, agent_group_id, added_by, added_at) VALUES (?, ?, ?, datetime('now'))", [userId, groupId, addedBy] as never);
        return { user_id: userId, agent_group_id: groupId };
      },
    },
    remove: {
      access: 'approval',
      description: 'Remove a user from an agent group. Use --user-id and --agent-group-id.',
      handler: async (args) => {
        const userId = args.user_id as string;
        const groupId = args.agent_group_id as string;
        if (!userId) throw new Error('--user-id is required');
        if (!groupId) throw new Error('--agent-group-id is required');
        getDb().run('DELETE FROM agent_group_members WHERE user_id = ? AND agent_group_id = ?', [userId, groupId] as never);
        return { removed: { user_id: userId, agent_group_id: groupId } };
      },
    },
  },
});
