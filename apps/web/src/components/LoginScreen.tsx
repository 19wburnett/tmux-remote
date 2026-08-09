import { useState } from 'react';
import { useApp } from '../provider';

export function LoginScreen() {
  const { login, hostname } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await login(username, password);
    if (!ok) {
      setError('Invalid username or password');
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-mark">▸</div>
      <div className="login-title">claude-remote</div>
      <div className="login-sub">
        {hostname || 'your desktop'} · tmux control surface
      </div>
      <form className="login-form" onSubmit={submit}>
        <input
          className="login-field"
          placeholder="Username"
          autoCapitalize="none"
          autoCorrect="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="login-field"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div style={{ color: 'var(--red)', fontSize: 12.5 }}>{error}</div>}
        <button className="login-btn" disabled={busy || !username || !password} type="submit">
          {busy ? 'Connecting…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
