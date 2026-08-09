#!/usr/bin/env bash
# Restart the claude-remote service if its health endpoint stops responding.
set -u

PORT="${PORT:-8787}"
URL="http://127.0.0.1:${PORT}/api/health"

for _ in 1 2 3; do
  if curl -sf -m 3 "${URL}" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 2
done

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user restart claude-remote
  logger -t claude-remote "health check failed on :${PORT}; restarted service"
fi
