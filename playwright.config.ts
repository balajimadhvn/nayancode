import { defineConfig } from '@playwright/test';
// E2E runs against the production build (dist/) served by scripts/serve.mjs, i.e. exactly what gets deployed.
// E2E_PORT + GH_PAGES=1 runs the suite without _headers, i.e. exactly as GitHub Pages serves the site.
const port = Number(process.env.E2E_PORT ?? 4173);
export default defineConfig({
  testDir: 'e2e', timeout: 90_000, fullyParallel: false, retries: 0, reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, headless: true, launchOptions: { args: ['--no-sandbox'] } },
  webServer: { command: `node scripts/serve.mjs ${port}`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 60_000 },
});
