# claude-remote

A self-hosted, **mobile-first web app** for monitoring and driving your persistent
coding-agent terminal sessions over **tmux** — from your phone, over your private
network or Tailscale. It feels like a chat/control app, not a web terminal: a
session inbox, a bottom composer for prompts and slash commands, one-tap
approvals, a swipeable quick-keys bar, and an expandable live `xterm.js`
terminal when you actually need a raw pane.

```
phone (PWA-ish) ──HTTP/WS──▶ claude-remote server ──tmux CLI──▶ tmux server
                                  │                              │  pane 0 of window 0
                                  └─ SQLite metadata ────────────┘  per session
```

## Features (MVP)

- **Session inbox** — every tmux session/window appears as a card with status,
  project · branch · worktree, agent type, last-output preview and recency.
  Sessions needing you float to the top; pin favorites; filter by running /
  waiting / failed / pinned / project; full-text search.
- **Session detail** — transcript of the agent's output, live-streamed over
  WebSocket; status is inferred heuristically (`running` / `waiting` /
  `needs input` / `error` / `done`).
- **Composer** — multiline chat-style input that sends text or commands into
  the pane. Slash commands: `/status /interrupt /clear /restart /cd /rename
  /pin /unpin /archive /kill /keys /terminal`.
- **Quick keys** — swipeable bar with Ctrl-C, Ctrl-D, Ctrl-L, Esc, Tab, arrows,
  PageUp/Down, Home/End, Enter (mobile terminals make these hard to type).
- **Approvals** — a first-class `[APPROVAL_REQUIRED]` marker in agent output
  surfaces an Approve / Reject banner. Approve injects your configured response
  (e.g. `y` + Enter).
- **Live terminal** — expandable `xterm.js` drawer showing the pane, with
  optional keyboard input forwarding.
- **Auth** — username/password over a signed HttpOnly cookie; every `/api`
  route and the WebSocket is protected. Self-host only (Tailscale / private
  reverse proxy recommended).
- **Lifecycle** — create, rename, pin, archive, kill, or remove sessions;
  git branch/worktree discovery; launch agents into fresh sessions.

## Quick start (CachyOS / Arch)

Requirements: Node.js ≥ 22 (tested on Node 26), `tmux`, `git`, and a user-level
npm install. `pnpm` is installed automatically by the installer.

```bash
git clone <this repo> ~/claude-remote
cd ~/claude-remote
./install.sh                 # installs pnpm, deps, builds, installs systemd units

vi ~/.claude-remote/env      # set a real AUTH_PASSWORD!
systemctl --user enable --now claude-remote
```

Then open `http://<desktop-ip>:8787` on your phone (LAN or Tailscale IP).
Default port `8787`, change it in `~/.claude-remote/env`.

Optional watcher that restarts the service if its health check fails:

```bash
systemctl --user enable --now claude-remote-watcher.timer
```

### Dev mode

```bash
cd ~/claude-remote
pnpm dev          # server on :8787 (API/WS) + vite dev server on :5173
```

### Without systemd

```bash
./run.sh          # builds and runs the server, sourcing ~/.claude-remote/env
```

## Managing agents

`claude-remote` treats **one tmux session as one logical agent** (the active
window's active pane). Everything you do in the app runs `tmux` commands under
the hood, so your panes behave exactly as if you'd typed at the terminal.

- Start an agent: `+` in the app → name, working dir, command (e.g. `claude`).
- Or just `tmux new-session -d -s myagent` on the desktop — it appears in the
  app within ~1s with branch/worktree auto-discovered.
- To surface an approval prompt in the app, have your agent print
  `[APPROVAL_REQUIRED] ...` — the app then shows Approve / Reject.
- From the desktop, attach as always: `tmux attach -t myagent` (see
  `scripts/open-desktop.sh`).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `8787` | listen address |
| `AUTH_USERNAME` | `admin` | app login |
| `AUTH_PASSWORD` | `changeme` | **change this** |
| `AUTH_SECRET` | generated | token signing secret (persisted in data dir) |
| `DATA_DIR` | `~/.claude-remote/data` | SQLite metadata + logs |
| `POLL_MS` | `1000` | tmux poll interval |
| `DISCOVER_GIT` | `true` | auto branch/worktree/project discovery |
| `AGENT_APPROVE_RESPONSE` / `AGENT_REJECT_RESPONSE` | `y` / `n` | text injected on approve/reject |
| `TMUX_SOCKET` / `TMUX_SOCKET_PATH` | — | named tmux socket |

## Security notes

- Intended for **self-hosted use over Tailscale or a private network/reverse
  proxy only**. There is no TLS built in; put a reverse proxy (caddy/nginx)
  with TLS in front if you expose it wider.
- All API routes and the WebSocket require the login cookie. Static files are
  public, but the app itself only renders after login.
- No unauthenticated raw-terminal endpoint exists. `xterm.js` runs entirely
  client-side against the authenticated API.
- Secrets live in env vars / `~/.claude-remote/env` (see `.env.example`).

## Project layout

```
apps/server    Node.js + TypeScript API/WS server (tmux adapter, session manager,
               status heuristics, approval detection, auth, SQLite store)
apps/web       React + TypeScript mobile-first UI (Vite, xterm.js)
packages/shared  Shared types for API + WS messages
systemd/       user units for the app server + optional health watcher
scripts/       healthcheck.sh, open-desktop.sh
```

See `ARCHITECTURE.md` for the design.

## Slash commands

| Command | Action |
| --- | --- |
| `/status` | show session status/context |
| `/interrupt` | send Ctrl-C |
| `/clear` | clear the pane screen |
| `/restart` | respawn the pane (with its launch command if any) |
| `/cd <dir>` | change directory in the pane |
| `/rename <name>` | rename the display title |
| `/pin` `/unpin` | pin / unpin the session |
| `/archive` | hide the session |
| `/kill` | kill the tmux session |
| `/keys` | open the quick-keys bar |
| `/terminal` | open the live terminal drawer |
