import type { CSSProperties } from 'react';

export interface Segment {
  text: string;
  style: CSSProperties;
}

const BASIC: Record<number, string> = {
  0: '#000000',
  1: '#cd3131',
  2: '#0dbc79',
  3: '#e5e510',
  4: '#2472c8',
  5: '#bc3fbc',
  6: '#11a8cd',
  7: '#e5e5e5',
  8: '#666666',
  9: '#f14c4c',
  10: '#23d18b',
  11: '#f5f543',
  12: '#3b8eea',
  13: '#d670d6',
  14: '#29b8db',
  15: '#ffffff',
};

const CHAN = [0, 95, 135, 175, 215, 255];

function xterm256(n: number): [number, number, number] {
  if (n < 16) {
    const hex = BASIC[n];
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  if (n < 232) {
    const v = n - 16;
    const r = Math.floor(v / 36);
    const g = Math.floor((v % 36) / 6);
    const b = v % 6;
    return [CHAN[r], CHAN[g], CHAN[b]];
  }
  const g = 8 + (n - 232) * 10;
  return [g, g, g];
}

interface SgrState {
  fg?: string;
  bg?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

const ESC = '\x1b';

/**
 * Parse a single ANSI-SGR string into styled text segments. Non-SGR escapes
 * should already have been stripped by the server.
 */
export function ansiToSegments(input: string): Segment[] {
  const out: Segment[] = [];
  const st: SgrState = { fg: undefined, bg: undefined, bold: false, italic: false, underline: false, inverse: false, strikethrough: false };

  let text = '';
  const flush = () => {
    if (!text) return;
    const style: CSSProperties = {};
    if (st.fg || st.bg) {
      const fg = st.fg;
      const bg = st.bg;
      if (st.inverse) {
        if (bg) style.color = bg;
        if (fg) style.backgroundColor = fg;
      } else {
        if (fg) style.color = fg;
        if (bg) style.backgroundColor = bg;
      }
    } else if (st.inverse) {
      style.color = '#0b0d10';
      style.backgroundColor = '#e5e5e5';
    }
    if (st.bold) style.fontWeight = 700;
    if (st.italic) style.fontStyle = 'italic';
    if (st.underline) style.textDecoration = 'underline';
    if (st.strikethrough) style.textDecoration = 'line-through';
    out.push({ text, style });
    text = '';
  };

  let i = 0;
  const s = input;
  while (i < s.length) {
    if (s[i] === ESC) {
      const rest = s.slice(i);
      const m = /^\x1b\[([0-9;]*)m/.exec(rest);
      if (m) {
        flush();
        const params = m[1] ? m[1].split(';').map((p) => (p === '' ? 0 : Number(p))) : [0];
        applySgr(st, params);
        i += m[0].length;
        continue;
      }
      // Unknown escape — skip a single byte to stay safe.
      flush();
      i += 1;
      continue;
    }
    text += s[i];
    i += 1;
  }
  flush();
  if (out.length === 0) out.push({ text: '', style: {} });
  return out;
}

function applySgr(st: SgrState, params: number[]): void {
  if (params.length === 0) params = [0];
  let i = 0;
  while (i < params.length) {
    const p = params[i];
    switch (p) {
      case 0:
        st.fg = undefined;
        st.bg = undefined;
        st.bold = st.italic = st.underline = st.inverse = st.strikethrough = false;
        break;
      case 1:
        st.bold = true;
        break;
      case 3:
        st.italic = true;
        break;
      case 4:
        st.underline = true;
        break;
      case 7:
        st.inverse = true;
        break;
      case 9:
        st.strikethrough = true;
        break;
      case 22:
        st.bold = false;
        break;
      case 23:
        st.italic = false;
        break;
      case 24:
        st.underline = false;
        break;
      case 27:
        st.inverse = false;
        break;
      case 39:
        st.fg = undefined;
        break;
      case 49:
        st.bg = undefined;
        break;
      case 38:
      case 48: {
        const isFg = p === 38;
        const mode = params[i + 1];
        if (mode === 5) {
          const n = params[i + 2];
          if (n !== undefined) {
            const [r, g, b] = xterm256(n);
            const c = `rgb(${r},${g},${b})`;
            if (isFg) st.fg = c;
            else st.bg = c;
          }
          i += 2;
        } else if (mode === 2) {
          const r = params[i + 2];
          const g = params[i + 3];
          const b = params[i + 4];
          if (r !== undefined && g !== undefined && b !== undefined) {
            const c = `rgb(${r},${g},${b})`;
            if (isFg) st.fg = c;
            else st.bg = c;
          }
          i += 4;
        }
        break;
      }
      case 90:
      case 91:
      case 92:
      case 93:
      case 94:
      case 95:
      case 96:
      case 97:
        st.fg = BASIC[p - 90 + 8];
        break;
      case 100:
      case 101:
      case 102:
      case 103:
      case 104:
      case 105:
      case 106:
      case 107:
        st.bg = BASIC[p - 100 + 8];
        break;
      default:
        if (p >= 30 && p <= 37) st.fg = BASIC[p - 30];
        else if (p >= 40 && p <= 47) st.bg = BASIC[p - 40];
        break;
    }
    i += 1;
  }
}
