import { getDb } from '../../db/connection.js';
import { queryAll } from '../../db/sql-helpers.js';
import { registerResource } from '../crud.js';

registerResource({
  name: 'role',
  plural: 'roles',
  table: 'user_roles',
  description:
    'Role grant on a user. Owner is always global. Admin can be global or scoped to an agent group. Admin @ A implies membership in A.',
  idColumn: 'user_id',
  columns: [
    { name: 'user_id', type: 'string', description: 'The user receiving the role.' },
    {
      name: 'role',
      type: 'string',
      description: 'Owner (global) or admin (global or scoped).',
      enum: ['owner', 'admin'],
    },
    { name: 'agent_group_id', type: 'string', description: 'Null for global roles, agent_groups.id for scoped admin.' },
    { name: 'granted_by', type: 'string', description: 'User ID of whoever granted this role.' },
    { name: 'granted_at', type: 'string', description: 'ISO 8601 timestamp.' },
  ],
  operations: { list: 'open' },
  customOperations: {
    grant: {
      access: 'approval',
      description: 'Grant a role to a user. Use --user-id, --role, and optionally --group for scoped admin.',
      handler: async (args) => {
        const userId = args.user_id as string;
        const role = args.role as string;
        const groupId = (args.group as string) ?? null;
        if (!userId) throw new Error('--user-id is required');
        if (!role || !['owner', 'admin'].includes(role)) throw new Error('--role must be owner or admin');
        if (role === 'owner' && groupId) throw new Error('owner role must be global — do not use --group');
        getDb().run(
          "INSERT OR IGNORE INTO user_roles (user_id, role, agent_group_id, granted_at) VALUES (?, ?, ?, datetime('now'))",
          [userId, role, groupId] as never,
        );
        return { user_id: userId, role, agent_group_id: groupId };
      },
    },
    revoke: {
      access: 'approval',
      description: 'Revoke a role from a user. Use --user-id, --role, and optionally --group.',
      handler: async (args) => {
        const userId = args.user_id as string;
        const role = args.role as string;
        const groupId = (args.group as string) ?? null;
        if (!userId) throw new Error('--user-id is required');
        if (!role || !['owner', 'admin'].includes(role)) throw new Error('--role must be owner or admin');
        const sql = groupId
          ? 'DELETE FROM user_roles WHERE user_id = ? AND role = ? AND agent_group_id = ?'
          : 'DELETE FROM user_roles WHERE user_id = ? AND role = ? AND agent_group_id IS NULL';
        const params = groupId ? [userId, role, groupId] : [userId, role];
        getDb().run(sql, params as never);
        return { revoked: { user_id: userId, role, agent_group_id: groupId } };
      },
    },
  },
});
