import { memo, useEffect, useRef } from 'react';
import type { TranscriptLine } from '@claude-remote/shared';
import { ansiToSegments } from '../ansi';

const Line = memo(function Line({ text }: { text: string }) {
  if (!text) return <div className="output-line empty" />;
  const segs = ansiToSegments(text);
  return (
    <div className="output-line">
      {segs.map((s, i) => (
        <span key={i} style={s.style}>
          {s.text}
        </span>
      ))}
    </div>
  );
});

export function OutputView({ lines }: { lines: TranscriptLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
  };

  return (
    <div className="output" ref={ref} onScroll={onScroll}>
      {lines.length === 0 ? (
        <div className="output-empty">
          No output yet.
          <br />
          Type in the composer below to talk to this agent.
        </div>
      ) : (
        lines.map((l) => <Line key={l.seq} text={l.text} />)
      )}
    </div>
  );
}
