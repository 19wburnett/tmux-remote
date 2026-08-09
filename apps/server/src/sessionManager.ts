import { join } from 'node:path';
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  ApprovalRequest,
  ChatMessage,
  CommandInput,
  KeysInput,
  SendInput,
  SessionCreateInput,
  SessionInfo,
  SessionPatchInput,
  TranscriptLine,
} from '@claude-remote/shared';
import type { AppConfig } from './config.js';
import type { Store, SessionRecord } from './store.js';
import { TmuxAdapter, type TmuxPaneInfo, type TmuxTarget } from './tmux.js';
import { AGENT_COMMANDS, classifyPane, deriveLabel, isKnownAgent, paneKey } from './detect.js';
import { discoverGit } from './git.js';
import { computeStatus } from './status.js';
import { sanitizeLines } from './util.js';

export interface SessionBus {
  sessions(sessions: SessionInfo[], approvals: ApprovalRequest[]): void;
  sessionUpdated(session: SessionInfo): void;
  output(sessionId: string, lines: TranscriptLine[]): void;
  transcript(sessionId: string, lines: TranscriptLine[]): void;
  chat(sessionId: string, messages: ChatMessage[]): void;
  chatUser(sessionId: string, message: ChatMessage): void;
  chatOutput(sessionId: string, message: ChatMessage): void;
  approval(sessionId: string, pending: boolean, request?: ApprovalRequest): void;
  error(message: string): void;
}

interface ManagedSession {
  info: SessionInfo;
  meta: SessionRecord;
  target: TmuxTarget;
  paneId?: string;
  panePid?: number;
  logPath: string;
  pipeOn: boolean;
  fileOffset: number;
  buffer: TranscriptLine[];
  seq: number;
  lastScreen: string[];
  lastScreenHash: string;
  lastActivityAt: number;
  pendingApproval: ApprovalRequest | undefined;
  lastApprovalSeq: number;
  gitCheckedAt: number;
  agentCheckedAt: number;
  lastTitle?: string;
  lastError?: string;
  chat: ChatMessage[];
  currentAgentId?: string;
  chatLastAppendAt: number;
  echoPending?: string;
}

function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function previewFrom(screen: string[]): string {
  const nonEmpty = screen.map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  const last = nonEmpty.slice(-3).join('\n');
  return last.length > 240 ? `${last.slice(0, 240)}…` : last;
}

