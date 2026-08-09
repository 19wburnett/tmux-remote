#!/usr/bin/env bash
# claude-remote install script (CachyOS / Arch / Linux, systemd user services)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${HOME}/.claude-remote"
ENV_FILE="${DATA_DIR}/env"
UNIT_DIR="${HOME}/.config/systemd/user"

export PATH="${HOME}/.npm-global/bin:${PATH}"

echo "==> claude-remote installer"
echo "    repo: ${REPO_DIR}"

# 1. pnpm (user-scope, avoids root-owned /usr prefix)
if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> installing pnpm via npm (user prefix ~/.npm-global)"
  mkdir -p "${HOME}/.npm-global"
  npm config set prefix "${HOME}/.npm-global" || true
  npm install -g pnpm
fi

# 2. dependencies + build
echo "==> installing dependencies"
pnpm --dir "${REPO_DIR}" install
echo "==> building"
pnpm --dir "${REPO_DIR}" build

# 3. data dir + env file
mkdir -p "${DATA_DIR}"
if [ ! -f "${ENV_FILE}" ]; then
  echo "==> creating ${ENV_FILE} from .env.example"
  cp "${REPO_DIR}/.env.example" "${ENV_FILE}"
  echo
  echo "    !! Edit ${ENV_FILE} and set a strong AUTH_PASSWORD before exposing the app."
else
  echo "==> keeping existing ${ENV_FILE}"
fi

# 4. systemd user units
echo "==> installing systemd user units"
mkdir -p "${UNIT_DIR}"
cp "${REPO_DIR}/systemd/claude-remote.service" "${UNIT_DIR}/"
if [ -f "${REPO_DIR}/systemd/claude-remote-watcher.service" ]; then
  cp "${REPO_DIR}/systemd/claude-remote-watcher.service" "${UNIT_DIR}/"
  cp "${REPO_DIR}/systemd/claude-remote-watcher.timer" "${UNIT_DIR}/"
fi
systemctl --user daemon-reload

chmod +x "${REPO_DIR}/scripts/"*.sh 2>/dev/null || true

echo
echo "==> Done."
echo
echo "    Next steps:"
echo "      1) ${EDITOR:-vi} ${ENV_FILE}   # set AUTH_PASSWORD"
echo "      2) systemctl --user enable --now claude-remote"
echo "      3) open http://localhost:${PORT:-8787} on your phone (same LAN or Tailscale)"
echo "      4) optional watcher:  systemctl --user enable --now claude-remote-watcher.timer"
