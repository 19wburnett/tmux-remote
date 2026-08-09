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
    .replace(/\r/g, '')
    .replace(/\u0000/g, '');
}

/** Split a raw output chunk into sanitized lines (trailing newline -> no empty last line). */
export function sanitizeLines(raw: string): string[] {
  const cleaned = sanitizeAnsi(raw);
  const parts = cleaned.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
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
