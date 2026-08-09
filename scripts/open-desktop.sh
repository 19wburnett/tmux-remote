#!/usr/bin/env bash
# Open a claude-remote session on the desktop: tmux attach -t <session>.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: open-desktop.sh <tmux-session-name>" >&2
  exit 1
fi

exec tmux attach-session -t "$1"
