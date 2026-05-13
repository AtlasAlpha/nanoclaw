import { registerResource } from '../crud.js';

registerResource({
  name: 'dropped-message',
  plural: 'dropped-messages',
  table: 'unregistered_senders',
  description:
    'Messages from unregistered senders — tracks who was dropped, how many times, and which messaging group. Read-only diagnostic view.',
  idColumn: 'messaging_group_id',
  columns: [
    { name: 'messaging_group_id', type: 'string', description: 'Messaging group where the message was dropped.' },
    { name: 'sender_identity', type: 'string', description: 'Namespaced sender ID.' },
    { name: 'sender_name', type: 'string', description: 'Display name of the sender if available.' },
    { name: 'message_count', type: 'number', description: 'How many messages from this sender have been dropped.' },
    { name: 'last_seen', type: 'string', description: 'Last time a message from this sender was dropped.' },
  ],
  operations: { list: 'open' },
});
