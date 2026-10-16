import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: { environment: 'node', root: fileURLToPath(new URL('../..', import.meta.url)), include: ['benchmarks/docking/shard.test.ts'], testTimeout: 6 * 3600 * 1000 },
});
