import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from './config.js';

const TOKEN_VERSION = 'v1';
export const COOKIE_NAME = 'cr_session';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionToken {
  username: string;
  exp: number;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createToken(config: AppConfig, username: string): string {
  const payload: SessionToken = { username, exp: Date.now() + TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${TOKEN_VERSION}.${encoded}.${sign(config.authSecret, encoded)}`;
}

export function verifyToken(config: AppConfig, token: string | undefined): SessionToken | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, encoded, sig] = parts;
  const expected = sign(config.authSecret, encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionToken;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyCredentials(config: AppConfig, username: string, password: string): boolean {
  const ua = Buffer.from(String(username));
  const ub = Buffer.from(config.authUsername);
  const pa = Buffer.from(String(password));
  const pb = Buffer.from(config.authPassword);
  return ua.length === ub.length && pa.length === pb.length && timingSafeEqual(ua, ub) && timingSafeEqual(pa, pb);
}

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function tokenFromRequest(
  headers: { cookie?: string },
  query?: { token?: string },
): string | undefined {
  const fromCookie = parseCookies(headers.cookie)[COOKIE_NAME];
  if (fromCookie) return fromCookie;
  return query?.token;
}

export function sessionCookieValue(token: string, secure = false): string {
  const parts = [`${COOKIE_NAME}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${30 * 24 * 60 * 60}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
