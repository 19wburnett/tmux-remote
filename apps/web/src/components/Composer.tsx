import { useRef, useState } from 'react';
import { SLASH_COMMANDS } from '@claude-remote/shared';
import { useApp } from '../provider';
import { IconClip, IconMic, IconSend } from './icons';

interface ComposerProps {
  onOpenKeys: () => void;
  onOpenTerminal: () => void;
}

export function Composer({ onOpenKeys, onOpenTerminal }: ComposerProps) {
  const { selectedId, sendText, command, patchSession, archive, kill, setNotice } = useApp();
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const id = selectedId ?? '';
  const trimmed = text.trim();
  const isSlash = trimmed.startsWith('/');
  const slashToken = isSlash ? trimmed.split(/\s+/)[0] : '';
  const matches = isSlash
    ? SLASH_COMMANDS.filter((c) => c.name.startsWith(slashToken)).slice(0, 6)
    : [];

  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const clear = () => {
    setText('');
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto';
    });
  };

  const runSlash = async (raw: string) => {
    const [name, ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (name) {
      case '/status': {
        const m = await command('status');
        if (m) setNotice(m.replace(/\n/g, '  ·  '));
        break;
      }
      case '/interrupt':
        await command('interrupt');
        setNotice('Sent Ctrl-C');
        break;
      case '/clear':
        await command('clear');
        break;
      case '/restart':
        if (window.confirm('Restart this session?')) {
          const m = await command('restart');
          if (m) setNotice(m);
        }
        break;
      case '/cd':
        if (!arg) {
          setNotice('Usage: /cd <path>');
          break;
        }
        await command('cd', arg);
        break;
      case '/rename':
        if (!arg) {
          setNotice('Usage: /rename <name>');
          break;
        }
        await patchSession(id, { displayName: arg });
        setNotice(`Renamed to “${arg}”`);
        break;
      case '/pin':
        await patchSession(id, { pinned: true });
        break;
      case '/unpin':
        await patchSession(id, { pinned: false });
        break;
      case '/archive':
        await archive();
        break;
      case '/kill':
        if (window.confirm(`Kill tmux session “${id}”?`)) await kill();
        break;
      case '/keys':
        onOpenKeys();
        break;
      case '/terminal':
        onOpenTerminal();
        break;
      default:
        await sendText(raw);
    }
  };

  const send = async () => {
    if (!trimmed || !id) return;
    if (isSlash && matches.some((m) => m.name === slashToken) && !trimmed.includes(' ')) {
      // bare slash command with no args — execute if it doesn't take an arg
      const def = SLASH_COMMANDS.find((c) => c.name === slashToken);
      if (def && !('arg' in def)) {
        await runSlash(trimmed);
        clear();
        return;
      }
      if (def && 'arg' in def) {
        // keep editing to collect the argument
        return;
      }
    }
    if (isSlash) {
      await runSlash(trimmed);
      clear();
      return;
    }
    await sendText(trimmed);
    clear();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnter = e.key === 'Enter' || e.keyCode === 13 || e.which === 13;
    if (isEnter && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const pickSlash = async (c: (typeof SLASH_COMMANDS)[number]) => {
    if ('arg' in c && c.arg) {
      setText(`${c.name} `);
      taRef.current?.focus();
      return;
    }
    await runSlash(c.name);
    clear();
  };

  return (
    <div className="composer-wrap">
      {matches.length > 0 && (
        <div className="slash-picker">
          {matches.map((c) => (
            <button key={c.name} className="slash-item" onClick={() => void pickSlash(c)}>
              <span className="name">{c.name}</span>
              <span className="desc">{c.description}</span>
            </button>
          ))}
        </div>
      )}
      <div className="composer">
        <div className="composer-box">
          <textarea
            ref={taRef}
            rows={1}
            placeholder={id ? `Message ${id}…` : 'Select a session first'}
            value={text}
            disabled={!id}
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            onKeyDown={onKeyDown}
          />
          <button className="comp-btn" aria-label="Attach (coming soon)" title="Attach (coming soon)">
            <IconClip width={17} height={17} />
          </button>
        </div>
        {text.length === 0 ? (
          <button className="send-btn mic" aria-label="Voice (coming soon)" title="Voice (coming soon)">
            <IconMic width={18} height={18} />
          </button>
        ) : (
          <button className="send-btn" onClick={() => void send()} aria-label="Send">
            <IconSend width={18} height={18} />
          </button>
        )}
      </div>
    </div>
  );
}
