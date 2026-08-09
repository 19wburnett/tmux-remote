import { useMemo, useState } from 'react';
import type { SessionInfo } from '@claude-remote/shared';
import { useApp } from '../provider';
import { timeAgo, truncate } from '../utils';
import { Header } from './Header';
import { Sheet } from './Sheet';
import { IconAlert, IconMore, IconPlus, IconSearch, IconStar } from './icons';

type Filter = 'all' | 'running' | 'waiting' | 'failed' | 'pinned' | 'archived';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'failed', label: 'Failed' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'archived', label: 'Archived' },
];

function attentionWeight(s: SessionInfo): number {
  if (s.needsApproval) return 0;
  if (s.status === 'needs_input' || s.status === 'waiting') return 1;
  if (s.pinned) return 2;
  return 3;
}

export function SessionList() {
  const { sessions, selectSession, logout, hostname, username, refreshSessions } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      if (s.project && !s.archived) set.add(s.project);
    }
    return [...set].slice(0, 8);
  }, [sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = sessions.filter((s) => {
      if (filter === 'archived') return s.archived;
      if (s.archived) return false;
      if (filter === 'running' && s.status !== 'running') return false;
      if (filter === 'waiting' && s.status !== 'waiting' && s.status !== 'needs_input') return false;
      if (filter === 'failed' && s.status !== 'error') return false;
      if (filter === 'pinned' && !s.pinned) return false;
      if (q) {
        const hay = `${s.displayName} ${s.project ?? ''} ${s.branch ?? ''} ${s.agentType ?? ''} ${s.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      const wa = attentionWeight(a);
      const wb = attentionWeight(b);
      if (wa !== wb) return wa - wb;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastActivityAt - a.lastActivityAt;
    });
    return list;
  }, [sessions, query, filter]);

  const waitingCount = sessions.filter((s) => !s.archived && (s.needsApproval || s.status === 'waiting' || s.status === 'needs_input')).length;

  return (
    <>
      <Header
        title="Sessions"
        subtitle={`${hostname || 'desktop'}${waitingCount ? ` · ${waitingCount} waiting` : ''}`}
        right={
          <>
            <button className="icon-btn" onClick={() => void refreshSessions()} aria-label="Refresh">
              <IconRefreshLite />
            </button>
            <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">
              <IconMore />
            </button>
            <button className="icon-btn" onClick={() => setCreateOpen(true)} aria-label="New session" style={{ color: 'var(--accent)' }}>
              <IconPlus />
            </button>
          </>
        }
      />

      <div className="main">
        <div className="toolbar">
          <div className="search">
            <IconSearch width={16} height={16} />
            <input
              placeholder="Search sessions, projects, branches…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="chips">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`chip ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
            {projects.map((p) => (
              <button
                key={p}
                className={`chip ${filter === p ? 'active' : ''}`}
                onClick={() => setFilter(filter === p ? 'all' : (p as Filter))}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="session-list">
          {filtered.length === 0 && (
            <div className="empty">
              <div className="big">▸</div>
              {sessions.length === 0
                ? 'No tmux sessions found.\nCreate one, or start a tmux session on your desktop.'
                : 'Nothing matches this filter.'}
            </div>
          )}
          {filtered.map((s) => (
            <SessionCard key={s.id} session={s} onOpen={() => selectSession(s.id)} />
          ))}
        </div>
      </div>

      {menuOpen && (
        <Sheet title={`${username ?? ''}`} onClose={() => setMenuOpen(false)}>
          <button className="sheet-row" onClick={() => { setMenuOpen(false); void refreshSessions(); }}>
            <span className="icon">↻</span> Refresh sessions
          </button>
          <button className="sheet-row" onClick={() => { setMenuOpen(false); void logout(); }}>
            <span className="icon">⎋</span> Sign out
            <span className="sub">{hostname}</span>
          </button>
        </Sheet>
      )}

      {createOpen && <CreateSessionSheet onClose={() => setCreateOpen(false)} />}
    </>
  );
}

function IconRefreshLite() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
    </svg>
  );
}

function SessionCard({ session: s, onOpen }: { session: SessionInfo; onOpen: () => void }) {
  const borderClass = s.needsApproval
    ? 'border-approval'
    : s.status === 'error'
      ? 'border-error'
      : s.status === 'needs_input'
        ? 'border-needs_input'
        : s.status === 'waiting'
          ? 'border-waiting'
          : '';
  return (
    <button className={`session-card ${borderClass} ${s.closed ? 'closed' : ''}`} onClick={onOpen}>
      <div className="sc-top">
        <span className={`status-dot ${s.status}`} />
        <span className="sc-title">{s.displayName}</span>
        {s.pinned && <IconStar width={13} height={13} className="sc-pin" />}
        <span className="sc-time">{s.closed ? 'closed' : timeAgo(s.lastActivityAt)}</span>
      </div>
      {(s.project || s.branch || s.agentType) && (
        <div className="sc-meta">
          {s.agentType && <span>{s.agentType}</span>}
          {s.project && <span>{s.project}</span>}
          {s.branch && <span className="mono-branch">{s.branch}</span>}
          {s.worktree && s.worktree !== s.project && <span className="dim">{truncate(s.worktree, 24)}</span>}
        </div>
      )}
      {s.preview && <div className="sc-preview">{s.preview}</div>}
      <div className="sc-badges">
        {s.needsApproval && (
          <span className="badge approval">
            <IconAlert width={10} height={10} style={{ verticalAlign: '-1px', marginRight: 3 }} /> approval
          </span>
        )}
        {s.status === 'waiting' && <span className="badge waiting">waiting</span>}
        {s.status === 'needs_input' && <span className="badge waiting">needs input</span>}
        {s.closed && <span className="badge closed">closed</span>}
      </div>
    </button>
  );
}

function CreateSessionSheet({ onClose }: { onClose: () => void }) {
  const { createSession } = useApp();
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await createSession({ name: name || undefined, cwd: cwd || undefined, command: command || undefined });
      onClose();
    } catch (e) {
      // surface via provider notice already
      setBusy(false);
    }
  };

  return (
    <Sheet title="New session" onClose={onClose}>
      <input
        className="field"
        placeholder="Name (optional — defaults to agent-…)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="field"
        placeholder="Working directory (optional, e.g. ~/code/myapp)"
        value={cwd}
        onChange={(e) => setCwd(e.target.value)}
      />
      <input
        className="field"
        placeholder="Command (optional, e.g. claude)"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
      />
      <button className="primary-btn" onClick={() => void submit()} disabled={busy}>
        {busy ? 'Starting…' : 'Start session'}
      </button>
    </Sheet>
  );
}