const APPROVAL_RE = /\[approval(_required|_needed)?\]|\[needs_approval\]|\[approve\]/i;

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private pipeTargets = new Set<string>();
  private listHash = '';
  private timer: NodeJS.Timeout | undefined;
  private refreshing = false;

  constructor(
    private tmux: TmuxAdapter,
    private store: Store,
    private config: AppConfig,
    private bus: SessionBus,
  ) {}

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.config.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const panes = await this.tmux.listAllPanes();
      const live = new Map<string, TmuxPaneInfo>();
      for (const p of panes) live.set(paneKey(p), p);

      for (const p of panes) {
        const key = paneKey(p);
        if (this.sessions.has(key)) continue;
        const kind = classifyPane(p);
        const hasRecord = this.store.getSession(key) !== undefined;
        if (kind === 'agent' || hasRecord) {
          await this.adoptPane(p);
        }
      }

      for (const [id, ms] of this.sessions) {
        const pane = live.get(id);
        if (!pane) {
          if (!ms.info.closed) {
            ms.info.closed = true;
            ms.info.status = 'done';
            ms.meta = { ...ms.meta, closed: true };
            this.store.upsertSession(ms.meta);
            this.bus.sessionUpdated(ms.info);
          }
          continue;
        }
        await this.refresh(ms, pane);
      }
      this.maybeBroadcastList();
    } catch (err) {
      this.bus.error(`poll failed: ${(err as Error).message}`);
    } finally {
      this.refreshing = false;
    }
  }

  private async adoptPane(pane: TmuxPaneInfo): Promise<void> {
    const key = paneKey(pane);
    const existing = this.store.getSession(key);
    const cmd = (pane.currentCommand || '').toLowerCase();
    const agentType = existing?.agentType ?? (AGENT_COMMANDS.has(cmd) ? cmd : undefined);

    const meta: SessionRecord = {
      id: key,
      tags: existing?.tags ?? [],
      pinned: existing?.pinned ?? false,
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? Date.now(),
      closed: false,
    };
    if (existing) {
      meta.displayName = existing.displayName;
      meta.project = existing.project;
      meta.agentType = existing.agentType;
      meta.notes = existing.notes;
      meta.launchCommand = existing.launchCommand;
      meta.branch = existing.branch;
      meta.worktree = existing.worktree;
      meta.cwd = existing.cwd;
    }

    const target: TmuxTarget = {
      session: pane.sessionName,
      window: pane.windowIndex,
      pane: pane.index,
    };
    const cwd = meta.cwd ?? (await this.tmux.paneCurrentPath(target));

    const logPath = this.paneLogPath(key);
    await this.ensurePipe(target, logPath, pane.paneId);

    const raw = await this.tmux.capturePane(target, this.config.ringBufferSize);
    const seedLines = sanitizeLines(raw);
    const buffer: TranscriptLine[] = seedLines.map((t, i) => ({
      seq: i,
      ts: Date.now(),
      text: t,
    }));
    const seq = buffer.length;

    const displayName = deriveLabel(pane, agentType, meta.displayName);
    const seedAgentLines = seedLines.slice(-300);
    const firstAgent: ChatMessage | undefined =
      seedAgentLines.length > 0
        ? { id: randomUUID(), role: 'agent', ts: Date.now(), lines: seedAgentLines }
        : undefined;
    const ms: ManagedSession = {
      info: {
        id: key,
        tmuxSession: pane.sessionName,
        window: pane.windowIndex,
        pane: pane.index,
        displayName,
        status: 'unknown',
        project: meta.project,
        branch: meta.branch,
        worktree: meta.worktree,
        cwd,
        agentType,
        preview: previewFrom(seedLines),
        lastActivityAt: Date.now(),
        createdAt: meta.createdAt,
        pinned: meta.pinned,
        archived: meta.archived,
        needsApproval: false,
        needsInput: false,
        attached: true,
        windows: 1,
        tags: meta.tags ?? [],
        closed: false,
      },
      meta,
      target,
      paneId: pane.paneId,
      panePid: pane.pid,
      logPath,
      pipeOn: true,
      fileOffset: this.fileSize(logPath),
      buffer,
      seq,
      lastScreen: seedLines,
      lastScreenHash: seedLines.join('\n'),
      lastActivityAt: Date.now(),
      pendingApproval: undefined,
      lastApprovalSeq: 0,
      gitCheckedAt: 0,
      agentCheckedAt: 0,
      lastTitle: pane.title,
      chat: firstAgent ? [firstAgent] : [],
      currentAgentId: firstAgent?.id,
      chatLastAppendAt: Date.now(),
    };
    this.sessions.set(key, ms);

    if (this.config.discoverGit) void this.refreshGit(ms);
    void this.refreshAgentType(ms, pane);
    this.bus.sessionUpdated(ms.info);
  }

  private async adoptPaneForSession(name: string): Promise<TmuxPaneInfo | undefined> {
    const windows = await this.tmux.listWindows(name);
    const win = windows[0];
    if (!win) return undefined;
    const panes = await this.tmux.listPanes(name, win.index);
    if (panes.length === 0) return undefined;
    // Prefer a pane already running an agent; otherwise the widest pane that
    // is not the sidebar dashboard (tmux hooks often add a narrow side pane).
    const agentic = panes.find((p) => classifyPane(p) === 'agent');
    if (agentic) return agentic;
    const main = [...panes]
      .filter((p) => classifyPane(p) !== 'sidebar')
      .sort((a, b) => b.width - a.width)[0];
    return main ?? panes[0];
  }

  private paneLogPath(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this.config.logDir, `${safe}.log`);
  }

  private async ensurePipe(target: TmuxTarget, logPath: string, paneId?: string): Promise<void> {
    if (!paneId) return;
    if (this.pipeTargets.has(paneId)) return;
    const cmd = `cat >> ${shq(logPath)}`;
    try {
      await this.tmux.pipeStart(target, cmd);
      this.pipeTargets.add(paneId);
    } catch (err) {
      this.bus.error(`pipe-pane failed for ${target.session}: ${(err as Error).message}`);
    }
  }

  private fileSize(p: string): number {
    try {
      return statSync(p).size;
    } catch {
      return 0;
    }
  }

  private async refresh(ms: ManagedSession, pane: TmuxPaneInfo): Promise<void> {
    try {
      ms.paneId = pane.paneId;
      if (pane.pid && pane.pid !== ms.panePid) ms.panePid = pane.pid;

      if (!ms.meta.displayName) {
        const label = deriveLabel(pane, ms.info.agentType, undefined);
        if (label !== ms.info.displayName) {
          ms.info.displayName = label;
          this.bus.sessionUpdated(ms.info);
        }
      }
      ms.lastTitle = pane.title;

      const newLines = this.tailLog(ms);
      const gotOutput = newLines.length > 0;
      if (gotOutput) {
        const chatLines = this.suppressEcho(ms, newLines);
        if (chatLines.length) this.appendAgentChat(ms, chatLines);
        ms.lastActivityAt = Date.now();
        const out: TranscriptLine[] = [];
        for (const text of newLines) {
          ms.seq += 1;
          const line: TranscriptLine = { seq: ms.seq, ts: ms.lastActivityAt, text };
          ms.buffer.push(line);
          if (ms.buffer.length > this.config.ringBufferSize) ms.buffer.splice(0, ms.buffer.length - this.config.ringBufferSize);
          out.push(line);
        }
        this.bus.output(ms.info.id, out);
      }

      const raw = await this.tmux.capturePane(ms.target);
      const screen = sanitizeLines(raw);
      const screenHash = screen.join('\n');
      if (screenHash !== ms.lastScreenHash) {
        ms.lastScreen = screen;
        ms.lastScreenHash = screenHash;
        if (!gotOutput && Date.now() - ms.lastActivityAt > 2000) ms.lastActivityAt = Date.now();
        ms.info.preview = previewFrom(screen);
      } else if (gotOutput) {
        ms.info.preview = previewFrom(screen);
      }

      const nowMs = Date.now();
      if (this.config.discoverGit && nowMs - ms.gitCheckedAt > 60_000) {
        ms.gitCheckedAt = nowMs;
        void this.refreshGit(ms);
      }
      if (nowMs - ms.agentCheckedAt > 60_000) {
        ms.agentCheckedAt = nowMs;
        void this.refreshAgentType(ms, pane);
      }

      if (!ms.pendingApproval) this.detectApproval(ms);

      const st = computeStatus({
        recent: ms.buffer.slice(-40).map((l) => ({ seq: l.seq, text: l.text })),
        screen,
        lastActivityAt: ms.lastActivityAt,
        now: nowMs / 1000,
        needsApproval: !!ms.pendingApproval,
        closed: ms.info.closed,
        afterSeq: ms.lastApprovalSeq,
      });
      ms.info.status = st.status;
      ms.info.needsInput = st.needsInput;
      ms.info.attached = true;
      ms.info.windows = ms.info.windows || 1;
      ms.info.lastActivityAt = ms.lastActivityAt;
      ms.info.preview = previewFrom(screen);

      this.bus.sessionUpdated(ms.info);
    } catch (err) {
      ms.lastError = (err as Error).message;
    }
  }

  private tailLog(ms: ManagedSession): string[] {
    const size = this.fileSize(ms.logPath);
    if (size === 0) return [];
    if (size < ms.fileOffset) ms.fileOffset = 0;
    if (size === ms.fileOffset) return [];
    let fd: number;
    try {
      fd = openSync(ms.logPath, 'r');
    } catch {
      return [];
    }
    try {
      const len = size - ms.fileOffset;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, ms.fileOffset);
      ms.fileOffset = size;
      return sanitizeLines(buf.toString('utf8'));
    } finally {
      closeSync(fd);
    }
  }

  private stripAnsiPlain(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
  }

  /**
   * Drop the pane's echo of a just-sent user message from the transcript so it
   * doesn't also appear inside the agent's bubble. Only the first matching
   * line is treated as echo (`prompt> hello` and `hello` are both handled).
   */
  private suppressEcho(ms: ManagedSession, lines: string[]): string[] {
    const t = ms.echoPending;
    if (!t) return lines;
    const out: string[] = [];
    let consumed = false;
    for (const line of lines) {
      if (!consumed) {
        const plain = this.stripAnsiPlain(line);
        if (plain === t) {
          consumed = true;
          continue;
        }
        if (plain.endsWith(t) && plain.length > t.length) {
          out.push(line.slice(0, line.length - t.length));
          consumed = true;
          continue;
        }
      }
      out.push(line);
    }
    if (consumed) ms.echoPending = undefined;
    return out;
  }

  private appendAgentChat(ms: ManagedSession, lines: string[]): void {
    let msg = ms.chat.find((m) => m.id === ms.currentAgentId && m.role === 'agent');
    const newBubble = !msg || Date.now() - ms.chatLastAppendAt > 8000;
    if (!msg || newBubble) {
      msg = { id: randomUUID(), role: 'agent', ts: Date.now(), lines: [] };
      ms.chat.push(msg);
      ms.currentAgentId = msg.id;
    }
    for (const l of lines) {
      if (msg.lines!.length >= this.config.ringBufferSize) break;
      msg.lines!.push(l);
    }
    ms.chatLastAppendAt = Date.now();
    if (ms.chat.length > 500) ms.chat.shift();
    this.bus.chatOutput(ms.info.id, msg);
  }

  private noteUserSend(ms: ManagedSession, text: string, ts = Date.now()): void {
    const msg: ChatMessage = { id: randomUUID(), role: 'user', ts, text };
    ms.chat.push(msg);
    if (ms.chat.length > 500) ms.chat.shift();
    ms.currentAgentId = undefined;
    ms.echoPending = text;
    this.bus.chatUser(ms.info.id, msg);
  }

  private detectApproval(ms: ManagedSession): void {
    // Scan buffer lines (they carry seq numbers) so we never re-trigger on a
    // marker we have already surfaced and resolved.
    const window = ms.buffer.slice(-60);
    for (let i = window.length - 1; i >= 0; i--) {
      const line = window[i];
      if (line.seq <= ms.lastApprovalSeq) continue;
      if (APPROVAL_RE.test(line.text)) {
        const start = Math.max(0, i - 6);
        const detail = window.slice(start, Math.min(window.length, i + 6)).map((l) => l.text).join('\n');
        ms.pendingApproval = {
          id: randomUUID(),
          sessionId: ms.info.id,
          title: 'Action requires approval',
          detail,
          createdAt: Date.now(),
        };
        ms.lastApprovalSeq = line.seq;
        this.store.addApproval({ ...ms.pendingApproval, resolved: false });
        ms.info.needsApproval = true;
        ms.info.status = 'needs_input';
        ms.info.needsInput = true;
        this.bus.approval(ms.info.id, true, ms.pendingApproval);
        this.bus.sessionUpdated(ms.info);
        return;
      }
    }
  }

  private async refreshGit(ms: ManagedSession): Promise<void> {
    const cwd = ms.info.cwd ?? ms.meta.cwd;
    if (!cwd) return;
    const g = await discoverGit(cwd);
    let changed = false;
    if (g.branch && ms.info.branch !== g.branch) {
      ms.info.branch = g.branch;
      ms.meta.branch = g.branch;
      changed = true;
    }
    if (g.worktree && ms.info.worktree !== g.worktree) {
      ms.info.worktree = g.worktree;
      ms.meta.worktree = g.worktree;
      changed = true;
    }
    if (g.project && !ms.meta.project) {
      ms.info.project = g.project;
      ms.meta.project = g.project;
      changed = true;
    }
    if (!ms.info.cwd && cwd) {
      ms.info.cwd = cwd;
      ms.meta.cwd = cwd;
      changed = true;
    }
    if (changed) {
      this.store.upsertSession(ms.meta);
      this.bus.sessionUpdated(ms.info);
    }
  }

  private async refreshAgentType(ms: ManagedSession, pane: TmuxPaneInfo): Promise<void> {
    const cmd = (pane.currentCommand || '').toLowerCase();
    if (AGENT_COMMANDS.has(cmd)) {
      if (ms.info.agentType !== cmd && !ms.meta.agentType) {
        ms.info.agentType = cmd;
        ms.meta.agentType = cmd;
        this.store.upsertSession(ms.meta);
        this.bus.sessionUpdated(ms.info);
      }
    } else if (!ms.info.agentType && ms.panePid) {
      const children = await this.tmux.getChildrenCommand(ms.panePid);
      const agent = children ? this.deriveAgentName(children) : undefined;
      if (agent && isKnownAgent(agent) && !ms.meta.agentType) {
        ms.info.agentType = agent;
        ms.meta.agentType = agent;
        this.store.upsertSession(ms.meta);
        this.bus.sessionUpdated(ms.info);
      }
    }
    ms.agentCheckedAt = Date.now();
  }

  private deriveAgentName(cmdline: string): string {
    const parts = cmdline.trim().split(/\s+/);
    const base = (parts[0] ?? '').split('/').pop() ?? '';
    return base || 'shell';
  }

  private maybeBroadcastList(): void {
    const infos = [...this.sessions.values()].map((ms) => ms.info);
    const approvals = [...this.sessions.values()]
      .map((ms) => ms.pendingApproval)
      .filter((a): a is ApprovalRequest => !!a);
    const hash = JSON.stringify({ infos, approvals });
    if (hash !== this.listHash) {
      this.listHash = hash;
      this.bus.sessions(infos, approvals);
    }
  }

  // ---- public actions ------------------------------------------------------

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((ms) => ms.info);
  }

  pendingApprovals(): ApprovalRequest[] {
    return [...this.sessions.values()]
      .map((ms) => ms.pendingApproval)
      .filter((a): a is ApprovalRequest => !!a);
  }

  getInfo(id: string): SessionInfo | undefined {
    return this.sessions.get(id)?.info;
  }

  getTranscript(id: string): TranscriptLine[] {
    return this.sessions.get(id)?.buffer ?? [];
  }

  getScreen(id: string): string[] {
    return this.sessions.get(id)?.lastScreen ?? [];
  }

  getChat(id: string): ChatMessage[] {
    return this.sessions.get(id)?.chat ?? [];
  }

  private require(id: string): ManagedSession {
    const ms = this.sessions.get(id);
    if (!ms) throw new Error(`session ${id} not found`);
    if (ms.info.closed) throw new Error(`session ${id} is closed`);
    return ms;
  }

  async create(input: SessionCreateInput): Promise<SessionInfo> {
    const name =
      input.name && input.name.trim()
        ? input.name.trim()
        : `agent-${Date.now().toString(36)}`;
    if (await this.tmux.hasSession(name)) {
      throw new Error(`tmux session "${name}" already exists`);
    }
    await this.tmux.newSession({
      name,
      cwd: input.cwd,
      command: input.command,
    });
    const pane = await this.adoptPaneForSession(name);
    if (!pane) throw new Error('session created but no pane found');
    const key = paneKey(pane);
    this.store.upsertSession({
      id: key,
      project: input.project,
      agentType: input.agentType,
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
      archived: false,
      createdAt: Date.now(),
      launchCommand: input.command,
    });
    await this.adoptPane(pane);
    this.maybeBroadcastList();
    const info = this.getInfo(key);
    if (!info) throw new Error('session created but not adopted');
    return info;
  }

  async send(id: string, input: SendInput): Promise<void> {
    const ms = this.require(id);
    await this.tmux.sendText(ms.target, input.text, input.enter !== false);
    this.noteUserSend(ms, input.text);
  }

  async keys(id: string, input: KeysInput): Promise<void> {
    const ms = this.require(id);
    await this.tmux.sendKeys(ms.target, input.keys);
  }

  async command(id: string, input: CommandInput): Promise<{ message: string }> {
    const ms = this.require(id);
    switch (input.command) {
      case 'interrupt':
        await this.tmux.sendKeys(ms.target, ['C-c']);
        return { message: 'Sent Ctrl-C' };
      case 'clear':
        await this.tmux.sendKeys(ms.target, ['C-l']);
        return { message: 'Cleared screen' };
      case 'restart':
        await this.tmux.respawnPane(ms.target, ms.meta.launchCommand);
        ms.lastActivityAt = Date.now();
        return { message: ms.meta.launchCommand ? 'Restarted agent' : 'Restarted pane' };
      case 'cd':
        if (!input.arg) throw new Error('usage: /cd <path>');
        await this.tmux.sendText(ms.target, `cd ${input.arg}`);
        return { message: `cd ${input.arg}` };
      case 'status':
        return { message: this.statusText(ms.info) };
      default:
        throw new Error(`unknown command: ${input.command}`);
    }
  }

  private statusText(info: SessionInfo): string {
    const bits = [
      `session: ${info.displayName}`,
      `status: ${info.status}${info.needsApproval ? ' (approval pending)' : ''}`,
      info.agentType ? `agent: ${info.agentType}` : '',
      info.project ? `project: ${info.project}` : '',
      info.branch ? `branch: ${info.branch}` : '',
      info.cwd ? `cwd: ${info.cwd}` : '',
      `last activity: ${new Date(info.lastActivityAt).toLocaleTimeString()}`,
    ].filter(Boolean);
    return bits.join('\n');
  }

  async approve(id: string, approve: boolean): Promise<void> {
    const ms = this.require(id);
    const pending = ms.pendingApproval;
    const response = approve ? this.config.approveResponse : this.config.rejectResponse;
    await this.tmux.sendText(ms.target, response, true);
    this.noteUserSend(ms, response);
    if (pending) this.store.markApprovalResolved(pending.id);
    ms.pendingApproval = undefined;
    ms.info.needsApproval = false;
    ms.info.needsInput = false;
    this.bus.approval(id, false, undefined);
    this.bus.sessionUpdated(ms.info);
  }

  async kill(id: string): Promise<void> {
    const ms = this.sessions.get(id);
    if (!ms || ms.info.closed) throw new Error(`session ${id} is not active`);
    await this.tmux.killPane(ms.target);
    ms.info.closed = true;
    ms.info.status = 'done';
    ms.meta = { ...ms.meta, closed: true };
    this.store.upsertSession(ms.meta);
    this.bus.sessionUpdated(ms.info);
  }

  async patch(id: string, input: SessionPatchInput): Promise<SessionInfo> {
    const ms = this.sessions.get(id);
    if (!ms) throw new Error(`session ${id} not found`);
    if (input.displayName !== undefined) ms.meta.displayName = input.displayName;
    if (input.project !== undefined) ms.meta.project = input.project;
    if (input.agentType !== undefined) ms.meta.agentType = input.agentType;
    if (input.tags !== undefined) ms.meta.tags = input.tags;
    if (input.pinned !== undefined) ms.meta.pinned = input.pinned;
    if (input.archived !== undefined) ms.meta.archived = input.archived;
    if (input.notes !== undefined) ms.meta.notes = input.notes;

    ms.info.displayName = ms.meta.displayName ?? ms.meta.project ?? ms.info.id;
    ms.info.project = ms.meta.project;
    ms.info.agentType = ms.meta.agentType;
    ms.info.tags = ms.meta.tags ?? [];
    ms.info.pinned = ms.meta.pinned;
    ms.info.archived = ms.meta.archived;
    this.store.upsertSession(ms.meta);
    this.bus.sessionUpdated(ms.info);
    return ms.info;
  }

  async archive(id: string): Promise<SessionInfo> {
    const ms = this.require(id);
    return this.patch(id, { archived: !ms.meta.archived });
  }

  /** Remove the app record entirely (does not touch tmux). */
  async deleteRecord(id: string): Promise<void> {
    const ms = this.sessions.get(id);
    if (ms && ms.pipeOn && ms.paneId && this.pipeTargets.has(ms.paneId)) {
      await this.tmux.pipeStop(ms.target);
      this.pipeTargets.delete(ms.paneId);
    }
    this.sessions.delete(id);
    this.store.deleteSession(id);
    this.maybeBroadcastList();
  }
}
