import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const MAX_EXEC_BUFFER = 8 * 1024 * 1024;

export function run(
  cmd: string,
  args: string[],
  opts: { timeout?: number; cwd?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeout ?? 10000,
        maxBuffer: MAX_EXEC_BUFFER,
        cwd: opts.cwd,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const code = err ? ((err as NodeJS.ErrnoException & { code?: number | string }).code as number | undefined) ?? 1 : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * Strip ANSI escape sequences that are noise for a transcript (OSC title/hyperlink
 * sequences, cursor movement, alternate-screen switches) while preserving SGR
 * color codes so the frontend can render colored output.
 */
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const STRAY_OSC_RE = /\x1b\][^\x07\x1b]*/g;
const CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const CHARSET_RE = /\x1b[()#][0-9A-Za-z]/g;
const SIMPLE_ESC_RE = /\x1b[=>@DMEH]/g;

export function sanitizeAnsi(s: string): string {
  return s
    .replace(OSC_RE, '')
    .replace(STRAY_OSC_RE, '')
    .replace(CSI_RE, (m) => (m.endsWith('m') ? m : ''))
    .replace(CHARSET_RE, '')
    .replace(SIMPLE_ESC_RE, '')
    .replace(/\u0000/g, '');
}

/** Strip SGR (color) sequences and trailing whitespace for plain-text matching. */
export function stripSgr(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
}

/**
 * Split a raw output chunk into lines with terminal redraw semantics:
 * `\r` overwrites from the start of the current line, `\b` deletes the last
 * char. This keeps in-place spinner/progress redraws from being squashed onto
 * a single merged line.
 */
export function sanitizeLines(raw: string): string[] {
  const cleaned = sanitizeAnsi(raw);
  const lines: string[] = [];
  let cur = '';
  let col = 0;
  for (const ch of cleaned) {
    if (ch === '\n') {
      lines.push(cur);
      cur = '';
      col = 0;
    } else if (ch === '\r') {
      col = 0;
    } else if (ch === '\b') {
      if (col > 0) {
        cur = cur.slice(0, -1);
        col -= 1;
      }
    } else {
      if (col < cur.length) {
        cur = cur.slice(0, col) + ch + cur.slice(col + 1);
      } else {
        cur += ch;
      }
      col += 1;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
