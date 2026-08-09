import { useEffect, useState } from 'react';
import { useApp } from '../provider';

export function NoticeToast() {
  const { notice, setNotice } = useApp();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!notice) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      setNotice(null);
    }, 4200);
    return () => clearTimeout(t);
  }, [notice, setNotice]);

  if (!visible || !notice) return null;
  return (
    <div className="notice" role="alert">
      {notice}
    </div>
  );
}
