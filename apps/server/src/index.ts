import http from 'node:http';
import os from 'node:os';
import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { TmuxAdapter } from './tmux.js';
import { SessionManager } from './sessionManager.js';
import { createHttpApp } from './http.js';
import { WsServer } from './ws.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await createStore(config.dataDir);
  const tmux = new TmuxAdapter(config);

  const httpServer = http.createServer();
  const bus = new WsServer(httpServer, config, store);
  const manager = new SessionManager(tmux, store, config, bus);
  bus.setManager(manager);

  const app = createHttpApp(config, manager, store);
  httpServer.on('request', app);

  await manager.start();

  httpServer.listen(config.port, config.host, () => {
    const hostname = os.hostname();
    console.log('');
    console.log('  claude-remote v0.1.0');
    console.log('  --------------------');
    console.log(`  tmux    : ${config.tmuxSocket ? `socket ${config.tmuxSocket}` : 'default server'}`);
    console.log(`  data    : ${config.dataDir}`);
    console.log(`  web     : http://localhost:${config.port}`);
    console.log(`  machine : ${hostname}`);
    console.log('');
  });
}

main().catch((err) => {
  console.error('[claude-remote] fatal:', err);
  process.exit(1);
});
