import type { ChatBlock } from '@claude-remote/shared';
import { stripSgr } from './util.js';

/** Horizontal box-drawing run characters (tmux status bars, separators). */
const BAR_RE = /[─━═╌╍┄┅┈┉┊┋]/g;
/** Box-drawing container edges (sidebar panels, corners, rails). */
const BOX_EDGE_RE = /^[╭╮╰╯├┤┌┐└┘│┃▎▏╏┇┋]/;
/** Spinner / progress glyphs (braille dots, bullets, markers, status). */
const GLYPH_RE = /[\u2800-\u28ff\u2733\u25cf\u25aa\u25ab\u26aa\u26ab●○◎◐◑◒◓◔◕◗✦✧✕✓✗✚]/g;
/** Characters tolerated alongside glyphs in a "chrome only" line. */
const GLYPH_ALLOWED_RE = /[\s\d:%・./\-_+|()\[\]]/g;

/** True when a line is terminal/status chrome and not real output. */
export function isChatNoiseLine(line: string): boolean {
  const plain = stripSgr(line).trim();
  if (!plain) return false;

  // A run of 3+ box-drawing chars with a short label -> tmux status bar or separator.
  const bars = plain.match(BAR_RE);
  if (bars && bars.length >= 3) {
    const label = plain.replace(BAR_RE, '').replace(/\s/g, '');
    if (label.length < 30) return true;
  }

  // Box-drawing container edges (sidebar panels) with little content.
  if (BOX_EDGE_RE.test(plain) && plain.length <= 44) return true;

  // tmux status remnant: a hostname token surrounded by bar/dot padding.
  // e.g. "  .------------:  wburnett@19Wburnett"
  if (/[\w.-]+@[\w.-]+/.test(plain)) {
    const rest = plain.replace(/[\w.-]+@[\w.-]+/g, '').replace(/[\s.:·•\-─━═╌╍┄┅┈┉┊┋()]/g, '');
    if (rest.length < 4) return true;
  }

  // A line that is mostly spinner/progress glyphs (and small status chars).
  const glyphs = plain.match(GLYPH_RE) ?? [];
  if (glyphs.length >= 2) {
    const residual = plain.replace(GLYPH_RE, '').replace(GLYPH_ALLOWED_RE, '');
    if (residual.length < 4) return true;
  }

  return false;
}

/**
 * Filter noise out of chat-bound lines while leaving the raw transcript
 * untouched. Collapses runs of blank lines to a single blank.
 */
export function cleanChatLines(lines: string[]): string[] {
  const out: string[] = [];
  let prevBlank = false;
  for (const l of lines) {
    if (isChatNoiseLine(l)) continue;
    const blank = !stripSgr(l).trim();
    if (blank) {
      if (!prevBlank) out.push('');
      prevBlank = true;
      continue;
    }
    prevBlank = false;
    out.push(l);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Chat segmentation — Claude Code mobile style.
 *  Classifies agent output into readable text, collapsed "thinking"
 *  status, and accordion-style tool calls.
 * ------------------------------------------------------------------ */

/** Tool call markers: "Ran 1 shell command", "Running 2 shell commands", "⎿ $ cmd". */
const TOOL_START_RE =
  /^\s*(⎿\s*\$|Running\s+\d+\s+shell\s*command|Ran\s+\d+\s+shell\s*command)|running\s+\d+\s+shell\s*command/i;
/** Status / progress chrome that should collapse into a "thinking" pill. */
const STATUS_RE =
  /(Drizzling|thinking|auto mode|esc to interrupt|·\s*↓|tokens\)|tokens\)|←\s*\d+\s+agent|Checking for|drizzle)/i;
/** Spinner glyph runs (braille, bullets) that are pure chrome. */
const SPINNER_ONLY_RE = /^[\s\u2800-\u28ff✶✻✢*●○◎◌❯⏵»·⋮⋰⋱]+$/;
/** Mangled redraw artifact: unterminated SGR remnants like "5;246m8". */
const MANGLED_RE = /;\d+m|\d+m[^a-z]/;
/** Prose marker used by agent TUIs (● prefixes a narrated step). */
const PROSE_LEAD_RE = /^[●✳✦✻✢*]\s*\S/;

