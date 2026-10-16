// Case studies on public data: npm run case-studies (after bash benchmarks/fetch.sh). Numbers → docs/case-studies/results.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: { environment: 'node', root: fileURLToPath(new URL('../..', import.meta.url)), include: ['docs/case-studies/**/*.case.test.ts'], testTimeout: 1_800_000, fileParallelism: false },
});
