import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ApprovalRequest,
  ChatMessage,
  SessionCreateInput,
  SessionInfo,
  SessionPatchInput,
  TranscriptLine,
} from '@claude-remote/shared';
import { api } from './api';
import { RemoteClient } from './ws';

export interface AppContextValue {
  authLoading: boolean;
  authed: boolean;
  username?: string;
  hostname: string;
  wsConnected: boolean;
  sessions: SessionInfo[];
  approvals: ApprovalRequest[];
  selectedId: string | null;
  transcripts: Record<string, TranscriptLine[]>;
  chat: Record<string, ChatMessage[]>;
  notice: string | null;
  setNotice: (msg: string | null) => void;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  selectSession: (id: string | null) => void;
  refreshSessions: () => Promise<void>;
  createSession: (input: SessionCreateInput) => Promise<SessionInfo>;
  patchSession: (id: string, input: SessionPatchInput) => Promise<void>;
  sendText: (text: string, enter?: boolean) => Promise<void>;
  sendKeys: (keys: string[]) => Promise<void>;
  command: (command: string, arg?: string) => Promise<string | undefined>;
  approve: (approve: boolean) => Promise<void>;
  kill: () => Promise<void>;
  archive: () => Promise<void>;
  deleteRecord: () => Promise<void>;
  subscribeOutput: (cb: (lines: TranscriptLine[]) => void) => () => void;
  requestScreen: (id: string) => Promise<string[]>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [authLoading, setAuthLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState<string | undefined>();
  const [hostname, setHostname] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptLine[]>>({});
  const [chat, setChat] = useState<Record<string, ChatMessage[]>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const clientRef = useRef<RemoteClient | null>(null);
  const outputCbs = useRef(new Set<(lines: TranscriptLine[]) => void>());
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      const c = new RemoteClient();
      clientRef.current = c;
      c.onConnected(() => setWsConnected(true));
      c.onMessage((msg) => {
        if (msg.type === 'sessions') {
          setSessions(msg.sessions);
          setApprovals(msg.approvals);
        } else if (msg.type === 'session-updated') {
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.id === msg.session.id);
            if (idx === -1) return [...prev, msg.session];
            const next = [...prev];
            next[idx] = msg.session;
            return next;
          });
        } else if (msg.type === 'transcript') {
          setTranscripts((prev) => ({ ...prev, [msg.sessionId]: msg.lines }));
        } else if (msg.type === 'chat') {
          setChat((prev) => ({ ...prev, [msg.sessionId]: msg.messages }));
        } else if (msg.type === 'chat-user') {
          setChat((prev) => ({
            ...prev,
            [msg.sessionId]: [...(prev[msg.sessionId] ?? []), msg.message],
          }));
        } else if (msg.type === 'chat-output') {
          setChat((prev) => {
            const cur = prev[msg.sessionId] ?? [];
            const idx = cur.findIndex((m) => m.id === msg.message.id);
            if (idx === -1) return { ...prev, [msg.sessionId]: [...cur, msg.message] };
            const next = [...cur];
            next[idx] = msg.message;
            return { ...prev, [msg.sessionId]: next };
          });
        } else if (msg.type === 'output') {
          setTranscripts((prev) => {
            const cur = prev[msg.sessionId] ?? [];
            return { ...prev, [msg.sessionId]: [...cur, ...msg.lines].slice(-4000) };
          });
          outputCbs.current.forEach((cb) => cb(msg.lines));
        } else if (msg.type === 'approval') {
          if (msg.pending && msg.request) {
            setApprovals((prev) => {
              const rest = prev.filter((a) => a.sessionId !== msg.sessionId);
              return [...rest, msg.request!];
            });
          } else {
            setApprovals((prev) => prev.filter((a) => a.sessionId !== msg.sessionId));
          }
        } else if (msg.type === 'error') {
          setNotice(msg.message);
        }
      });
      c.connect();
    }
    return clientRef.current;
  }, []);

  // Auth bootstrap
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await api.me();
        if (active && me.authenticated) {
          setAuthed(true);
          setUsername(me.username);
          setHostname(me.hostname);
          getClient();
        }
      } catch {
        /* not authed */
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [getClient]);

  // Subscribe to selected session over WS.
  useEffect(() => {
    if (!authed) return;
    const c = getClient();
    if (selectedId) {
      c.subscribe(selectedId);
    } else {
      c.unsubscribe();
    }
    return () => c.unsubscribe();
  }, [authed, selectedId, getClient]);

  const login = useCallback(
    async (u: string, p: string) => {
      try {
        await api.login(u, p);
        const me = await api.me();
        setAuthed(true);
        setUsername(me.username);
        setHostname(me.hostname);
        getClient();
        return true;
      } catch (e) {
        setNotice((e as Error).message || 'login failed');
        return false;
      }
    },
    [getClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    clientRef.current?.close();
    clientRef.current = null;
    setAuthed(false);
    setUsername(undefined);
    setSessions([]);
    setApprovals([]);
    setTranscripts({});
    setChat({});
    setSelectedId(null);
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await api.listSessions();
      setSessions(res.sessions);
      setApprovals(res.approvals);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, []);

  const selectSession = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id === null) {
      clientRef.current?.unsubscribe();
    }
  }, []);

  const createSession = useCallback(async (input: SessionCreateInput) => {
    const res = await api.createSession(input);
    await refreshSessions();
    return res.session;
  }, [refreshSessions]);

  const patchSession = useCallback(
    async (id: string, input: SessionPatchInput) => {
      await api.patchSession(id, input);
      await refreshSessions();
    },
    [refreshSessions],
  );

  const currentId = useCallback(() => selectedIdRef.current, []);

  const sendText = useCallback(async (text: string, enter = true) => {
    const id = currentId();
    if (!id) return;
    try {
      await api.send(id, text, enter);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, [currentId]);

  const sendKeys = useCallback(async (keys: string[]) => {
    const id = currentId();
    if (!id) return;
    try {
      await api.keys(id, keys);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, [currentId]);

  const command = useCallback(
    async (cmd: string, arg?: string) => {
      const id = currentId();
      if (!id) return undefined;
      try {
        const res = await api.command(id, cmd, arg);
        return res.message;
      } catch (e) {
        setNotice((e as Error).message);
        return undefined;
      }
    },
    [currentId],
  );

  const approve = useCallback(
    async (ok: boolean) => {
      const id = currentId();
      if (!id) return;
      try {
        await api.approve(id, ok);
      } catch (e) {
        setNotice((e as Error).message);
      }
    },
    [currentId],
  );

  const kill = useCallback(async () => {
    const id = currentId();
    if (!id) return;
    try {
      await api.kill(id);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, [currentId]);

  const archive = useCallback(async () => {
    const id = currentId();
    if (!id) return;
    try {
      await api.archive(id);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, [currentId]);

  const deleteRecord = useCallback(async () => {
    const id = currentId();
    if (!id) return;
    try {
      await api.deleteRecord(id);
      setSelectedId(null);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, [currentId]);

  const subscribeOutput = useCallback((cb: (lines: TranscriptLine[]) => void) => {
    outputCbs.current.add(cb);
    return () => outputCbs.current.delete(cb);
  }, []);

  const requestScreen = useCallback(async (id: string) => {
    const res = await api.screen(id);
    return res.lines;
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      authLoading,
      authed,
      username,
      hostname,
      wsConnected,
      sessions,
      approvals,
      selectedId,
      transcripts,
      chat,
      notice,
      setNotice,
      login,
      logout,
      selectSession,
      refreshSessions,
      createSession,
      patchSession,
      sendText,
      sendKeys,
      command,
      approve,
      kill,
      archive,
      deleteRecord,
      subscribeOutput,
      requestScreen,
    }),
    [
      authLoading,
      authed,
      username,
      hostname,
      wsConnected,
      sessions,
      approvals,
      selectedId,
      transcripts,
      chat,
      notice,
      login,
      logout,
      selectSession,
      refreshSessions,
      createSession,
      patchSession,
      sendText,
      sendKeys,
      command,
      approve,
      kill,
      archive,
      deleteRecord,
      subscribeOutput,
      requestScreen,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
