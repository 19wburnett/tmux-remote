import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from './config.js';
import type { Store } from './store.js';
import { sha256hex } from './util.js';

const TOKEN_VERSION = 'v1';
export const COOKIE_NAME = 'cr_session';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

export interface SessionToken {
  username: string;
  exp: number;
  /** Credential version embedded in the token; bumped whenever creds change. */
  v: number;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createToken(config: AppConfig, username: string, version: number): string {
  const payload: SessionToken = { username, exp: Date.now() + TOKEN_TTL_MS, v: version };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${TOKEN_VERSION}.${encoded}.${sign(config.authSecret, encoded)}`;
}

export function verifyToken(
  config: AppConfig,
  token: string | undefined,
  expectedVersion: number,
): SessionToken | null {
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
    if (typeof payload.v !== 'number' || payload.v !== expectedVersion) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Credential storage (SQLite kv) with env-var fallback
// ---------------------------------------------------------------------------

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Current credential version; bumped on every change to invalidate old tokens. */
export function credentialVersion(store: Store): number {
  return Number(store.getKv('auth.version') ?? '0');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Store username + scrypt-hashed password and bump the credential version. */
export function setCredentials(store: Store, username: string, password: string): void {
  store.setKv('auth.username', username);
  store.setKv('auth.password', hashPassword(password));
  store.setKv('auth.version', String(credentialVersion(store) + 1));
}

/** Verify a login; stored creds win, env vars are the fallback for fresh installs. */
export function verifyCredentials(config: AppConfig, store: Store, username: string, password: string): boolean {
  const storedUser = store.getKv('auth.username');
  const storedHash = store.getKv('auth.password');
  if (storedUser !== undefined && storedHash !== undefined) {
    return safeEq(username, storedUser) && verifyPassword(password, storedHash);
  }
  return (
    safeEq(username, config.authUsername) &&
    safeEq(password, config.authPassword)
  );
}

// ---------------------------------------------------------------------------
// One-time password reset token (out-of-band delivery: file + server log)
// ---------------------------------------------------------------------------

export function createResetToken(store: Store, dataDir: string): string {
  const token = randomBytes(24).toString('hex');
  store.setKv('auth.resetTokenHash', sha256hex(token));
  store.setKv('auth.resetExpires', String(Date.now() + RESET_TTL_MS));
  const file = join(dataDir, 'reset-token');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

export function consumeResetToken(store: Store, token: string): boolean {
  const hash = store.getKv('auth.resetTokenHash');
  const expires = Number(store.getKv('auth.resetExpires') ?? 0);
  if (!hash || !token || Date.now() > expires) return false;
  if (!safeEq(sha256hex(token), hash)) return false;
  store.setKv('auth.resetTokenHash', '');
  store.setKv('auth.resetExpires', '0');
  return true;
}

// ---------------------------------------------------------------------------
// Cookies / request helpers
// ---------------------------------------------------------------------------

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