function classifyChatLine(plain: string): 'tool' | 'thinking' | 'drop' | 'text' {
  if (!plain) return 'drop';
  if (TOOL_START_RE.test(plain)) return 'tool';

  // Prose keeps a clean "● Sentence" lead (glyph + space + capital). Any other
  // leading glyph is a spinner redraw frame.
  if (/^[✶✻✢*●○❯⏵┃│▎▏▸⟳⬝⋮⋰⋱]/.test(plain) && !/^[●✳✦✻✢*]\s+[A-Z0-9]/.test(plain)) return 'thinking';
  if (SPINNER_ONLY_RE.test(plain)) return 'thinking';
  if (MANGLED_RE.test(plain) && plain.length < 60) return 'thinking';
  if (STATUS_RE.test(plain) && plain.length < 90) return 'thinking';
  // Spinner fragments like "ling…5", "…n in background)", "✶ling…".
  if (/…/.test(plain) && plain.length < 80) return 'thinking';
  if (plain.length < 12 && !/[A-Za-z]{4,}/.test(plain)) return 'thinking';
  return 'text';
}

function toolTitleFor(lines: string[]): string {
  for (const raw of lines) {
    const p = stripSgr(raw).trim();
    const m = p.match(/⎿\s*\$\s*(.+)/i) ?? p.match(/Running\s+\d+\s+shell\s*command/i) ?? p.match(/Ran\s+\d+\s+shell\s*command/i);
    if (!m) continue;
    const t = m[1] ?? m[0];
    const cmd = t.replace(/&&.*$/s, '').replace(/\s+/g, ' ').trim();
    if (cmd) return cmd.length > 64 ? cmd.slice(0, 63) + '…' : cmd;
    // Only the "Ran N shell command" completion marker — call it a shell command.
    return 'Shell command';
  }
  return 'Shell command';
}

/**
 * Group cleaned agent lines into Claude Code mobile-style blocks:
 * plain prose, collapsed "thinking" status, and tool-call accordions.
 */
export function segmentChatLines(lines: string[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let cur: ChatBlock | null = null;
  let inTool = false;

  const push = (kind: ChatBlock['kind'], line: string) => {
    if (!cur || cur.kind !== kind) {
      cur = { kind, lines: [] } as ChatBlock;
      blocks.push(cur);
    }
    cur.lines.push(line);
  };

  for (const raw of lines) {
    const plain = stripSgr(raw).trim();
    if (!plain) {
      if (inTool) {
        inTool = false;
        cur = null;
      }
      continue;
    }

    if (inTool && !PROSE_LEAD_RE.test(plain) && classifyChatLine(plain) !== 'thinking') {
      // Continuation (wrapped command or its output) stays in the tool block.
      push('tool', raw);
      continue;
    }

    switch (classifyChatLine(plain)) {
      case 'tool':
        push('tool', raw);
        inTool = true;
        break;
      case 'thinking':
        push('thinking', raw);
        inTool = false;
        break;
      case 'text':
        push('text', raw);
        inTool = false;
        break;
      case 'drop':
        break;
    }
  }

  for (const b of blocks) {
    if (b.kind === 'tool') b.title = toolTitleFor(b.lines);
    else if (b.kind === 'thinking') {
      // Prefer a status-y line (Drizzling / tokens / auto mode); fall back to a
      // short readable fragment, else the generic label.
      const readable = (t: string) => {
        const c = t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        return !MANGLED_RE.test(c) && !SPINNER_ONLY_RE.test(c) && !/<[a-z/]/.test(c);
      };
      const stripCsi = (t: string) => t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
      const status =
        b.lines.map(stripSgr).find((t) => readable(t) && STATUS_RE.test(t) && t.length < 90) ??
        b.lines.map(stripSgr).find((t) => readable(t) && t.length > 4 && t.length < 70) ??
        undefined;
      b.title = status ? stripCsi(status) : 'Thinking…';
    }
  }

  return blocks;
}
