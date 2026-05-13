import { getDb } from '../../db/connection.js';
import { run } from '../../db/sql-helpers.js';
import { registerResource } from '../crud.js';

registerResource({
  name: 'destination',
  plural: 'destinations',
  table: 'agent_destinations',
  description:
    'Agent destination — per-agent routing entry and ACL. Each row authorizes an agent to send messages to a target (channel or another agent) and assigns a local name the agent uses to address it.',
  idColumn: 'agent_group_id',
  columns: [
    { name: 'agent_group_id', type: 'string', description: 'The agent that owns this destination.' },
    {
      name: 'local_name',
      type: 'string',
      description: 'Name the agent uses to address this target. Unique per agent.',
    },
    {
      name: 'target_type',
      type: 'string',
      description: '"channel" for messaging group targets, "agent" for agent-to-agent.',
      enum: ['channel', 'agent'],
    },
    { name: 'target_id', type: 'string', description: 'The target ID — messaging_groups.id or agent_groups.id.' },
    { name: 'created_at', type: 'string', description: 'Auto-set.' },
  ],
  operations: { list: 'open' },
  customOperations: {
    add: {
      access: 'approval',
      description: 'Add a destination for an agent. Use --agent-group-id, --local-name, --target-type, --target-id.',
      handler: async (args) => {
        const agentGroupId = args.agent_group_id as string;
        const localName = args.local_name as string;
        const targetType = args.target_type as string;
        const targetId = args.target_id as string;
        if (!agentGroupId) throw new Error('--agent-group-id is required');
        if (!localName) throw new Error('--local-name is required');
        if (!targetType || !['channel', 'agent'].includes(targetType))
          throw new Error('--target-type must be channel or agent');
        if (!targetId) throw new Error('--target-id is required');
        getDb().run(
          "INSERT INTO agent_destinations (agent_group_id, local_name, target_type, target_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
          [agentGroupId, localName, targetType, targetId] as never,
        );
        return { agent_group_id: agentGroupId, local_name: localName, target_type: targetType, target_id: targetId };
      },
    },
    remove: {
      access: 'approval',
      description: 'Remove a destination from an agent. Use --agent-group-id and --local-name.',
      handler: async (args) => {
        const agentGroupId = args.agent_group_id as string;
        const localName = args.local_name as string;
        if (!agentGroupId) throw new Error('--agent-group-id is required');
        if (!localName) throw new Error('--local-name is required');
        const result = run(getDb(), 'DELETE FROM agent_destinations WHERE agent_group_id = ? AND local_name = ?', [
          agentGroupId,
          localName,
        ]);
        if (result.changes === 0) throw new Error('destination not found');
        return { removed: { agent_group_id: agentGroupId, local_name: localName } };
      },
    },
  },
});
