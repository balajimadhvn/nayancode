import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../bridge/nayancode-bridge.mjs';

const siteOrigin = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
let server: { port: number; token: string; close(): Promise<void> };
let root = '';

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-bridge-e2e-'));
  server = await startServer({
    port: 0, host: '127.0.0.1', root, silent: true,
    origins: [siteOrigin], allow: ['echo', 'cat'],
  }) as typeof server;
});

test.afterAll(async () => {
  if (server) await server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('bridge panel connects to a real local server, shows tools, and forgets the token', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ResizeObserver|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });

  await page.goto('/');
  const card = page.locator('.card', { hasText: 'Nayancode Bridge' });
  await expect(card).toBeVisible();
  await card.getByTestId('bridge-url').fill(`http://127.0.0.1:${server.port}`);
  await card.getByTestId('bridge-token').fill('not-the-token');
  await card.getByTestId('bridge-connect').click();
  await expect(card.getByTestId('bridge-error')).toContainText(/token/i, { timeout: 15_000 });

  await card.getByTestId('bridge-token').fill(server.token);
  await card.getByTestId('bridge-connect').click();
  await expect(card.getByTestId('bridge-connected')).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTestId('bridge-tools')).toContainText('echo');
  await expect(card.getByTestId('bridge-tools')).toContainText('cat');
  await expect(card.getByTestId('bridge-health')).toContainText('threads');
  expect(await page.evaluate(() => sessionStorage.getItem('nc-bridge-token'))).toBe(server.token);

  await card.getByRole('button', { name: 'Disconnect' }).click();
  await expect(card.getByTestId('bridge-token')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('nc-bridge-token'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('nc-bridge-url'))).toBe(`http://127.0.0.1:${server.port}`);
  expect(errors).toEqual([]);
});
