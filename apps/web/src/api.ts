import type {
  AuthStatus,
  SessionCreateInput,
  SessionInfo,
  SessionListResponse,
  SessionPatchInput,
  TranscriptLine,
} from '@claude-remote/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, method: string = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      msg = j.error || msg;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function sid(id: string): string {
  return encodeURIComponent(id);
}

export const api = {
  login: (username: string, password: string) =>
    req<{ ok: boolean; username: string }>('/api/auth/login', 'POST', { username, password }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', 'POST'),
  me: () => req<AuthStatus>('/api/auth/me'),
  forgotPassword: () => req<{ ok: boolean; hint: string }>('/api/auth/forgot', 'POST'),
  resetPassword: (token: string, username: string, password: string) =>
    req<{ ok: boolean; username: string }>('/api/auth/reset', 'POST', { token, username, password }),
  changeCredentials: (currentPassword: string, newUsername?: string, newPassword?: string) =>
    req<{ ok: boolean; username: string }>('/api/auth/change', 'POST', { currentPassword, newUsername, newPassword }),
  health: () => req<{ ok: boolean }>('/api/health'),

  listSessions: () => req<SessionListResponse>('/api/sessions'),
  createSession: (input: SessionCreateInput) =>
    req<{ session: SessionInfo }>('/api/sessions', 'POST', input),
  patchSession: (id: string, input: SessionPatchInput) =>
    req<{ session: SessionInfo }>(`/api/sessions/${sid(id)}`, 'PATCH', input),
  send: (id: string, text: string, enter: boolean) =>
    req<{ ok: boolean }>(`/api/sessions/${sid(id)}/send`, 'POST', { text, enter }),
  keys: (id: string, keys: string[]) =>
    req<{ ok: boolean }>(`/api/sessions/${sid(id)}/keys`, 'POST', { keys }),
  command: (id: string, command: string, arg?: string) =>
    req<{ message: string }>(`/api/sessions/${sid(id)}/command`, 'POST', { command, arg }),
  approve: (id: string, approve: boolean) =>
    req<{ ok: boolean }>(`/api/sessions/${sid(id)}/approve`, 'POST', { approve }),
  kill: (id: string) => req<{ ok: boolean }>(`/api/sessions/${sid(id)}/kill`, 'POST'),
  archive: (id: string) => req<{ session: SessionInfo }>(`/api/sessions/${sid(id)}/archive`, 'POST'),
  deleteRecord: (id: string) => req<{ ok: boolean }>(`/api/sessions/${sid(id)}`, 'DELETE'),
  transcript: (id: string) =>
    req<{ lines: TranscriptLine[] }>(`/api/sessions/${sid(id)}/transcript`),
  screen: (id: string) => req<{ lines: string[] }>(`/api/sessions/${sid(id)}/screen`),
};
