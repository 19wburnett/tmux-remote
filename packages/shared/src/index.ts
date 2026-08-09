export type SessionStatus =
  | 'running'
  | 'waiting'
  | 'needs_input'
  | 'error'
  | 'done'
  | 'unknown';

export type FilterKey = 'all' | 'running' | 'waiting' | 'failed' | 'pinned' | 'archived';

export interface SessionInfo {
  /** Stable identity — the tmux pane key (`session.window.pane`). */
  id: string;
  /** tmux session name the pane lives in. */
  tmuxSession: string;
  /** Window index within the tmux session. */
  window?: number;
  /** Pane index within the window. */
  pane?: number;
  /** User-facing title shown on cards. */
  displayName: string;
  status: SessionStatus;
  project?: string;
  branch?: string;
  worktree?: string;
  cwd?: string;
  agentType?: string;
  preview: string;
  lastActivityAt: number;
  createdAt: number;
  pinned: boolean;
  archived: boolean;
  /** true when an action is currently waiting on the user. */
  needsApproval: boolean;
  needsInput: boolean;
  attached: boolean;
  windows: number;
  tags: string[];
  error?: string;
  /** true when the underlying tmux session no longer exists. */
  closed: boolean;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  title: string;
  detail: string;
  createdAt: number;
}

export interface TranscriptLine {
  seq: number;
  ts: number;
  text: string;
}

/** One bubble in the chat view. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  ts: number;
  /** User messages: the text that was sent. */
  text?: string;
  /** Agent messages: raw (ANSI) terminal output lines. */
  lines?: string[];
}

/** Payload returned by the HTTP API when listing sessions. */
export interface SessionListResponse {
  sessions: SessionInfo[];
  approvals: ApprovalRequest[];
}

export interface SessionCreateInput {
  name?: string;
  cwd?: string;
  command?: string;
  project?: string;
  agentType?: string;
  tags?: string[];
  pinned?: boolean;
}

export interface SessionPatchInput {
  displayName?: string;
  project?: string;
  agentType?: string;
  tags?: string[];
  pinned?: boolean;
  archived?: boolean;
  notes?: string;
}

export interface SendInput {
  text: string;
  enter?: boolean;
}

export interface KeysInput {
  keys: string[];
}

export interface CommandInput {
  command: string;
  arg?: string;
}

export interface ApproveInput {
  approve: boolean;
}

export interface ScreenInput {
  lines: string[];
}

export interface AuthStatus {
  authenticated: boolean;
  username?: string;
  hostname: string;
  version: string;
}

export type ClientMessage =
  | { type: 'ping' }
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe' }
  | { type: 'send'; sessionId: string; text: string; enter?: boolean }
  | { type: 'keys'; sessionId: string; keys: string[] }
  | { type: 'command'; sessionId: string; command: string; arg?: string }
  | { type: 'approve'; sessionId: string; approve: boolean };

export type ServerMessage =
  | { type: 'ready'; serverTime: number; hostname: string; version: string }
  | { type: 'pong' }
  | { type: 'sessions'; sessions: SessionInfo[]; approvals: ApprovalRequest[] }
  | { type: 'session-updated'; session: SessionInfo }
  | { type: 'transcript'; sessionId: string; lines: TranscriptLine[]; reset: boolean }
  | { type: 'output'; sessionId: string; lines: TranscriptLine[] }
  | { type: 'chat'; sessionId: string; messages: ChatMessage[] }
  | { type: 'chat-user'; sessionId: string; message: ChatMessage }
  | { type: 'chat-output'; sessionId: string; message: ChatMessage }
  | { type: 'approval'; sessionId: string; pending: boolean; request?: ApprovalRequest }
  | { type: 'error'; message: string };

export const SLASH_COMMANDS = [
  { name: '/status', description: 'Show session status and context', group: 'session' },
  { name: '/interrupt', description: 'Send Ctrl-C to the agent', group: 'session' },
  { name: '/clear', description: 'Clear the terminal screen', group: 'session' },
  { name: '/restart', description: 'Restart the pane/agent', group: 'session' },
  { name: '/cd', description: 'Change directory in the pane', group: 'session', arg: true },
  { name: '/rename', description: 'Rename this session', group: 'session', arg: true },
  { name: '/pin', description: 'Pin this session to the top', group: 'session' },
  { name: '/unpin', description: 'Remove the pin', group: 'session' },
  { name: '/archive', description: 'Archive this session', group: 'session' },
  { name: '/kill', description: 'Kill this pane/agent', group: 'session', confirm: true },
  { name: '/keys', description: 'Open the quick-keys bar', group: 'ui' },
  { name: '/terminal', description: 'Open the live terminal panel', group: 'ui' },
] as const;

export type SlashCommandName = (typeof SLASH_COMMANDS)[number]['name'];
