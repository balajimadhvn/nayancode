import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// BASE_PATH lets the same build run at a sub-path (https://<user>.github.io/nayancode/) or at a domain root.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  server: { port: Number(process.env.PORT) || 5180, watch: { awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 20 } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 20_000 },
});
