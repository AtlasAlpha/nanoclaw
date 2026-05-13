## Problem
sql.js is in-memory. The central DB auto-saves every 5s via setInterval(saveDb, 5000). If a concurrent process (e.g. scripts/q.ts) writes to v2.db, the next auto-save overwrites those changes with the in-memory state that doesn't have them.

## Impact
Any change made via scripts/q.ts while the host is running can be silently lost. This affects owner setup, role changes, etc.

## Locations
- src/db/connection.ts:28-30 - 5s auto-save interval
- src/db/connection.ts:17-20 - saveDb() unconditionally overwrites the file

## Symptoms
Setting user_roles owner via q.ts while app is running doesn't stick.

## Possible fixes
1. Use file-locking between q.ts and the host
2. Reduce auto-save interval and detect file mtime changes before overwriting
3. Add a manual save endpoint to q.ts that signals the host to re-read
