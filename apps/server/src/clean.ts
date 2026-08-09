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
