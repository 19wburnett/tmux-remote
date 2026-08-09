import { useApp } from '../provider';

const QUICK_KEYS: { keys: string[]; label: string; danger?: boolean }[] = [
  { keys: ['C-c'], label: 'Ctrl-C', danger: true },
  { keys: ['C-d'], label: 'Ctrl-D' },
  { keys: ['C-l'], label: 'Ctrl-L' },
  { keys: ['Escape'], label: 'Esc' },
  { keys: ['Tab'], label: 'Tab' },
  { keys: ['S-Tab'], label: '⇧Tab' },
  { keys: ['Up'], label: '↑' },
  { keys: ['Down'], label: '↓' },
  { keys: ['Left'], label: '←' },
  { keys: ['Right'], label: '→' },
  { keys: ['Enter'], label: '⏎' },
  { keys: ['PageUp'], label: 'PgUp' },
  { keys: ['PageDown'], label: 'PgDn' },
  { keys: ['Home'], label: 'Home' },
  { keys: ['End'], label: 'End' },
  { keys: ['BSpace'], label: '⌫' },
];

export function QuickKeysBar({ onClose }: { onClose: () => void }) {
  const { sendKeys, setNotice } = useApp();

  const tap = async (keys: string[]) => {
    try {
      await sendKeys(keys);
    } catch {
      setNotice('Session is closed or unreachable');
    }
  };

  return (
    <div className="quickkeys">
      <div className="qk-label">Quick keys — sent to the active pane</div>
      <div className="qk-strip">
        {QUICK_KEYS.map((k) => (
          <button key={k.label} className={`qk-key ${k.danger ? 'danger' : ''}`} onClick={() => void tap(k.keys)}>
            {k.label}
          </button>
        ))}
        <button className="qk-key" onClick={onClose} style={{ color: 'var(--text-faint)' }}>
          ✕
        </button>
      </div>
    </div>
  );
}
