import { useEffect } from 'react';
import { useApp } from '../provider';
import { SessionList } from './SessionList';
import { SessionDetail } from './SessionDetail';
import { NoticeToast } from './NoticeToast';

export function AppShell() {
  const { selectedId, selectSession } = useApp();

  useEffect(() => {
    const onPop = () => selectSession(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [selectSession]);

  return (
    <div className="app-shell">
      {selectedId ? <SessionDetail key={selectedId} /> : <SessionList />}
      <NoticeToast />
    </div>
  );
}
