import { memo, useEffect, useRef } from 'react';
import type { ChatMessage } from '@claude-remote/shared';
import { ansiToSegments } from '../ansi';

const AgentBubble = memo(function AgentBubble({ msg }: { msg: ChatMessage }) {
  const lines = msg.lines ?? [];
  return (
    <div className="chat-msg agent">
      <div className="chat-bubble agent-bubble">
        {lines.length === 0 && <div className="cb-line empty" />}
        {lines.map((text, i) => {
          if (!text) return <div key={i} className="cb-line empty" />;
          const segs = ansiToSegments(text);
          return (
            <div key={i} className="cb-line">
              {segs.map((s, j) => (
                <span key={j} style={s.style}>
                  {s.text}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
});

const UserBubble = memo(function UserBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="chat-msg user">
      <div className="chat-bubble user-bubble">{msg.text}</div>
      <span className="chat-time">{time(msg.ts)}</span>
    </div>
  );
});

function time(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function ChatView({ messages }: { messages: ChatMessage[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
  };

  if (messages.length === 0) {
    return (
      <div className="output chat-view">
        <div className="output-empty">
          No conversation yet.
          <br />
          Type a message below to talk to this agent.
        </div>
      </div>
    );
  }

  return (
    <div className="output chat-view" ref={ref} onScroll={onScroll}>
      {messages.map((m) =>
        m.role === 'user' ? (
          <UserBubble key={m.id} msg={m} />
        ) : (
          <AgentBubble key={m.id} msg={m} />
        ),
      )}
    </div>
  );
}
