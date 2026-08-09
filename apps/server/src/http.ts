import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CommandInput, KeysInput, SendInput, SessionCreateInput, SessionPatchInput } from '@claude-remote/shared';
import { COOKIE_NAME, createToken, sessionCookieValue, tokenFromRequest, verifyCredentials, verifyToken } from './auth.js';
import type { AppConfig } from './config.js';
import type { SessionManager } from './sessionManager.js';
import { VERSION } from './version.js';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

function ah(fn: AsyncHandler): AsyncHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function authMiddleware(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = tokenFromRequest(
      { cookie: req.headers.cookie },
      { token: (req.query.token as string) ?? undefined },
    );
    const session = verifyToken(config, token);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user?: string }).user = session.username;
    next();
  };
}

export function createHttpApp(config: AppConfig, manager: SessionManager): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!verifyCredentials(config, username ?? '', password ?? '')) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }
    const token = createToken(config, String(username));
    const secure = req.header('x-forwarded-proto') === 'https';
    res.setHeader('Set-Cookie', sessionCookieValue(token, secure));
    res.json({ ok: true, username: String(username) });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, tmux: true, version: VERSION, hostname: config.host, time: Date.now() });
  });

  app.get('/api/auth/me', (req, res) => {
    const token = tokenFromRequest({ cookie: req.headers.cookie }, { token: (req.query.token as string) ?? undefined });
    const session = verifyToken(config, token);
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: session.username, hostname: config.host, version: VERSION });
  });

  app.use('/api', authMiddleware(config));

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
