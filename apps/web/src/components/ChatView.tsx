import { memo, useEffect, useRef, useState } from 'react';
import type { ChatBlock, ChatMessage } from '@claude-remote/shared';
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

/** Strip the agent's leading prose glyph (● / ✳ / etc.) so text reads cleanly. */
const LEAD_GLYPH_RE = /^[●✳✦✻✢*❯»•·]\s*/;

function AnsiText({ text }: { text: string }) {
  const segs = ansiToSegments(text);
  return (
    <>
      {segs.map((s, j) => (
        <span key={j} style={s.style}>
          {s.text}
        </span>
      ))}
    </>
  );
}

function TextBlock({ block }: { block: Extract<ChatBlock, { kind: 'text' }> }) {
  return (
    <div className="cc-text">
      {block.lines.map((raw, i) => {
        const plain = raw.replace(LEAD_GLYPH_RE, '');
        if (!plain.trim()) return null;
        return (
          <div key={i} className="cc-text-line">
            <AnsiText text={plain} />
          </div>
        );
      })}
    </div>
  );
}

const ThinkingBlock = memo(function ThinkingBlock({
  block,
}: {
  block: Extract<ChatBlock, { kind: 'thinking' }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`cc-thinking${open ? ' open' : ''}`}>
      <button className="cc-thinking-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="cc-thinking-glyph" aria-hidden>
          ⟳
        </span>
        <span className="cc-thinking-title">{block.title || 'Thinking…'}</span>
        <span className="cc-chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="cc-thinking-body">
          {block.lines.map((raw, i) => {
            if (!raw.trim()) return null;
            return (
              <div key={i} className="cc-line">
                <AnsiText text={raw} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const ToolBlock = memo(function ToolBlock({
  block,
}: {
  block: Extract<ChatBlock, { kind: 'tool' }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`cc-tool${open ? ' open' : ''}`}>
      <button className="cc-tool-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="cc-tool-glyph" aria-hidden>
          ⌘
        </span>
        <span className="cc-tool-title">{block.title || 'Shell'}</span>
        <span className="cc-chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="cc-tool-body">
          {block.lines.map((raw, i) => {
            if (!raw.trim()) return null;
            return (
              <div key={i} className="cc-line">
                <AnsiText text={raw} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

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
  const blocks = msg.blocks;
  // When collapsed: show every thinking/tool block but cap prose to the first 2 text blocks.
  let visibleBlocks: ChatBlock[] | undefined;
  if (blocks) {
    visibleBlocks = collapsed
      ? [...blocks.filter((b) => b.kind !== 'text'), ...blocks.filter((b) => b.kind === 'text').slice(0, 2)]
      : blocks;
  }
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
          {blocks ? (
            <>
              {visibleBlocks!.map((b, i) => {                if (b.kind === 'text') return <TextBlock key={i} block={b} />;
                if (b.kind === 'thinking') return <ThinkingBlock key={i} block={b} />;
                return <ToolBlock key={i} block={b} />;
              })}
              {collapsed && lines.length > COLLAPSE_AT && (
                <button className="cb-more" onClick={onExpand}>
                  Show all {lines.length} lines ▾
                </button>
              )}
            </>
          ) : (
            <>
              {lines.slice(0, collapsed ? COLLAPSE_AT : undefined).map((text, i) => {
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
              {collapsed && lines.length > COLLAPSE_AT && (
                <button className="cb-more" onClick={onExpand}>
                  Show all {lines.length} lines ▾
                </button>
              )}
            </>
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
