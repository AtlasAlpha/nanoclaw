import { registerResource } from '../crud.js';

registerResource({
  name: 'messaging-group',
  plural: 'messaging-groups',
  table: 'messaging_groups',
  description:
    'A single chat or channel on one platform. Each messaging group can be wired to one or more agent groups via wirings.',
  idColumn: 'id',
  columns: [
    { name: 'id', type: 'string', description: 'UUID.', generated: true },
    {
      name: 'channel_type',
      type: 'string',
      description: 'Platform identifier (telegram, discord, slack, etc.).',
      required: true,
    },
    { name: 'platform_id', type: 'string', description: 'Platform-native channel identifier.', required: true },
    { name: 'name', type: 'string', description: 'Human-readable name for this chat or channel.', updatable: true },
    { name: 'is_group', type: 'number', description: '1 if this is a group chat, 0 for DM.' },
    {
      name: 'unknown_sender_policy',
      type: 'string',
      description: 'How to handle messages from unknown users.',
      enum: ['strict', 'request_approval', 'public'],
      updatable: true,
    },
    { name: 'created_at', type: 'string', description: 'Auto-set.', generated: true },
  ],
  operations: { list: 'open', get: 'open' },
});
