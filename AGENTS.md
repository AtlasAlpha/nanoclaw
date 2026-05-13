# NanoClaw — Agent Guide

## Two runtime trees

| Layer | Runtime | Manager | Entry | Tests |
|-------|---------|---------|-------|-------|
| Host | Node 20+ | pnpm | `src/index.ts` | `pnpm test` (vitest, `src/**/*.test.ts`) |
| Agent container | Bun | bun | `container/agent-runner/src/index.ts` | `cd container/agent-runner && bun test` (bun:test) |

**No shared modules.** Communication is only via per-session SQLite files (`inbound.db` / `outbound.db`).

## Dev commands (in this order, per CI)

```bash
pnpm run format:check        # prettier --check "src/**/*.ts"
pnpm run format:fix          # also the pre-commit hook (only fix, no check)
pnpm run lint                # eslint src/  (--fix variant: lint:fix)
pnpm exec tsc --noEmit       # host typecheck
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit  # container typecheck
pnpm exec vitest run         # host tests (or `pnpm test`)
cd container/agent-runner && bun test  # container tests
pnpm run dev                 # host with hot reload (tsx src/index.ts)
pnpm run build               # host compile (tsc → dist/)
```

Supply chain: `pnpm install --frozen-lockfile` in CI. Never bare `pnpm install` outside dev. `minimumReleaseAge: 4320` (3 days) in `pnpm-workspace.yaml`.

## Testing quirks

- Host tests use **vitest**; container tests use **bun:test** (depends on `bun:sqlite`).
- Skills have a separate vitest config: `pnpm exec vitest run --config vitest.skills.config.ts`.
- Container typecheck excludes `*.test.ts` (see its tsconfig).
- No integration tests that spin Docker containers.

## SQL gotchas — container side (bun:sqlite vs host sql.js)

- **Named params**: `$name` in SQL **and** in JS keys — `bun:sqlite` does NOT auto-strip `$` (unlike sql.js which uses `:name` / `?` style): `.run({ $id: msg.id })`.
- **`journal_mode=DELETE`** is load-bearing for cross-mount visibility in `container/agent-runner/src/db/connection.ts`. Do not change.

## Code style

- ESM everywhere (`"type": "module"` in both package.jsons).
- Single quotes, 120 print width (`.prettierrc`).
- ESLint: `@typescript-eslint/no-unused-vars` with `^_` prefix for all catch-all ignored patterns. `no-catch-all/no-catch-all` warns on bare catches.
- Prettier runs on commit via husky. No linting or test gate in pre-commit.

## Skills system

Four types live in `.claude/skills/`:
1. **Branch-based feature skills** (code on `channels` or `providers` sibling branches, instructions on main)
2. **Utility skills** (code files alongside SKILL.md)
3. **Operational skills** (instruction-only: `/setup`, `/debug`, `/customize`, etc.)
4. **Container skills** (loaded inside agent at runtime from `container/skills/`)

Key distinction: trunk ships **no** channel adapters or non-default providers — those are skill-installed per fork via `/add-<name>`. See `CONTRIBUTING.md` for the full taxonomy.

## Important gotchas

- **OneCLI secret mode**: new agent groups start in `selective` mode — no secrets assigned by default. Fix via `onecli agents set-secret-mode --id <id> --mode all` (no container restart needed).
- **Container image build**: `--no-cache` alone does NOT invalidate COPY steps — prune the builder volume first for a clean rebuild.
- **Agent-runner deps**: edit `container/agent-runner/package.json`, then `cd container/agent-runner && bun install`. Do NOT use `pnpm install` there. `bun install -g` bypasses supply-chain policy — use Dockerfile's pnpm global-install for Node CLIs.
- **No container logs**: `--rm` flag discards container logs on exit. Check session DBs (`data/v2-sessions/<group>/<session>/`) instead.
- **v2 migration**: `bash migrate-v2.sh` from shell, not inside Claude. See the v2 banner in `CLAUDE.md`.
- **Config philosophy**: no config files — customization means editing code.
