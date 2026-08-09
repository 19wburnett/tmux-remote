#!/usr/bin/env bash
# Run claude-remote directly (no systemd). Sources ~/.claude-remote/env if present.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="${HOME}/.npm-global/bin:${PATH}"

if [ -f "${HOME}/.claude-remote/env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${HOME}/.claude-remote/env"
  set +a
fi

cd "${REPO_DIR}"
pnpm install --silent 2>/dev/null || true
pnpm build

exec node apps/server/dist/index.js
