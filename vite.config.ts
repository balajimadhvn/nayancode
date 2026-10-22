import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';


/** onnxruntime-web ships several WebAssembly variants and Vite emits the largest one (about 25.6 MiB), which exceeds
 *  Cloudflare's 25 MiB per-file limit. The Workbench self-hosts the one runtime it needs (public/wasm/ort) and points the
 *  runtime at it, so the bundled variants are never requested: drop them from the output. */
function dropUnusedOrtWasm() {
  return {
    name: 'drop-unused-ort-wasm',
    generateBundle(_: unknown, bundle: Record<string, { type: string; fileName: string }>) {
      for (const [k, f] of Object.entries(bundle)) if (f.type === 'asset' && /ort-wasm-simd-threaded[^/]*\.wasm$/.test(f.fileName)) delete bundle[k];
    },
  };
}

// BASE_PATH lets the same build run at a sub-path (https://<user>.github.io/nayancode/) or at a domain root.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react(), dropUnusedOrtWasm()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  server: { port: Number(process.env.PORT) || 5180, watch: { awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 20 } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 20_000 },
});
