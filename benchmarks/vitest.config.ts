// Benchmarks against reference tools on public data: npm run bench (after bash benchmarks/fetch.sh for single-cell).
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: { environment: 'node', root: fileURLToPath(new URL('..', import.meta.url)), include: ['benchmarks/**/*.bench.test.ts'], testTimeout: 600_000, fileParallelism: false },
});
