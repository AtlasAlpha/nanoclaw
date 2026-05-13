import { registerResource } from '../crud.js';

registerResource({
  name: 'user',
  plural: 'users',
  table: 'users',
  description:
    'User = a messaging-platform identifier. Namespaced so distinct channels with numeric IDs do not collide: "phone:+1555...", "tg:123", "discord:456". A single human can own multiple user rows across channels.',
  idColumn: 'id',
  columns: [
    { name: 'id', type: 'string', description: 'Namespaced identifier (e.g. "telegram:123").' },
    { name: 'kind', type: 'string', description: 'Platform kind (phone, email, discord, telegram, matrix, ...).' },
    { name: 'display_name', type: 'string', description: 'User-facing display name.', updatable: true },
    { name: 'created_at', type: 'string', description: 'Auto-set.', generated: true },
  ],
  operations: { list: 'open', get: 'open' },
});
