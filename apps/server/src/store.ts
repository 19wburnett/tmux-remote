import { join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface SessionRecord {
  id: string;
  displayName?: string;
  project?: string;
  agentType?: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  cwd?: string;
  branch?: string;
  worktree?: string;
  launchCommand?: string;
  notes?: string;
  closed?: boolean;
}

export interface ApprovalRecord {
  id: string;
  sessionId: string;
  title: string;
  detail: string;
  createdAt: number;
  resolved: boolean;
}

export interface Store {
  getSession(id: string): SessionRecord | undefined;
  listSessions(): SessionRecord[];
  /** Shallow-merge fields into the stored record; creates it if absent. */
  upsertSession(rec: SessionRecord): void;
  deleteSession(id: string): void;
  getKv(key: string): string | undefined;
  setKv(key: string, value: string): void;
  addApproval(a: ApprovalRecord): void;
  listApprovals(): ApprovalRecord[];
  markApprovalResolved(id: string): void;
  close(): void;
}

export async function createStore(dataDir: string): Promise<Store> {
  mkdirSync(dataDir, { recursive: true });
  try {
    const { createSqliteStore } = await import('./store-sqlite.js');
    return createSqliteStore(join(dataDir, 'claude-remote.db'));
  } catch (err) {
    console.warn('[claude-remote] node:sqlite unavailable, falling back to JSON storage:', (err as Error).message);
    return createJsonStore(join(dataDir, 'store.json'));
  }
}

function createJsonStore(file: string): Store {
  let data: { sessions: Record<string, SessionRecord>; approvals: ApprovalRecord[]; kv: Record<string, string> } = {
    sessions: {},
    approvals: [],
    kv: {},
  };

  function persist(): void {
    writeFileSync(file, JSON.stringify(data, null, 2));
  }

  function load(): void {
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        data = { sessions: {}, approvals: [], kv: {}, ...parsed };
      } catch {
        // corrupt file -> start fresh
      }
    }
  }

  load();

  return {
    getSession(id) {
      return data.sessions[id];
    },
    listSessions() {
      return Object.values(data.sessions).sort((a, b) => a.createdAt - b.createdAt);
    },
    upsertSession(rec) {
      const prev = data.sessions[rec.id] ?? {};
      data.sessions[rec.id] = { ...prev, ...rec };
      persist();
    },
    deleteSession(id) {
      delete data.sessions[id];
      persist();
    },
    getKv(key) {
      return data.kv[key];
    },
    setKv(key, value) {
      data.kv[key] = value;
      persist();
    },
    addApproval(a) {
      data.approvals.push(a);
      persist();
    },
    listApprovals() {
      return data.approvals;
    },
    markApprovalResolved(id) {
      const a = data.approvals.find((x) => x.id === id);
      if (a) {
        a.resolved = true;
        persist();
      }
    },
    close() {},
  };
}
