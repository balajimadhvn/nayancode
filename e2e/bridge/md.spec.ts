import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer } from '../../bridge/nayancode-bridge.mjs';

const siteOrigin = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
let server: { port: number; token: string; close(): Promise<void> };
let root = '';
const hasGmx = spawnSync('which', ['gmx'], { encoding: 'utf8' }).status === 0;

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-md-e2e-'));
  server = await startServer({
    port: 0, host: '127.0.0.1', root, silent: true,
    origins: [siteOrigin], allow: ['gmx', 'nvidia-smi'],
  }) as typeof server;
});

test.afterAll(async () => {
  if (server) await server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function xvgColumns(text: string) {
  const legends: Record<number, string> = {};
  const rows: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^@\s+s(\d+)\s+legend\s+"(.*)"$/.exec(line);
    if (m) { legends[Number(m[1])] = m[2]; continue; }
    if (!line || line.startsWith('#') || line.startsWith('@') || line.startsWith('&')) continue;
    const vals = line.split(/\s+/).map(Number);
    if (vals.length >= 2 && vals.every(Number.isFinite)) rows.push(vals);
  }
  const col = (name: string) => {
    const idx = Object.entries(legends).find(([, v]) => v.toLowerCase().includes(name.toLowerCase()))?.[0];
    return idx === undefined ? -1 : Number(idx) + 1;
  };
  const mean = (name: string) => {
    const c = col(name);
    if (c < 0) throw new Error(`No "${name}" column in the .xvg (legends: ${Object.values(legends).join(', ')})`);
    return rows.reduce((s, r) => s + r[c], 0) / rows.length;
  };
  return { legends, rows, col, mean };
}

async function download(page: Page, name: string): Promise<string> {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: `Download ${name}` }).click(),
  ]);
  const p = await dl.path();
  if (!p) throw new Error(`No path for the ${name} download`);
  return fs.readFileSync(p, 'utf8');
}

test('native GROMACS MD runs through the Bridge and produces the expected results', async ({ page }) => {
  test.slow();
  test.setTimeout(1_200_000);
  test.skip(!hasGmx, 'gmx is not installed on this machine');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ResizeObserver|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });

  await page.goto('/dynamics');
  await page.getByRole('tab', { name: 'Native MD (GROMACS)' }).click();
  await expect(page.getByText('Connect the Bridge below; until then this tab is disabled.')).toBeVisible();

  await page.getByTestId('bridge-url').fill(`http://127.0.0.1:${server.port}`);
  await page.getByTestId('bridge-token').fill(server.token);
  await page.getByTestId('bridge-connect').click();
  await expect(page.getByTestId('md-run')).toBeVisible({ timeout: 20_000 });

  const fixture = path.resolve('src/studios/dynamics/fixtures/1ubq.pdb');
  await page.locator('input[type=file]').setInputFiles(fixture);
  await expect(page.getByText(/1ubq\.pdb/)).toBeVisible();
  await page.getByLabel('Minimisation steps').selectOption('500');
  await page.getByLabel('NVT steps (2 fs)').selectOption('1000');
  await page.getByLabel('NPT steps (2 fs)').selectOption('1000');
  await page.getByLabel('Production steps (2 fs)').selectOption('2000');
  await expect(page.getByTestId('md-plan')).toContainText('trjconv');

  await page.getByTestId('md-run').click();
  await expect(page.getByTestId('md-result')).toBeVisible({ timeout: 1_180_000 });
  await expect(page.getByTestId('md-error')).toHaveCount(0);

  const planRows = await page.locator('[data-testid=md-plan] > div').allInnerTexts();
  console.log('Native MD stage times (from the UI):\n' + planRows.join('\n'));

  const emLog = await download(page, 'em.log');
  const emMatches = [...emLog.matchAll(/Potential Energy\s*=\s*(-?[\d.eE+-]+)/g)];
  expect(emMatches.length).toBeGreaterThan(0);
  const emPotential = Number(emMatches.at(-1)![1]);
  expect(emPotential).toBeLessThan(-1e5);

  const energy = xvgColumns(await download(page, 'energy.xvg'));
  const meanT = energy.mean('Temperature');
  const meanDensity = energy.mean('Density');
  expect(meanT).toBeGreaterThan(292);
  expect(meanT).toBeLessThan(308);
  expect(meanDensity).toBeGreaterThan(940);
  expect(meanDensity).toBeLessThan(1060);

  const rmsd = xvgColumns(await download(page, 'rmsd.xvg'));
  const finalRmsd = rmsd.rows.at(-1)![1];
  expect(finalRmsd).toBeGreaterThanOrEqual(0);
  expect(finalRmsd).toBeLessThan(0.3);

  const traj = await download(page, 'traj.pdb');
  const models = (traj.match(/^MODEL/gm) ?? []).length;
  expect(models).toBeGreaterThanOrEqual(4);
  console.log(`Native MD results: EM ${emPotential} kJ/mol, mean T ${meanT.toFixed(2)} K, mean density ${meanDensity.toFixed(1)} kg/m3, final RMSD ${finalRmsd.toFixed(4)} nm, ${models} MODEL frames`);

  await expect(page.getByTestId('md-em')).toContainText('kJ/mol');
  await expect(page.getByTestId('md-models')).toContainText(String(models));
  await expect(page.getByText(/Rough estimate \((GPU|CPU)/)).toBeVisible();

  await page.getByRole('button', { name: 'Send trajectory to Trajectory Studio' }).click();
  await expect(page).toHaveURL(/\/trajectory/);
  await expect(page.getByText(/Native MD · ubiquitin/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/frames · .* atoms per frame/)).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
