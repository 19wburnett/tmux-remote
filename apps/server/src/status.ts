import type { SessionStatus } from '@claude-remote/shared';

export interface StatusContext {
  /** Recent transcript lines (oldest first) with their sequence numbers. */
  recent: { seq: number; text: string }[];
  /** Current captured screen lines, oldest first. */
  screen: string[];
  lastActivityAt: number;
  now: number;
  needsApproval: boolean;
  closed: boolean;
  /** Only consider lines after this sequence for input markers. */
  afterSeq: number;
}

export interface StatusResult {
  status: SessionStatus;
  needsInput: boolean;
  reason: string;
}

const QUESTION_MARKERS = [
  /\(\s*[yY]\s*\/\s*[nN]\s*\)/,
  /\[\s*[yY]\s*\/\s*[nN]\s*\]/,
  /\b(yes|no)\s*\)/i,
  /\b(?:y|n)\s*\/?\s*(?:y|n)\s*[)\]>]?$/i,
  /\b(continue|proceed)\??$/i,
];

const INPUT_HINT_MARKERS = [
  /waiting for (your|you|user) input/i,
  /press enter/i,
  /select an option/i,
  /choose an (action|option|answer)/i,
  /what would you like/i,
  /how can i help/i,
  /awaiting input/i,
];

const APPROVAL_MARKERS = [
  /\[approval(_required|_needed)?\]/i,
  /\[needs_approval\]/i,
  /\[approve\]/i,
  /do you want to (allow|continue|proceed)/i,
];

const ERROR_MARKERS = [
  /\b(?:ERROR|FATAL)\b/,
  /Traceback \(most recent call last\)/,
  /Unhandled exception/,
  /command not found/,
  /ERR!\s+(?:ENOENT|EACCES|EPERM)/,
  /✖/,
];

function lastSignificant(lines: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    const t = lines[i].replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (t) out.unshift(t);
  }
  return out;
}

/**
 * Heuristic status classifier. It intentionally errs toward "waiting" only on
 * strong markers and uses output recency otherwise, because a coding agent that
 * is quietly thinking produces no output for seconds at a time.
 */
export function computeStatus(ctx: StatusContext): StatusResult {
  if (ctx.closed) return { status: 'done', needsInput: false, reason: 'closed' };
  if (ctx.needsApproval) return { status: 'needs_input', needsInput: true, reason: 'approval' };

  // Marker checks only consider lines newer than the last resolved approval,
  // so an answered prompt doesn't keep a session flagged as needing input.
  // Screen content is intentionally excluded here: the marker may still be
  // visually on screen after it has already been answered.
  const fresh = ctx.recent
    .filter((l) => l.seq > ctx.afterSeq)
    .map((l) => l.text);
  const freshText = lastSignificant(fresh, 20).join('\n');
  const screenTail = lastSignificant(ctx.screen, 4);
  const lastLine = screenTail[screenTail.length - 1] ?? '';

  for (const m of APPROVAL_MARKERS) {
    if (m.test(freshText)) return { status: 'needs_input', needsInput: true, reason: 'approval' };
  }

  for (const m of INPUT_HINT_MARKERS) {
    if (m.test(freshText)) return { status: 'waiting', needsInput: true, reason: 'input-hint' };
  }

  const trimmedLast = lastLine.replace(/\u001b\[[0-9;]*m/g, '').trim();

  // Claude Code style option menu: last line is "❯ 2. Open file" or similar.
  if (/^\s*[❯▶>]\s+\d+\./.test(trimmedLast) && screenTail.length >= 3) {
    return { status: 'waiting', needsInput: true, reason: 'menu' };
  }

  for (const m of QUESTION_MARKERS) {
    if (m.test(freshText)) {
      if (/\?\s*$/.test(trimmedLast) || freshText.split('\n').length <= 6) {
        return { status: 'waiting', needsInput: true, reason: 'question' };
      }
    }
  }

  const idleSec = Math.max(0, ctx.now - ctx.lastActivityAt);

  // Recent output -> running.
  if (idleSec < 30) return { status: 'running', needsInput: false, reason: 'active' };

  // No recent output. Shell idle prompt (fish "❯", bash "user@host $") -> done.
  if (trimmedLast === '❯' || trimmedLast === '>' || trimmedLast === '$') {
    return { status: 'done', needsInput: false, reason: 'shell-idle' };
  }
  if (/[@$#]\s*(❯|>|\$)?\s*$/.test(trimmedLast) && trimmedLast.length < 60) {
    return { status: 'done', needsInput: false, reason: 'shell-prompt' };
  }

  // Error markers on the most recent lines.
  const all = ctx.recent.map((l) => l.text);
  const recentLinesSmall = lastSignificant(all, 8).join('\n');
  for (const m of ERROR_MARKERS) {
    if (m.test(recentLinesSmall)) {
      return { status: 'error', needsInput: false, reason: 'error-marker' };
    }
  }

  if (idleSec > 300) return { status: 'done', needsInput: false, reason: 'long-idle' };
  return { status: 'unknown', needsInput: false, reason: 'unknown' };
}
