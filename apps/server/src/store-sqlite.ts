import { DatabaseSync } from 'node:sqlite';
import type { ApprovalRecord, SessionRecord, Store } from './store.js';

export function createSqliteStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      project TEXT,
      agent_type TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      cwd TEXT,
      branch TEXT,
      worktree TEXT,
      launch_command TEXT,
      notes TEXT,
      closed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const getSessionStmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const listSessionsStmt = db.prepare('SELECT * FROM sessions ORDER BY created_at ASC');
  const upsertStmt = db.prepare(`
    INSERT INTO sessions (
      id, display_name, project, agent_type, tags, pinned, archived, created_at,
      cwd, branch, worktree, launch_command, notes, closed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, sessions.display_name),
      project = COALESCE(excluded.project, sessions.project),
      agent_type = COALESCE(excluded.agent_type, sessions.agent_type),
      tags = excluded.tags,
      pinned = excluded.pinned,
      archived = excluded.archived,
      cwd = COALESCE(excluded.cwd, sessions.cwd),
      branch = COALESCE(excluded.branch, sessions.branch),
      worktree = COALESCE(excluded.worktree, sessions.worktree),
      launch_command = COALESCE(excluded.launch_command, sessions.launch_command),
      notes = COALESCE(excluded.notes, sessions.notes),
      closed = excluded.closed
  `);
  const deleteStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const getKvStmt = db.prepare('SELECT value FROM kv WHERE key = ?');
  const setKvStmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const addApprovalStmt = db.prepare(
    'INSERT INTO approvals (id, session_id, title, detail, created_at, resolved) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const listApprovalsStmt = db.prepare('SELECT * FROM approvals');
  const resolveStmt = db.prepare('UPDATE approvals SET resolved = 1 WHERE id = ?');

  function rowToRecord(r: Record<string, unknown>): SessionRecord {
    return {
      id: String(r.id),
      displayName: (r.display_name as string) || undefined,
      project: (r.project as string) || undefined,
      agentType: (r.agent_type as string) || undefined,
      tags: JSON.parse((r.tags as string) || '[]'),
      pinned: Boolean(r.pinned),
      archived: Boolean(r.archived),
      createdAt: Number(r.created_at),
      cwd: (r.cwd as string) || undefined,
      branch: (r.branch as string) || undefined,
      worktree: (r.worktree as string) || undefined,
      launchCommand: (r.launch_command as string) || undefined,
      notes: (r.notes as string) || undefined,
      closed: Boolean(r.closed),
    };
  }

  return {
    getSession(id) {
      const r = getSessionStmt.get(id) as Record<string, unknown> | undefined;
      return r ? rowToRecord(r) : undefined;
    },
    listSessions() {
      return (listSessionsStmt.all() as Record<string, unknown>[]).map(rowToRecord);
    },
    upsertSession(rec) {
      upsertStmt.run(
        rec.id,
        rec.displayName ?? null,
        rec.project ?? null,
        rec.agentType ?? null,
        JSON.stringify(rec.tags ?? []),
        rec.pinned ? 1 : 0,
        rec.archived ? 1 : 0,
        rec.createdAt,
        rec.cwd ?? null,
        rec.branch ?? null,
        rec.worktree ?? null,
        rec.launchCommand ?? null,
        rec.notes ?? null,
        rec.closed ? 1 : 0,
      );
    },
    deleteSession(id) {
      deleteStmt.run(id);
    },
    getKv(key) {
      const r = getKvStmt.get(key) as { value: string } | undefined;
      return r?.value;
    },
    setKv(key, value) {
      setKvStmt.run(key, value);
    },
    addApproval(a) {
      addApprovalStmt.run(a.id, a.sessionId, a.title, a.detail, a.createdAt, a.resolved ? 1 : 0);
    },
    listApprovals() {
      return (listApprovalsStmt.all() as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        sessionId: String(r.session_id),
        title: String(r.title),
        detail: String(r.detail),
        createdAt: Number(r.created_at),
        resolved: Boolean(r.resolved),
      })) as ApprovalRecord[];
    },
    markApprovalResolved(id) {
      resolveStmt.run(id);
    },
    close() {
      db.close();
    },
  };
}
