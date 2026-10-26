import { defineConfig } from '@playwright/test';
// GPU tests need a real WebGPU adapter in Chromium. On this machine that is the
// NVIDIA GPU through Vulkan; on other machines the same flags use their own
// vendor driver. Tests skip themselves when no adapter exists.
// Run against the production build: npm run build first.
const port = Number(process.env.E2E_PORT ?? 4174);
export default defineConfig({
  testDir: 'e2e/gpu', timeout: 120_000, fullyParallel: false, retries: 0, reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    launchOptions: { args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: `node scripts/serve.mjs ${port}`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 60_000 },
});
