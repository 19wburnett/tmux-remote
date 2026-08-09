import { hostname, userInfo } from 'node:os';
import type { TmuxPaneInfo } from './tmux.js';

export type PaneKind = 'agent' | 'shell' | 'sidebar' | 'other';

/** Processes that identify a pane as an agentic coding session. */
export const AGENT_COMMANDS: ReadonlySet<string> = new Set([
  'claude',
  'claude-code',
  'codex',
  'opencode',
  'aider',
  'aichat',
  'goose',
  'gemini',
  'qwen-code',
  'cursor',
  'cursor-agent',
  'amp',
  'kobold',
]);

const SHELL_COMMANDS: ReadonlySet<string> = new Set([
  'fish',
  'bash',
  'zsh',
  'sh',
  'dash',
  'ksh',
  'tmux',
  'login',
  'su',
  'ssh',
]);

/** Window names tmux/shells assign by default — not meaningful labels. */
const DEFAULT_WINDOW_NAMES: ReadonlySet<string> = new Set(['fish', 'bash', 'zsh', '[tmux]']);

/** Panes narrower than this (and running a shell) are treated as sidebars. */
const SIDEBAR_WIDTH = 60;

const AGENT_TITLE_RE = /\b(claude|codex|opencode|aider|aichat|goose|gemini)\b|action required/i;

/** Agent status glyphs that sometimes prefix tmux window titles. */
const GLYPH_RE = /^[\u2733\u2729\u2765\u2718\u2605]|^[\u2800-\u28ff]/u;

const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;

export function classifyPane(pane: TmuxPaneInfo): PaneKind {
  const cmd = (pane.currentCommand || '').toLowerCase();
  if (AGENT_COMMANDS.has(cmd)) return 'agent';
  if (SHELL_COMMANDS.has(cmd)) {
    if (pane.width < SIDEBAR_WIDTH) return 'sidebar';
    return 'shell';
  }
  if (AGENT_TITLE_RE.test(pane.title || '')) return 'agent';
  return 'other';
}

/** Whether a process name identifies an agentic coding tool. */
export function isKnownAgent(cmd: string | undefined): boolean {
  return !!cmd && AGENT_COMMANDS.has(cmd.trim().toLowerCase());
}

/** Stable key for a pane, in the form `<session>.<window>.<pane>`. */
export function paneKey(pane: TmuxPaneInfo): string {
  return `${pane.sessionName}.${pane.windowIndex}.${pane.index}`;
}

function stripGlyphs(s: string): string {
  let out = s;
  let prev: string | undefined;
  while (out !== prev) {
    prev = out;
    out = out.replace(GLYPH_RE, '').trimStart();
  }
  return out;
}

/** Whether the pane title is a useful human label (vs the default shell title). */
export function meaningfulTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const t = stripGlyphs(title.replace(ANSI_SGR_RE, '')).trim();
  if (!t) return undefined;
  if (t === userInfo().username || t === hostname()) return undefined;
  if (/^~(\s|$)/.test(t)) return undefined;
  if (t.length < 3 || t.length > 90) return undefined;
  return t;
}

/** Derive a display label for a pane; `override` (a user rename) wins. */
export function deriveLabel(
  pane: TmuxPaneInfo,
  agentType: string | undefined,
  override: string | undefined,
): string {
  if (override) return override;
  const t = meaningfulTitle(pane.title);
  if (t) return t;
  const win = pane.windowName && !DEFAULT_WINDOW_NAMES.has(pane.windowName) ? pane.windowName : '';
  const agent = agentType && !SHELL_COMMANDS.has(agentType.toLowerCase()) ? agentType : undefined;
  return [agent, win].filter(Boolean).join(' · ') || pane.sessionName;
}
