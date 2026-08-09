import { run, type ExecResult } from './util.js';
import type { AppConfig } from './config.js';

export interface TmuxTarget {
  session: string;
  window?: number;
  pane?: number;
}

export interface TmuxSessionInfo {
  sessionId: string;
  name: string;
  windows: number;
  created: number;
  attached: boolean;
}

export interface TmuxWindowInfo {
  windowId: string;
  index: number;
  name: string;
  active: boolean;
}

export interface TmuxPaneInfo {
  paneId: string;
  index: number;
  currentCommand: string;
  width: number;
  height: number;
  active: boolean;
  pid: number;
  title: string;
  windowIndex: number;
  windowName: string;
  sessionName: string;
}

export interface NewSessionInput {
  name: string;
  cwd?: string;
  command?: string;
}

const SESSION_FMT =
  '#{session_id}|#{session_name}|#{session_windows}|#{session_created}|#{session_attached}';
const WINDOW_FMT = '#{window_id}|#{window_index}|#{window_name}|#{window_active}';
const PANE_SEP = '\u001f';
const PANE_FMT =
  '#{pane_id}' + PANE_SEP +
  '#{pane_index}' + PANE_SEP +
  '#{pane_current_command}' + PANE_SEP +
  '#{pane_width}' + PANE_SEP +
  '#{pane_height}' + PANE_SEP +
  '#{pane_active}' + PANE_SEP +
  '#{pane_pid}' + PANE_SEP +
  '#{pane_title}' + PANE_SEP +
  '#{window_index}' + PANE_SEP +
  '#{window_name}' + PANE_SEP +
  '#{session_name}';

function parsePanes(stdout: string): TmuxPaneInfo[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [
        paneId,
        index,
        currentCommand,
        width,
        height,
        active,
        pid,
        title,
        windowIndex,
        windowName,
        sessionName,
      ] = line.split(PANE_SEP);
      return {
        paneId,
        index: Number(index),
        currentCommand,
        width: Number(width),
        height: Number(height),
        active: active === '1',
        pid: Number(pid),
        title: title ?? '',
        windowIndex: Number(windowIndex),
        windowName: windowName ?? '',
        sessionName: sessionName ?? '',
      };
    });
}

/**
 * Thin adapter around the `tmux` CLI. This is the only module allowed to
 * construct tmux commands; the rest of the codebase talks to it through this
 * interface so tmux details stay in one place.
 */
export class TmuxAdapter {
  constructor(private config: AppConfig) {}

  private baseArgs(): string[] {
    const args: string[] = [];
    if (this.config.tmuxSocket) args.push('-L', this.config.tmuxSocket);
    if (this.config.tmuxSocketPath) args.push('-S', this.config.tmuxSocketPath);
    return args;
  }

  private async tmux(args: string[], opts: { timeout?: number } = {}): Promise<ExecResult> {
    return run('tmux', [...this.baseArgs(), ...args], { timeout: opts.timeout ?? 10000 });
  }

  private async must(args: string[], opts: { timeout?: number } = {}): Promise<string> {
    const r = await this.tmux(args, opts);
    if (r.code !== 0) {
      throw new Error(`tmux ${args.join(' ')} failed: ${r.stderr.trim() || r.stdout.trim()}`);
    }
    return r.stdout;
  }

  targetString(t: TmuxTarget): string {
    let s = t.session;
    if (t.window !== undefined) s += `:${t.window}`;
    if (t.pane !== undefined) s += `.${t.pane}`;
    return s;
  }

  get isAvailable(): boolean {
    return true;
  }

