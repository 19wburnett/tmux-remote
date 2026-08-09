import type { SessionStatus } from '@claude-remote/shared';

export function statusLabel(s: SessionStatus): string {
  switch (s) {
    case 'running':
      return 'Running';
    case 'waiting':
      return 'Waiting';
    case 'needs_input':
      return 'Needs input';
    case 'error':
      return 'Error';
    case 'done':
      return 'Done';
    default:
      return 'Unknown';
  }
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 10) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}
