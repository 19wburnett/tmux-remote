import { useState } from 'react';
import { useApp } from '../provider';
import { api } from '../api';

export function LoginScreen() {
  const { login, hostname } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resetMode, setResetMode] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [resetNewUser, setResetNewUser] = useState('');
  const [resetNewPass, setResetNewPass] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

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

  const requestToken = async () => {
    setResetBusy(true);
    setResetMsg(null);
    try {
      await api.forgotPassword();
      setResetMsg(
        `Reset token written to the server and logged. On the machine that runs claude-remote:\n\n` +
          `  cat ~/.claude-remote/data/reset-token\n` +
          `  # or: journalctl --user -u claude-remote | grep "reset token"`,
      );
    } catch (e) {
      setResetMsg(`Could not request a reset token: ${(e as Error).message}`);
    } finally {
      setResetBusy(false);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetBusy(true);
    setResetMsg(null);
    try {
      const res = await api.resetPassword(resetToken.trim(), resetNewUser.trim(), resetNewPass);
      setResetMode(false);
      setUsername(res.username);
      setPassword(resetNewPass);
      setResetToken('');
      setResetNewUser('');
      setResetNewPass('');
      setError('Password reset. Sign in with your new credentials.');
      const ok = await login(res.username, resetNewPass);
      if (!ok) setError('Password reset. Sign in with your new credentials.');
    } catch (e) {
      setResetMsg((e as Error).message || 'reset failed');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-mark">▸</div>
      <div className="login-title">claude-remote</div>
      <div className="login-sub">
        {hostname || 'your desktop'} · tmux control surface
      </div>

      {!resetMode ? (
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
          <button className="login-link" type="button" onClick={() => { setResetMode(true); setError(null); }}>
            Forgot password?
          </button>
        </form>
      ) : (
        <form className="login-form" onSubmit={submitReset}>
          <div className="login-sub" style={{ textAlign: 'center', fontSize: 12.5 }}>
            Reset your password. First generate a one-time token on the server,
            then paste it here with your new credentials.
          </div>
          <button className="login-btn ghost" type="button" onClick={() => void requestToken()} disabled={resetBusy}>
            {resetBusy ? 'Generating…' : 'Generate reset token'}
          </button>
          {resetMsg && <div className="reset-hint">{resetMsg}</div>}
          <input
            className="login-field"
            placeholder="Reset token"
            autoCapitalize="none"
            autoCorrect="off"
            value={resetToken}
            onChange={(e) => setResetToken(e.target.value)}
          />
          <input
            className="login-field"
            placeholder="New username"
            autoCapitalize="none"
            autoCorrect="off"
            value={resetNewUser}
            onChange={(e) => setResetNewUser(e.target.value)}
          />
          <input
            className="login-field"
            placeholder="New password (6+ chars)"
            type="password"
            value={resetNewPass}
            onChange={(e) => setResetNewPass(e.target.value)}
          />
          <button
            className="login-btn"
            disabled={resetBusy || !resetToken.trim() || !resetNewUser.trim() || resetNewPass.length < 6}
            type="submit"
          >
            Reset password
          </button>
          <button className="login-link" type="button" onClick={() => { setResetMode(false); setResetMsg(null); }}>
            ← Back to sign in
          </button>
        </form>
      )}
    </div>
  );
}