  async listSessions(): Promise<TmuxSessionInfo[]> {
    const r = await this.tmux(['list-sessions', '-F', SESSION_FMT]);
    if (r.code !== 0) {
      if (r.stderr.includes('no server running') || r.stderr.includes('failed to connect')) {
        return [];
      }
      throw new Error(`list-sessions failed: ${r.stderr.trim()}`);
    }
    return r.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sessionId, name, windows, created, attached] = line.split('|');
        return {
          sessionId,
          name,
          windows: Number(windows),
          created: Number(created),
          attached: attached === '1',
        };
      });
  }

  async listWindows(session: string): Promise<TmuxWindowInfo[]> {
    const r = await this.tmux(['list-windows', '-t', session, '-F', WINDOW_FMT]);
    if (r.code !== 0) return [];
    return r.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [windowId, index, name, active] = line.split('|');
        return { windowId, index: Number(index), name, active: active === '1' };
      });
  }

  async listPanes(session: string, window?: number): Promise<TmuxPaneInfo[]> {
    const target = window !== undefined ? `${session}:${window}` : session;
    const r = await this.tmux(['list-panes', '-t', target, '-F', PANE_FMT]);
    if (r.code !== 0) return [];
    return parsePanes(r.stdout);
  }

  /** All panes across all sessions (used for agentic-session discovery). */
  async listAllPanes(): Promise<TmuxPaneInfo[]> {
    const r = await this.tmux(['list-panes', '-a', '-F', PANE_FMT]);
    if (r.code !== 0) {
      if (r.stderr.includes('no server running') || r.stderr.includes('failed to connect')) {
        return [];
      }
      return [];
    }
    return parsePanes(r.stdout);
  }

  async capturePane(target: TmuxTarget, scrollback?: number): Promise<string> {
    const args = ['capture-pane', '-e', '-p', '-t', this.targetString(target)];
    if (scrollback !== undefined) args.push('-S', `-${scrollback}`);
    const r = await this.tmux(args);
    return r.code === 0 ? r.stdout : '';
  }

  async sendKeys(target: TmuxTarget, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.must(['send-keys', '-t', this.targetString(target), ...keys]);
  }

  async sendLiteral(target: TmuxTarget, text: string): Promise<void> {
    if (text.length === 0) return;
    await this.must(['send-keys', '-t', this.targetString(target), '-l', text]);
  }

  async sendText(target: TmuxTarget, text: string, enter = true): Promise<void> {
    await this.sendLiteral(target, text);
    if (enter) await this.sendKeys(target, ['Enter']);
  }

  async newSession(input: NewSessionInput): Promise<string> {
    const args = ['new-session', '-d', '-s', input.name];
    if (input.cwd) args.push('-c', input.cwd);
    if (input.command) args.push(input.command);
    await this.must(args);
    return input.name;
  }

  async killSession(name: string): Promise<void> {
    await this.tmux(['kill-session', '-t', name]);
  }

  async killPane(target: TmuxTarget): Promise<void> {
    await this.tmux(['kill-pane', '-t', this.targetString(target)]);
  }

  async renameSession(oldName: string, newName: string): Promise<void> {
    await this.must(['rename-session', '-t', oldName, newName]);
  }

  async hasSession(name: string): Promise<boolean> {
    const r = await this.tmux(['has-session', '-t', name]);
    return r.code === 0;
  }

  async respawnPane(target: TmuxTarget, command?: string): Promise<void> {
    const args = ['respawn-pane', '-k', '-t', this.targetString(target)];
    if (command) args.push(command);
    await this.must(args);
  }

  async paneCurrentPath(target: TmuxTarget): Promise<string | undefined> {
    const r = await this.tmux(['display', '-t', this.targetString(target), '-p', '#{pane_current_path}']);
    if (r.code !== 0) return undefined;
    const p = r.stdout.trim();
    return p ? p : undefined;
  }

  /**
   * Whether the pane already has an output pipe attached. `pipe-pane -o`
   * toggles, so callers must check this first to avoid flipping a pipe off
   * (e.g. after a server restart, when a pipe from a previous process is still
   * attached in tmux).
   */
  async isPiped(target: TmuxTarget): Promise<boolean> {
    const r = await this.tmux(['display', '-t', this.targetString(target), '-p', '#{pane_pipe}']);
    if (r.code !== 0) return false;
    return r.stdout.trim() === '1';
  }

  /**
   * Start streaming this pane's output into `cmd`. Only toggles the pipe on if
   * it is not already attached.
   */
  async pipeStart(target: TmuxTarget, cmd: string): Promise<void> {
    if (await this.isPiped(target)) return;
    await this.must(['pipe-pane', '-o', '-t', this.targetString(target), cmd]);
  }

  /** Toggle the pipe off, but only if one is currently attached. */
  async pipeStop(target: TmuxTarget): Promise<void> {
    if (!(await this.isPiped(target))) return;
    await this.tmux(['pipe-pane', '-o', '-t', this.targetString(target)]);
  }

  async getChildrenCommand(pid: number): Promise<string | undefined> {
    if (!pid) return undefined;
    const r = await run('ps', ['-o', 'args=', '--ppid', String(pid)], { timeout: 3000 });
    if (r.code !== 0) return undefined;
    const first = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)[0];
    return first ?? undefined;
  }
}
