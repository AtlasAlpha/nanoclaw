# Known Issues

## HIGH

### Wrong pairing code invalidates all pending pairings
- **File:** `src/channels/telegram-pairing.ts:198-204`
- **Problem:** A wrong 4-digit code loops over ALL `status === 'pending'` records and invalidates every one. Two unrelated pairing requests (e.g. `main` and `wire-to work`) both get nuked by a single wrong guess. Also a trivial DoS — anyone who knows the bot username can send `0000` and wipe all pending pairings.
- **Fix:** Invalidate only the specific record the wrong code was meant for. Rate-limit per-pairing or per-sender for brute-force protection.

## MEDIUM

### Circuit-breaker comment contradicts schedule
- **File:** `src/circuit-breaker.ts:9`
- **Problem:** Comment says "6+ crashes capped at 15min" but the delay array `[0, 0, 3, 10, 30, 60, 120]` caps at 2 minutes.
- **Fix:** Update comment or correct schedule values.

### Dockerfile silences global install failures
- **File:** `container/Dockerfile:138-150`
- **Problem:** Each `pnpm install -g` wraps stderr with `2>/dev/null`. If `vercel`, `agent-browser`, or `claude-code` fails to install, the build succeeds silently. Broken container manifests later as "command not found" at runtime.
- **Fix:** Log failure to stderr before fallback, or surface in build summary.

### Cross-line bold triggers emphasis-stripping fallback
- **File:** `src/channels/telegram-markdown-sanitize.ts:36-37`
- **Problem:** `**bold**` spanning a newline (e.g. `**hello\nworld**`) doesn't match the regex (excludes `\n`), leaving dangling `**` that trigger the strip-everything fallback.
- **Fix:** Support cross-line patterns with `[\s\S]*?` in regex.

## LOW

### Missing `await` on `hostOnInbound` in pairing interceptor
- **File:** `src/channels/telegram.ts:122,128,138,193`
- **Problem:** Four call sites invoke `hostOnInbound(...)` without `await`. The `try/catch` on line 190-194 never catches a throw from the unawaited call.
- **Fix:** Either `await` or annotate with `void` for fire-and-forget.

### Router comment removed
- **File:** `src/router.ts`
- **Problem:** The removed comment explained why non-mentioned messages are silently dropped — the sole gate against DB bloat from uninteresting messages.
- **Fix:** Re-add a shorter version of the explanation.

### Dockerfile dropped `--frozen-lockfile`
- **File:** `container/Dockerfile:121`
- **Problem:** Changed `bun install --frozen-lockfile` to `bun install`. Image builds may silently pull newer dep versions than `bun.lock` specifies.
- **Fix:** Add `--frozen-lockfile` back or add a comment explaining why it's intentionally removed.
