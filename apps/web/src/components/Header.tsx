import type { ReactNode } from 'react';
import { useApp } from '../provider';
import { IconBack } from './icons';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}

export function Header({ title, subtitle, onBack, right }: HeaderProps) {
  const { wsConnected } = useApp();
  return (
    <header className="header">
      <div className="header-row">
        {onBack ? (
          <button className="header-back" onClick={onBack} aria-label="Back">
            <IconBack />
          </button>
        ) : (
          <span className={`conn-dot ${wsConnected ? 'on' : 'off'}`} title={wsConnected ? 'connected' : 'reconnecting'} />
        )}
        <div className="header-title">
          {title}
          {subtitle && <span className="sub">{subtitle}</span>}
        </div>
        <div className="header-actions">{right}</div>
      </div>
    </header>
  );
}
