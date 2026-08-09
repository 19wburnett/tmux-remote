import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  logDir: string;
  authUsername: string;
  authPassword: string;
  authSecret: string;
  tmuxSocket?: string;
  tmuxSocketPath?: string;
  pollMs: number;
  approveResponse: string;
  rejectResponse: string;
  discoverGit: boolean;
  ringBufferSize: number;
  dev: boolean;
}

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function loadOrCreateSecret(file: string): string {
  if (existsSync(file)) {
    const s = readFileSync(file, 'utf8').trim();
    if (s) return s;
  }
  const secret = randomBytes(32).toString('hex');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function validate(config: AppConfig): void {
  if (config.authPassword === 'changeme') {
    console.warn(
      '\n  [claude-remote] WARNING: using the default AUTH_PASSWORD "changeme".\n' +
        '  Set AUTH_PASSWORD in your environment before exposing this app anywhere.\n',
    );
  }
  if (config.authPassword.length === 0) {
    console.error('[claude-remote] AUTH_PASSWORD must not be empty.');
    process.exit(1);
  }
}

export function loadConfig(): AppConfig {
  const home = homedir();
  const dataDir = join(home, '.claude-remote', 'data');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, 'logs'), { recursive: true });

  const config: AppConfig = {
    host: env('HOST', '0.0.0.0'),
    port: intEnv('PORT', 8787),
    dataDir: env('DATA_DIR', dataDir),
    logDir: env('LOG_DIR', join(dataDir, 'logs')),
    authUsername: env('AUTH_USERNAME', 'admin'),
    authPassword: env('AUTH_PASSWORD', 'changeme'),
    authSecret: env('AUTH_SECRET', loadOrCreateSecret(join(dataDir, 'secret'))),
    tmuxSocket: env('TMUX_SOCKET', ''),
    tmuxSocketPath: env('TMUX_SOCKET_PATH', ''),
    pollMs: intEnv('POLL_MS', 1000),
    approveResponse: env('AGENT_APPROVE_RESPONSE', 'y'),
    rejectResponse: env('AGENT_REJECT_RESPONSE', 'n'),
    discoverGit: boolEnv('DISCOVER_GIT', true),
    ringBufferSize: intEnv('RING_BUFFER_SIZE', 3000),
    dev: env('NODE_ENV', 'production') === 'development',
  };

  config.tmuxSocket = config.tmuxSocket === '' ? undefined : config.tmuxSocket;
  config.tmuxSocketPath = config.tmuxSocketPath === '' ? undefined : config.tmuxSocketPath;
  validate(config);
  return config;
}
