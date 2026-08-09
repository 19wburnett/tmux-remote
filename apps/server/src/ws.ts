import type { IncomingMessage, Server } from 'node:http';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import type { ApprovalRequest, ClientMessage, SessionInfo, TranscriptLine } from '@claude-remote/shared';
import { tokenFromRequest, verifyToken } from './auth.js';
import type { AppConfig } from './config.js';
import type { SessionBus, SessionManager } from './sessionManager.js';
import { VERSION } from './version.js';

interface WsClient {
  ws: WebSocket;
  subscribedSession?: string;
}

export class WsServer implements SessionBus {
  private wss: WebSocketServer;
  private clients = new Set<WsClient>();
  private manager: SessionManager | undefined;

  constructor(httpServer: Server, private config: AppConfig) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
  }

  setManager(manager: SessionManager): void {
    this.manager = manager;
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const cookieHeader = String(req.headers.cookie ?? '');
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const token = tokenFromRequest({ cookie: cookieHeader }, { token: query.get('token') ?? undefined });
    if (!verifyToken(this.config, token)) {
      ws.close(4001, 'unauthorized');
      return;
    }

    const client: WsClient = { ws };
    this.clients.add(client);
    ws.on('message', (data) => this.onMessage(client, String(data)));
    ws.on('close', () => this.clients.delete(client));
    ws.on('error', () => this.clients.delete(client));

    this.send(client, { type: 'ready', serverTime: Date.now(), hostname: this.config.host, version: VERSION });
    if (this.manager) {
      this.send(client, {
        type: 'sessions',
        sessions: this.manager.list(),
        approvals: this.manager.pendingApprovals(),
      });
    }
  }

  private onMessage(client: WsClient, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    const m = this.manager;
    if (!m) return;

    switch (msg.type) {
      case 'ping':
        this.send(client, { type: 'pong' });
        break;
      case 'subscribe':
        client.subscribedSession = msg.sessionId;
        this.send(client, { type: 'transcript', sessionId: msg.sessionId, lines: m.getTranscript(msg.sessionId), reset: true });
        break;
      case 'unsubscribe':
        client.subscribedSession = undefined;
        break;
      case 'send':
        void m.send(msg.sessionId, { text: msg.text, enter: msg.enter }).catch((e) => this.errorTo(client, e));
        break;
      case 'keys':
        void m.keys(msg.sessionId, { keys: msg.keys }).catch((e) => this.errorTo(client, e));
        break;
      case 'command':
        void m.command(msg.sessionId, { command: msg.command, arg: msg.arg }).catch((e) => this.errorTo(client, e));
        break;
      case 'approve':
        void m.approve(msg.sessionId, msg.approve).catch((e) => this.errorTo(client, e));
        break;
      default:
        break;
    }
  }

  private errorTo(client: WsClient, err: unknown): void {
    this.send(client, { type: 'error', message: (err as Error).message });
  }

  private send(client: WsClient, msg: object): void {
    if (client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(msg));
    }
  }

  sessions(sessions: SessionInfo[], approvals: ApprovalRequest[]): void {
    this.broadcast({ type: 'sessions', sessions, approvals });
  }

  sessionUpdated(session: SessionInfo): void {
    this.broadcast({ type: 'session-updated', session });
  }

  output(sessionId: string, lines: TranscriptLine[]): void {
    for (const c of this.clients) {
      if (c.subscribedSession === sessionId) {
        this.send(c, { type: 'output', sessionId, lines });
      }
    }
  }

  transcript(sessionId: string, lines: TranscriptLine[]): void {
    for (const c of this.clients) {
      if (c.subscribedSession === sessionId) {
        this.send(c, { type: 'transcript', sessionId, lines, reset: true });
      }
    }
  }

  approval(sessionId: string, pending: boolean, request?: ApprovalRequest): void {
    this.broadcast({ type: 'approval', sessionId, pending, request });
  }

  error(message: string): void {
    this.broadcast({ type: 'error', message });
  }

  private broadcast(msg: object): void {
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.ws.readyState === 1) c.ws.send(data);
    }
  }
}
