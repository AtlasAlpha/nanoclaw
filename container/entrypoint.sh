#!/bin/bash
echo "[entrypoint] started, PID=$$" >&2
echo "[entrypoint] reading stdin..." >&2
cat > /tmp/input.json
echo "[entrypoint] stdin captured ($(wc -c < /tmp/input.json) bytes)" >&2
echo "[entrypoint] starting bun..." >&2
exec bun run /app/src/index.ts < /tmp/input.json
