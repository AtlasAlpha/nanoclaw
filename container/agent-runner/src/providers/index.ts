// Provider self-registration barrel.
// Each import triggers the provider module's registerProvider() call at top
// level. Skills add a new provider by appending one import line below.

import './claude.js';
import './mock.js';

// OpenCode provider — guarded because @opencode-ai/sdk is optional (installed
// via bun.lock, may be absent if the image was built before the dep was added).
try {
  await import('./opencode.js');
} catch {
  // provider not available — createProvider('opencode', ...) will throw a
  // helpful "No provider registered" error if an agent group uses it.
}
