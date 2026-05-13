import { registerResource } from '../crud.js';

registerResource({
  name: 'approval',
  plural: 'approvals',
  table: 'pending_sender_approvals',
  description: 'Pending approval requests for unknown senders. Read-only view of who is waiting for access.',
  idColumn: 'id',
  columns: [
    { name: 'id', type: 'string', description: 'UUID.', generated: true },
    { name: 'messaging_group_id', type: 'string', description: 'Messaging group where the sender was seen.' },
    { name: 'agent_group_id', type: 'string', description: 'Agent group the sender wants access to.' },
    { name: 'sender_identity', type: 'string', description: 'Namespaced sender ID.' },
    { name: 'sender_name', type: 'string', description: 'Display name if available.' },
    { name: 'approver_user_id', type: 'string', description: 'Who was designated to approve.' },
    { name: 'created_at', type: 'string', description: 'Auto-set.', generated: true },
  ],
  operations: { list: 'open', get: 'open' },
});
