import { registerResource } from '../crud.js';

registerResource({
  name: 'user-dm',
  plural: 'user-dms',
  table: 'user_dms',
  description: 'Cold-DM cache — maps (user, channel) to the DM messaging group. Lets the host initiate cold DMs without reprobing the platform API on every send. Populated lazily.',
  idColumn: 'user_id',
  columns: [
    { name: 'user_id', type: 'string', description: 'User ID.' },
    { name: 'channel_type', type: 'string', description: 'Platform (telegram, discord, etc.).' },
    { name: 'messaging_group_id', type: 'string', description: 'The DM messaging group. References messaging_groups.id.' },
    { name: 'resolved_at', type: 'string', description: 'When this mapping was resolved.' },
  ],
  operations: { list: 'open' },
});
