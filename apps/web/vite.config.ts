import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxyPort = process.env.CR_PROXY_PORT || '8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': `http://localhost:${proxyPort}`,
      '/ws': { target: `ws://localhost:${proxyPort}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});
