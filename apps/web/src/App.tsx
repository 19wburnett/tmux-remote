import { useApp } from './provider';
import { LoginScreen } from './components/LoginScreen';
import { AppShell } from './components/AppShell';

export function App() {
  const { authLoading, authed } = useApp();
  if (authLoading) {
    return (
      <div className="boot">
        <div className="boot-dot" />
        <div className="boot-text">claude-remote</div>
      </div>
    );
  }
  return authed ? <AppShell /> : <LoginScreen />;
}
