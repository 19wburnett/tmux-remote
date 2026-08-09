# Architecture

`claude-remote` is a thin, deliberately-inspectable control plane on top of
tmux. tmux remains the source of truth for long-running sessions; the app adds
a metadata layer, live streaming, status heuristics, and a mobile UI.

## Monorepo

```
apps/server    Node 22+ TypeScript, ESM. Express HTTP + `ws` WebSocket.
apps/web       React 18 + Vite, mobile-first, xterm.js for the terminal drawer.
packages/shared  Pure TypeScript types shared by server and web.
```

Dependency direction: `apps/* → packages/shared`. The server exposes REST for
actions and WebSocket for streaming; the web client uses REST for mutations and
WebSocket for session snapshots + output deltas.

## Server

```
index.ts            bootstrap: config → store → tmux adapter → session manager →
                    HTTP app + WS server on one http.Server (vite/static in prod)
config.ts           env config, defaults, generated/persisted AUTH_SECRET
auth.ts             HMAC-signed bearer token in HttpOnly cookie; timing-safe login
store.ts / store-sqlite.ts
                    metadata persistence (node:sqlite, JSON file fallback)
tmux.ts             THE only module that builds tmux commands
sessionManager.ts   poll loop, per-session state, streaming, lifecycle, approvals
status.ts           pure heuristics: status + "needs input" classification
git.ts              best-effort branch / worktree / project discovery
ws.ts               WebSocket hub implementing the SessionBus interface
http.ts             REST routes + static SPA serving
```

### The tmux adapter layer

`TmuxAdapter` is a thin wrapper over the tmux CLI (single subprocess helper in
`util.ts`). Every tmux interaction — `list-sessions`, `capture-pane`,
`send-keys`, `pipe-pane`, `respawn-pane`, `new-session`, `kill-session` —
lives here. No raw tmux strings appear elsewhere.

Key design points:

- **One agent = one tmux pane.** `SessionManager` enumerates every pane across
  all sessions (`list-panes -a`) and classifies each one: panes running agent
  binaries (`claude`, `codex`, `opencode`, …) become sessions; narrow sidebar
  dashboards and idle plain-shell panes are ignored. Each card is bound to its
  pane address (`session.window.pane`), which is stable while tmux runs.
  Window titles are used as smart labels (status glyphs are stripped).
- **Output capture** uses `tmux pipe-pane` writing each pane's output to a
  file in the data dir, then a per-second `tail` reads the delta. This gives a
  transcript that survives server restarts. `pipe-pane -o` toggles, so the
  adapter first queries `#{pane_pipe}` to avoid flipping off a pipe left by a
  previous server process.
- **Screen/preview** uses `capture-pane -e -p` (keeps ANSI color). Raw output
  is sanitized to strip OSC/cursor-move escapes while preserving SGR color so
  the frontend renders colored transcripts safely.

### Poll loop

`SessionManager.tick()` runs every `POLL_MS`:

1. `list-panes -a` → classify panes, adopt new agentic ones (or any pane with
   a stored record, e.g. just-created sessions), mark vanished panes `closed`.
2. Per pane: tail the pipe log, capture the screen, run status heuristics, scan
   for `[APPROVAL_REQUIRED]` markers, refresh the smart title label, and feed
   new output into the chat transcript.
3. Broadcast: full session list when it changes, `session-updated` per session,
   `output` + `chat-output` deltas only to clients subscribed to that session.

### Chat transcript

The server maintains a per-session chat: each `send`/`approve` appends a
**user** message (right bubble), and the pane's pipe output is chunked into
**agent** messages (left bubbles). Echo of your own typed input is suppressed —
the first transcript line that equals (or ends with) the just-sent text is
dropped/trimmed — so the agent bubble doesn't repeat your message. New agent
bubbles are started after each user send or after an ~8s output gap, giving a
natural Telegram-like cadence. The raw transcript is still kept for the
`xterm.js` terminal drawer.

### Status heuristics

`computeStatus` is a pure function over (recent transcript lines with seq
numbers, current screen, recency). It errs toward *not* flagging: only strong
markers (`(y/N)`, "press enter", Claude-style `❯ 2.` menus, `[APPROVAL...]`)
force `waiting`/`needs input`; otherwise output recency decides `running` vs
`done`. Lines already covered by a resolved approval (tracked via a seq
watermark `lastApprovalSeq`) are excluded so answered prompts don't re-trigger.

### Approvals

When output contains the marker `[APPROVAL_REQUIRED]` (or variants), the manager
creates an `ApprovalRequest` (with surrounding context), sets
`needsApproval=true`, and broadcasts it. **Approve** injects
`AGENT_APPROVE_RESPONSE` + Enter; **Reject** injects
`AGENT_REJECT_RESPONSE` + Enter. Detection is seq-watermarked so it can't
re-fire on the same marker.

### Auth & security

- Login: `POST /api/auth/login` → timing-safe credential check → signed token
  in an `HttpOnly; SameSite=Strict` cookie.
- `verifyToken` middleware protects every `/api/*` route; the WebSocket verifies
  the cookie (or `?token=`) before allowing the connection.
- Static assets are served but the SPA only shows content after login; there is
  no raw/unauthenticated terminal endpoint. TLS is intentionally out of scope —
  run behind a reverse proxy for anything beyond Tailscale/LAN.

## Web client

State lives in a single React context (`provider.tsx`) that owns the
WebSocket (`ws.ts`, reconnect + re-subscribe) and exposes typed actions.
Views:

- **SessionList** — search, filter chips, sort-by-attention cards.
- **SessionDetail** — meta row, approval banner, quick-action chips, transcript
  (`OutputView`), swipeable `QuickKeysBar`, and the bottom `Composer`.
- **TerminalDrawer** — an `xterm.js` instance fed from the server transcript
  (initial snapshot via REST, then live `output` events). Keyboard forwarding is
  an explicit toggle; quick keys + composer are the primary input path.

ANSI rendering for the transcript is a small client-side SGR parser
(`ansi.tsx`) producing colored spans — no HTML injection.

## Persistence

- Metadata (name, project, branch, worktree, agentType, tags, pinned, archived,
  launch command) lives in SQLite (`node:sqlite`, stable in Node ≥ 22) with a
  JSON-file fallback. No external DB.
- Session transcript logs are plain files in `DATA_DIR/logs`, appended by
  `pipe-pane`. In-memory ring buffers serve the live transcript.

## Scaling / non-goals (for now)

- No Docker, no cloud services, no build step beyond `tsc`/`vite`.
- Approval detection is marker/heuristic-based, not a real permission hook into
  any agent runtime.
- One app-session = one agentic tmux pane; multi-pane dashboards are filtered
  out rather than shown as sessions.
