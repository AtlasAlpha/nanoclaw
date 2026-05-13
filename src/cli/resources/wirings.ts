import { registerResource } from '../crud.js';

registerResource({
  name: 'wiring',
  plural: 'wirings',
  table: 'messaging_group_agents',
  description:
    'Wiring — links a messaging group to an agent group with a trigger pattern and session isolation mode. Controls how messages flow from a chat/channel to an agent.',
  idColumn: 'id',
  columns: [
    { name: 'id', type: 'string', description: 'UUID.', generated: true },
    { name: 'messaging_group_id', type: 'string', description: 'The messaging group. References messaging_groups.id.' },
    { name: 'agent_group_id', type: 'string', description: 'The agent group. References agent_groups.id.' },
    {
      name: 'engage_mode',
      type: 'string',
      description: 'How the agent is triggered.',
      enum: ['pattern', 'mention', 'mention-sticky'],
      updatable: true,
    },
    { name: 'engage_pattern', type: 'string', description: 'Regex; "." means match every message.', updatable: true },
    {
      name: 'sender_scope',
      type: 'string',
      description: '"all" or "known" — who can interact.',
      enum: ['all', 'known'],
      updatable: true,
    },
    {
      name: 'session_mode',
      type: 'string',
      description: '"shared", "per-thread", or "agent-shared".',
      enum: ['shared', 'per-thread', 'agent-shared'],
      updatable: true,
    },
    { name: 'priority', type: 'number', description: 'Routing priority. Higher = preferred.', updatable: true },
    { name: 'created_at', type: 'string', description: 'Auto-set.', generated: true },
  ],
  operations: { list: 'open', get: 'open' },
});
