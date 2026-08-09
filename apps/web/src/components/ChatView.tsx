import { memo, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@claude-remote/shared';
import { ansiToSegments } from '../ansi';

const COLLAPSE_AT = 14;

const AGENT_GLYPH: Record<string, string> = {
  claude: '✳',
  codex: '⚡',
  opencode: '◉',
  aider: '🐤',
  aichat: '💬',
  goose: '🪿',
  gemini: '✦',
};

function agentGlyph(agentType?: string): string {
  const t = (agentType ?? '').toLowerCase();
  return AGENT_GLYPH[t] ?? '●';
}

function time(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const AgentBubble = memo(function AgentBubble({
  msg,
  agentType,
  collapsed,
  onExpand,
}: {
  msg: ChatMessage;
  agentType?: string;
  collapsed: boolean;
  onExpand: () => void;
}) {
  const lines = msg.lines ?? [];
  const visible = collapsed ? lines.slice(0, COLLAPSE_AT) : lines;
  return (
    <div className="chat-msg agent">
      <div className="agent-avatar" aria-hidden>
        {agentGlyph(agentType)}
      </div>
      <div className="agent-col">
        <div className="agent-meta">
          <span className="agent-name">{agentType || 'agent'}</span>
          <span className="chat-time">{time(msg.ts)}</span>
        </div>
        <div className="chat-bubble agent-bubble">
          {visible.length === 0 && <div className="cb-line empty" />}
          {visible.map((text, i) => {
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
          {collapsed && (
            <button className="cb-more" onClick={onExpand}>
              Show all {lines.length} lines ▾
            </button>
          )}
        </div>
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

export function ChatView({ messages, agentType }: { messages: ChatMessage[]; agentType?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
  };

  const expand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  if (messages.length === 0) {
    return (
      <div className="chat-view">
        <DayDivider />
        <div className="output-empty">
          No conversation yet.
          <br />
          Type a message below to talk to this agent.
        </div>
      </div>
    );
  }

  return (
    <div className="chat-view" ref={ref} onScroll={onScroll}>
      <DayDivider />
      {messages.map((m) =>
        m.role === 'user' ? (
          <UserBubble key={m.id} msg={m} />
        ) : (
          <AgentBubble
            key={m.id}
            msg={m}
            agentType={agentType}
            collapsed={(m.lines?.length ?? 0) > COLLAPSE_AT && !expanded.has(m.id)}
            onExpand={() => expand(m.id)}
          />
        ),
      )}
    </div>
  );
}

function DayDivider() {
  const now = new Date();
  const today = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="chat-divider">
      <span>{today}</span>
    </div>
  );
}
