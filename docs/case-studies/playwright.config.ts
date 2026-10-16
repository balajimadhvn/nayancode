// Figures for the case studies, captured from the production build (npm run build first):
//   npx playwright test -c docs/case-studies/playwright.config.ts
import { defineConfig } from '@playwright/test';
const port = Number(process.env.E2E_PORT ?? 4194);
export default defineConfig({
  testDir: '.', testMatch: /\.figures\.spec\.ts$/, timeout: 1_800_000, fullyParallel: false, retries: 0, reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, headless: true, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, launchOptions: { args: ['--no-sandbox'] } },
  webServer: { command: `node scripts/serve.mjs ${port}`, cwd: '../..', url: `http://localhost:${port}`, reuseExistingServer: false, timeout: 60_000 },
});
