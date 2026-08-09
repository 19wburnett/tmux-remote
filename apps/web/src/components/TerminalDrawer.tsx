import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TranscriptLine } from '@claude-remote/shared';
import { useApp } from '../provider';
import { api } from '../api';
import { IconX } from './icons';

const THEME = {
  background: '#0a0c0f',
  foreground: '#d8dee9',
  cursor: '#6ea8fe',
  selectionBackground: 'rgba(110,168,254,0.28)',
  black: '#14181f',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#e7c25a',
  blue: '#6ea8fe',
  magenta: '#b99af8',
  cyan: '#5cd6e8',
  white: '#e7eaf0',
  brightBlack: '#5d6675',
  brightRed: '#ff8f8f',
  brightGreen: '#7df0a8',
  brightYellow: '#f5dd7a',
  brightBlue: '#a6c8ff',
  brightMagenta: '#d0bcfc',
  brightCyan: '#8ae4f0',
  brightWhite: '#ffffff',
};

export function TerminalDrawer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [inputMode, setInputMode] = useState(false);
  const inputModeRef = useRef(false);
  const lastSeqRef = useRef(-1);
  const { subscribeOutput, sendText } = useApp();

  useEffect(() => {
    inputModeRef.current = inputMode;
  }, [inputMode]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 4000,
      convertEol: true,
      cursorBlink: true,
      disableStdin: true,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      if (inputModeRef.current) void sendText(data, false);
    });

    const fitNow = () => {
      try {
        fit.fit();
      } catch {
        /* host not measured yet */
      }
    };
    const t1 = setTimeout(fitNow, 60);
    const ro = new ResizeObserver(() => fitNow());
    ro.observe(host);

    // Initial snapshot from the server transcript.
    let alive = true;
    const readyRef = { current: false };
    void api
      .transcript(sessionId)
      .then(({ lines }) => {
        if (!alive) return;
        for (const l of lines) {
          lastSeqRef.current = Math.max(lastSeqRef.current, l.seq);
          term.writeln(l.text || '');
        }
        readyRef.current = true;
        fitNow();
      })
      .catch(() => undefined);

    const unsub = subscribeOutput((lines: TranscriptLine[]) => {
      if (!readyRef.current) return; // snapshot will include these lines
      const t = termRef.current;
      if (!t) return;
      for (const l of lines) {
        if (l.seq <= lastSeqRef.current) continue;
        lastSeqRef.current = l.seq;
        t.writeln(l.text || '');
      }
    });

    return () => {
      alive = false;
      clearTimeout(t1);
      ro.disconnect();
      unsub();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, subscribeOutput, sendText]);

  return (
    <div className="term-drawer">
      <div className="term-bar">
        <button className="icon-btn" onClick={onClose} aria-label="Close terminal">
          <IconX />
        </button>
        <div className="title">{sessionId}</div>
        <div className="toggle">
          <label style={{ cursor: 'pointer' }}>Keyboard</label>
          <button
            className={`chip ${inputMode ? 'active' : ''}`}
            onClick={() => setInputMode((v) => !v)}
            style={{ width: 44 }}
          >
            {inputMode ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
      <div className="term-box" ref={hostRef} />
      <div className="term-hint">
        Live pane view · new output streams in automatically
        {inputMode && <span style={{ color: 'var(--green)' }}>· typing enabled</span>}
      </div>
    </div>
  );
}
