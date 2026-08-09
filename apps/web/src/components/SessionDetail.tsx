import { useState } from 'react';
import { useApp } from '../provider';
import { statusLabel } from '../utils';
import { Header } from './Header';
import { OutputView } from './OutputView';
import { Composer } from './Composer';
import { QuickKeysBar } from './QuickKeysBar';
import { TerminalDrawer } from './TerminalDrawer';
import { ApprovalBanner } from './ApprovalBanner';
import { Sheet } from './Sheet';
import {
  IconArchive,
  IconMore,
  IconPin,
  IconRename,
  IconTerminal,
  IconTrash,
} from './icons';

export function SessionDetail() {
  const { sessions, selectedId, selectSession, transcripts, command, patchSession, archive, kill, deleteRecord, setNotice } = useApp();
  const [quickKeysOpen, setQuickKeysOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const session = sessions.find((s) => s.id === selectedId);
  if (!session) {
    return (
      <div className="app-shell">
        <Header title="Session" onBack={() => selectSession(null)} />
        <div className="empty">Session not found.</div>
      </div>
    );
  }

  const lines = transcripts[session.id] ?? [];

  const infoLine = [session.project, session.branch, session.worktree, session.cwd]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <>
      <div className="detail">
        <Header
          title={session.displayName}
          subtitle={`${statusLabel(session.status)}${session.agentType ? ` · ${session.agentType}` : ''}`}
          onBack={() => selectSession(null)}
          right={
            <>
              <button className="icon-btn" onClick={() => setTerminalOpen(true)} aria-label="Terminal">
                <IconTerminal />
              </button>
              <button className="icon-btn" onClick={() => setMoreOpen(true)} aria-label="Actions">
                <IconMore />
              </button>
            </>
          }
        />

        <div className="detail-meta">
          <span className={`status-dot ${session.status}`} />
          <span className="status-label">{statusLabel(session.status)}</span>
          <span className="info-line">{infoLine || session.tmuxSession}</span>
        </div>

        <ApprovalBanner sessionId={session.id} />

        <div className="quick-actions">
          <button className="qa-chip" onClick={() => void command('interrupt')}>
            ⏹ Interrupt
          </button>
          <button className="qa-chip" onClick={() => void command('clear')}>
            Clear
          </button>
          <button className="qa-chip" onClick={() => void command('status').then((m) => m && setNotice(m.replace(/\n/g, '  ·  ')))}>
            Status
          </button>
          <button className="qa-chip" onClick={() => setQuickKeysOpen((v) => !v)}>
            ⌨ Keys
          </button>
          <button className="qa-chip" onClick={() => setTerminalOpen(true)}>
            ▦ Terminal
          </button>
          <button className="qa-chip danger" onClick={() => setMoreOpen(true)}>
            ▸ More
          </button>
        </div>

        <OutputView lines={lines} />

        {quickKeysOpen && <QuickKeysBar onClose={() => setQuickKeysOpen(false)} />}
        <Composer onOpenKeys={() => setQuickKeysOpen(true)} onOpenTerminal={() => setTerminalOpen(true)} />
      </div>

      {terminalOpen && <TerminalDrawer sessionId={session.id} onClose={() => setTerminalOpen(false)} />}

      {moreOpen && (
        <Sheet title="Session actions" onClose={() => setMoreOpen(false)}>
          <button
            className="sheet-row"
            onClick={() => {
              void patchSession(session.id, { pinned: !session.pinned });
              setMoreOpen(false);
            }}
          >
            <span className="icon">{session.pinned ? '☆' : '★'}</span>
            {session.pinned ? 'Unpin' : 'Pin to top'}
          </button>
          <button className="sheet-row" onClick={() => { setMoreOpen(false); setRenameOpen(true); }}>
            <span className="icon"><IconRename width={17} height={17} /></span>
            Rename
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              void archive();
              setMoreOpen(false);
            }}
          >
            <span className="icon"><IconArchive width={17} height={17} /></span>
            {session.archived ? 'Unarchive' : 'Archive (hide)'}
          </button>
          <button
            className="sheet-row danger"
            onClick={() => {
              setMoreOpen(false);
              if (window.confirm(`Kill tmux session “${session.id}”?`)) void kill();
            }}
          >
            <span className="icon"><IconTrash width={17} height={17} /></span>
            Kill tmux session
          </button>
          <button
            className="sheet-row danger"
            onClick={() => {
              setMoreOpen(false);
              if (window.confirm(`Remove “${session.id}” from the app? (tmux is untouched)`)) void deleteRecord();
            }}
          >
            <span className="icon"><IconPin width={17} height={17} /></span>
            Remove from app
          </button>
        </Sheet>
      )}

      {renameOpen && (
        <RenameSheet
          current={session.displayName}
          onClose={() => setRenameOpen(false)}
          onSave={(name) => {
            void patchSession(session.id, { displayName: name });
            setRenameOpen(false);
          }}
        />
      )}
    </>
  );
}

function RenameSheet({ current, onClose, onSave }: { current: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(current);
  return (
    <Sheet title="Rename session" onClose={onClose}>
      <input
        className="field"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name"
      />
      <button className="primary-btn" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
        Save
      </button>
    </Sheet>
  );
}
