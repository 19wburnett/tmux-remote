import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CommandInput, KeysInput, SendInput, SessionCreateInput, SessionPatchInput } from '@claude-remote/shared';
import {
  COOKIE_NAME,
  consumeResetToken,
  createResetToken,
  createToken,
  credentialVersion,
  sessionCookieValue,
  setCredentials,
  tokenFromRequest,
  verifyCredentials,
  verifyToken,
} from './auth.js';
import type { AppConfig } from './config.js';
import type { SessionManager } from './sessionManager.js';
import type { Store } from './store.js';
import { VERSION } from './version.js';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

function ah(fn: AsyncHandler): AsyncHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function authMiddleware(config: AppConfig, store: Store) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = tokenFromRequest(
      { cookie: req.headers.cookie },
      { token: (req.query.token as string) ?? undefined },
    );
    const session = verifyToken(config, token, credentialVersion(store));
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user?: string }).user = session.username;
    next();
  };
}

export function createHttpApp(config: AppConfig, manager: SessionManager, store: Store): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!verifyCredentials(config, store, username ?? '', password ?? '')) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }
    const token = createToken(config, String(username), credentialVersion(store));
    const secure = req.header('x-forwarded-proto') === 'https';
    res.setHeader('Set-Cookie', sessionCookieValue(token, secure));
    res.json({ ok: true, username: String(username) });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  });

  // One-time reset token. Never returned over HTTP: written to a file in the
  // data dir and printed to the server log so only the machine operator can
  // read it (out-of-band recovery).
  app.post('/api/auth/forgot', (req, res) => {
    const token = createResetToken(store, config.dataDir);
    console.log(`[claude-remote] password reset token (valid 30 min): ${token}`);
    res.json({ ok: true, hint: 'written to <dataDir>/reset-token and the server log' });
  });

  // Consume the one-time token to set a new username + password.
  app.post(
    '/api/auth/reset',
    ah(async (req, res) => {
      const { token, username, password } = (req.body ?? {}) as {
        token?: string;
        username?: string;
        password?: string;
      };
      if (!username || !password || password.length < 6) {
        res.status(400).json({ error: 'username and a password of at least 6 characters are required' });
        return;
      }
      if (!consumeResetToken(store, String(token ?? ''))) {
        res.status(401).json({ error: 'invalid or expired reset token' });
        return;
      }
      setCredentials(store, username.trim(), password);
      const secure = req.header('x-forwarded-proto') === 'https';
      const t = createToken(config, username.trim(), credentialVersion(store));
      res.setHeader('Set-Cookie', sessionCookieValue(t, secure));
      res.json({ ok: true, username: username.trim() });
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, tmux: true, version: VERSION, hostname: config.host, time: Date.now() });
  });

  app.get('/api/auth/me', (req, res) => {
    const token = tokenFromRequest({ cookie: req.headers.cookie }, { token: (req.query.token as string) ?? undefined });
    const session = verifyToken(config, token, credentialVersion(store));
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: session.username, hostname: config.host, version: VERSION });
  });

  app.use('/api', authMiddleware(config, store));

  // Change password and/or username while authenticated (requires current password).
  app.post(
    '/api/auth/change',
    ah(async (req, res) => {
      const user = (req as Request & { user?: string }).user;
      const { currentPassword, newPassword, newUsername } = (req.body ?? {}) as {
        currentPassword?: string;
        newPassword?: string;
        newUsername?: string;
      };
      if (!currentPassword) {
        res.status(400).json({ error: 'current password is required' });
        return;
      }
      if (!verifyCredentials(config, store, user ?? '', currentPassword)) {
        res.status(401).json({ error: 'current password is incorrect' });
        return;
      }
      if (newPassword && newPassword.length < 6) {
        res.status(400).json({ error: 'new password must be at least 6 characters' });
        return;
      }
      const username = (newUsername && newUsername.trim()) || user || 'admin';
      const password = newPassword && newPassword.length > 0 ? newPassword : currentPassword;
      setCredentials(store, username, password);
      const secure = req.header('x-forwarded-proto') === 'https';
      const t = createToken(config, username, credentialVersion(store));
      res.setHeader('Set-Cookie', sessionCookieValue(t, secure));
      res.json({ ok: true, username });
    }),
  );

  app.get('/api/sessions', (_req, res) => {
    res.json({ sessions: manager.list(), approvals: manager.pendingApprovals() });
  });

  app.post(
    '/api/sessions',
    ah(async (req, res) => {
      const input = (req.body ?? {}) as SessionCreateInput;
      const info = await manager.create(input);
      res.status(201).json({ session: info });
    }),
  );

  app.get('/api/sessions/:id', (req, res) => {
    const info = manager.getInfo(req.params.id);
    if (!info) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ session: info });
  });

  app.patch(
    '/api/sessions/:id',
    ah(async (req, res) => {
      const info = await manager.patch(req.params.id, (req.body ?? {}) as SessionPatchInput);
      res.json({ session: info });
    }),
  );

  app.post(
    '/api/sessions/:id/send',
    ah(async (req, res) => {
      await manager.send(req.params.id, (req.body ?? {}) as SendInput);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/sessions/:id/keys',
    ah(async (req, res) => {
      await manager.keys(req.params.id, (req.body ?? {}) as KeysInput);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/sessions/:id/command',
    ah(async (req, res) => {
      const result = await manager.command(req.params.id, (req.body ?? {}) as CommandInput);
      res.json(result);
    }),
  );

  app.post(
    '/api/sessions/:id/approve',
    ah(async (req, res) => {
      const { approve } = (req.body ?? {}) as { approve: boolean };
      await manager.approve(req.params.id, approve);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/sessions/:id/kill',
    ah(async (req, res) => {
      await manager.kill(req.params.id);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/sessions/:id/archive',
    ah(async (req, res) => {
      const info = await manager.archive(req.params.id);
      res.json({ session: info });
    }),
  );

  app.delete(
    '/api/sessions/:id',
    ah(async (req, res) => {
      await manager.deleteRecord(req.params.id);
      res.json({ ok: true });
    }),
  );

  app.get('/api/sessions/:id/transcript', (req, res) => {
    res.json({ lines: manager.getTranscript(req.params.id) });
  });

  app.get('/api/sessions/:id/screen', (req, res) => {
    res.json({ lines: manager.getScreen(req.params.id) });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Static web app (production build) with SPA fallback.
  const serverRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const webDist = join(serverRoot, '..', 'web', 'dist');
  if (existsSync(join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[claude-remote]', err);
    res.status(500).json({ error: err.message || 'internal error' });
  });

  return app;
}
