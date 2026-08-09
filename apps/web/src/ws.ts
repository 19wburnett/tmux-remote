import type { ClientMessage, ServerMessage } from '@claude-remote/shared';

export type MessageListener = (msg: ServerMessage) => void;

/**
 * Minimal WebSocket client with reconnect + backoff. Reconnects re-subscribe
 * to the currently selected session so the server re-sends its transcript.
 */
export class RemoteClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<MessageListener>();
  private reconnectDelay = 800;
  private closed = false;
  private subscribedSession: string | undefined;
  private connectedListeners = new Set<() => void>();

  connect(): void {
    if (this.closed) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 800;
      if (this.subscribedSession) {
        this.send({ type: 'subscribe', sessionId: this.subscribedSession });
      }
      this.connectedListeners.forEach((cb) => cb());
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data)) as ServerMessage;
        this.listeners.forEach((l) => l(msg));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!this.closed) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
      }
    };
    ws.onerror = () => ws.close();
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  subscribe(sessionId: string): void {
    this.subscribedSession = sessionId;
    this.send({ type: 'subscribe', sessionId });
  }

  unsubscribe(): void {
    this.subscribedSession = undefined;
    this.send({ type: 'unsubscribe' });
  }

  onMessage(l: MessageListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onConnected(cb: () => void): () => void {
    this.connectedListeners.add(cb);
    return () => this.connectedListeners.delete(cb);
  }

  get currentSubscription(): string | undefined {
    return this.subscribedSession;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
