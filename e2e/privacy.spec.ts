import { expect, test, type Page, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Hosts the Workbench may contact, and why. Keep this file in step with src: every entry needs a reason. */
const allow = JSON.parse(readFileSync(fileURLToPath(new URL('./privacy-allow.json', import.meta.url)), 'utf8')) as {
  get: string[]; post: string[]; reasons: Record<string, string>;
};
const GET_HOSTS = new Set(allow.get);
const POST_HOSTS = new Set(allow.post);

/** Distinctive sequence typed into real input fields; it must never appear in a URL or request body. */
const MARKER = 'ACGTACGTTTGACCAGTAGGCATTA';

/** Studios whose main flow fetches public records, so they are not in the offline set. */
export const needsNetworkByDesign = ['structure', 'docking'];

interface Scenario {
  name: string;
  route: string;
  /** The same demo the visitor (and studios.spec.ts) uses. */
  demo: (page: Page) => Promise<void>;
  /** The first analysis, clicked when it is ready; network is recorded either way. */
  analysis?: (page: Page) => Promise<void>;
  /** A real input field for the marker, plus an analysis run on that input. */
  marker?: { fill: (page: Page) => Promise<void>; run: (page: Page) => Promise<void> };
  demoTimeout?: number;
  settleMs?: number;
}

const tab = (page: Page, name: string | RegExp) => page.getByRole('tab', { name }).click({ timeout: 30_000 });
const btn = (page: Page, name: string | RegExp, timeout = 30_000) => page.getByRole('button', { name }).first().click({ timeout });
async function tryBtn(page: Page, name: string | RegExp) {
  try { await page.getByRole('button', { name }).first().click({ timeout: 2_500 }); } catch { /* the analysis is not ready yet; the demo's requests are what this test audits */ }
}
async function tryTab(page: Page, name: string | RegExp) {
  try { await page.getByRole('tab', { name }).first().click({ timeout: 2_500 }); } catch { /* tab chunks are fetched with the studio; not needed for the request log */ }
}

const scenarios: Scenario[] = [
  {
    name: 'lab', route: '/lab',
    demo: async (p) => { await btn(p, 'Livak 2001 example'); },
    analysis: async (p) => { await tryBtn(p, 'Calculate'); },
  },
  {
    name: 'sequence', route: '/sequence',
    demo: async (p) => { await btn(p, 'Demo DNA', 15_000); },
    analysis: async (p) => { await tab(p, 'Proteomics'); await tryBtn(p, 'Digest'); },
    marker: {
      fill: async (p) => { await p.locator('textarea[placeholder*="my_sequence"]').first().fill(MARKER); },
      run: async (p) => { await tab(p, 'Proteomics'); await btn(p, 'Digest'); },
    },
  },
  {
    name: 'phylogenetics', route: '/phylogenetics',
    demo: async (p) => { await btn(p, /Demo: 12-protein family/); },
    analysis: async (p) => { await tryBtn(p, 'Run progressive alignment'); },
  },
  {
    name: 'genome', route: '/genome',
    demo: async (p) => { await tab(p, 'Mapping & variants'); await btn(p, /Demo: simulated/); },
    analysis: async (p) => { await tryBtn(p, 'Map & call'); },
  },
  {
    name: 'variants', route: '/variants',
    demo: async (p) => { await tab(p, 'Association'); await btn(p, /Demo: case\/control/); },
    analysis: async (p) => { await tryBtn(p, 'Run association'); },
  },
  {
    name: 'expression', route: '/expression',
    demo: async (p) => { await btn(p, /Load real-gene demo/); },
    analysis: async (p) => { await tryBtn(p, 'Run analysis'); },
  },
  {
    name: 'single-cell', route: '/single-cell',
    demo: async (p) => { await btn(p, /Run synthetic PBMC-like demo/); },
  },
  {
    name: 'microbiome', route: '/microbiome',
    demo: async (p) => { await btn(p, /Load synthetic demo/); },
    analysis: async (p) => { await tryBtn(p, 'Run analysis'); },
  },
  {
    name: 'chemistry', route: '/chemistry',
    demo: async (p) => { await btn(p, /Load example/, 90_000); },
    analysis: async (p) => { await tryTab(p, 'Molecule tools'); await tryBtn(p, 'Analyse'); },
  },
  {
    name: 'structure', route: '/structure',
    demo: async (p) => { await btn(p, 'Load structure', 90_000); },
    settleMs: 6_000,
  },
  {
    name: 'docking', route: '/docking',
    demo: async (p) => { await btn(p, /Demo: HIV protease/); },
    analysis: async (p) => { await tryBtn(p, 'Dock'); },
  },
  {
    name: 'statistics', route: '/statistics',
    demo: async (p) => { await tab(p, 'Meta-analysis'); await btn(p, /Load demo \(BCG/); },
  },
  {
    name: 'plasmid', route: '/plasmid',
    demo: async (p) => { await btn(p, /Load pUC19 demo/); },
  },
  {
    name: 'biologics', route: '/biologics',
    demo: async (p) => { await btn(p, 'Load trastuzumab'); },
  },
  {
    name: 'pharmacokinetics', route: '/pharmacokinetics',
    demo: async (p) => { await btn(p, 'Load IV demo'); },
    analysis: async (p) => { await tryBtn(p, 'Analyse'); },
  },
  {
    name: 'trajectory', route: '/trajectory',
    demo: async (p) => { await btn(p, 'Load demo trajectory'); },
  },
  {
    name: 'peptides', route: '/peptides',
    demo: async (p) => { await btn(p, /Load demo/); },
  },
  {
    name: 'population-genetics', route: '/population-genetics',
    demo: async (p) => { await btn(p, 'Load demo table'); },
    analysis: async (p) => { await tryBtn(p, 'Summarise'); },
  },
  {
    name: 'omics-quant', route: '/omics-quant',
    demo: async (p) => { await btn(p, /Load demo \(600 features/); },
    analysis: async (p) => { await tryTab(p, 'Differential abundance'); await tryBtn(p, 'Run differential test'); },
  },
  {
    name: 'amr', route: '/amr',
    demo: async (p) => { await btn(p, 'Demo: synthetic contig with 5 resistance genes'); },
  },
  {
    name: 'crispr', route: '/crispr',
    demo: async (p) => { await btn(p, /Demo: 600-bp/); },
    marker: {
      fill: async (p) => { await p.getByRole('textbox', { name: 'DNA sequence' }).fill(MARKER); },
      run: async (p) => { await btn(p, 'Find guides'); },
    },
  },
  {
    name: 'primers', route: '/primers',
    demo: async (p) => { await btn(p, /Demo: 2-kb template/); },
    marker: {
      fill: async (p) => { await p.getByRole('textbox', { name: 'Template sequence' }).fill(MARKER); },
      run: async (p) => { await btn(p, 'Design pairs'); },
    },
  },
  {
    name: 'enrichment', route: '/enrichment',
    demo: async (p) => { await btn(p, 'Load demo sets'); },
    analysis: async (p) => { await tab(p, 'Over-representation'); await tryBtn(p, 'Run ORA'); },
    marker: {
      fill: async (p) => {
        await tab(p, 'Over-representation');
        await p.getByRole('textbox', { name: 'Gene list' }).fill(MARKER);
      },
      run: async (p) => { await btn(p, 'Run ORA'); },
    },
  },
  {
    name: 'protocols', route: '/protocols',
    demo: async (p) => { await btn(p, 'PCR (Taq) template'); },
  },
  {
    name: 'sanger', route: '/sanger',
    demo: async (p) => { await btn(p, /Load demo \(400-base synthetic trace\)/); },
    marker: {
      fill: async (p) => {
        await tab(p, 'Compare');
        await p.getByPlaceholder(/>reference/).fill(MARKER);
      },
      run: async (p) => { await btn(p, 'Compare', 15_000); },
    },
  },
  {
    name: 'image-counter', route: '/image-counter',
    demo: async (p) => { await btn(p, /Load demo \(42 colonies\)/); },
    settleMs: 1_500,
  },
  {
    name: 'flow', route: '/flow',
    demo: async (p) => { await btn(p, /Load demo \(30,000 events\)/); },
  },
  {
    name: 'dynamics', route: '/dynamics',
    demo: async (p) => { await btn(p, 'Run', 15_000); },
  },
  {
    name: 'similarity-search', route: '/similarity-search',
    demo: async (p) => { await btn(p, 'Load demo database'); },
    analysis: async (p) => { await tryBtn(p, 'Run search'); },
  },
  {
    name: 'reads', route: '/reads',
    demo: async (p) => { await btn(p, /Load SYNTHETIC demo/); },
    analysis: async (p) => { await tab(p, 'Trim & filter'); await tryBtn(p, 'Run'); },
  },
  {
    name: 'amplicon', route: '/amplicon',
    demo: async (p) => { await btn(p, /Load demo \(3 synthetic samples/); },
    analysis: async (p) => { await tryBtn(p, 'Run'); },
  },
  {
    name: 'counts-peaks', route: '/counts-peaks',
    demo: async (p) => { await tab(p, 'Gene counts'); await btn(p, /Load SYNTHETIC demo/); },
    settleMs: 1_500,
  },
];

test('privacy: demos contact only same-origin or listed hosts and never send typed input', async ({ page }) => {
  test.setTimeout(600_000);
  const records: { studio: string; request: Request }[] = [];
  let studio = 'page load';
  page.on('request', (r) => records.push({ studio, request: r }));
  let markers = 0;

  for (const sc of scenarios) {
    studio = sc.name;
    await page.goto(sc.route);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
    await sc.demo(page);
    if (sc.marker) { await sc.marker.fill(page); markers++; await sc.marker.run(page); }
    else if (sc.analysis) await sc.analysis(page);
    await page.waitForTimeout(sc.settleMs ?? 350);
  }

  const siteOrigin = new URL(page.url()).origin;
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { studio: name, request } of records) {
    const u = new URL(request.url());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    seen.add(u.hostname);
    const same = u.origin === siteOrigin;
    const method = request.method().toUpperCase();
    if (!same && !GET_HOSTS.has(u.hostname)) problems.push(`${name}: unexpected host ${method} ${request.url()}`);
    if (!same && method !== 'GET' && method !== 'HEAD' && !POST_HOSTS.has(u.hostname)) problems.push(`${name}: ${method} to ${u.hostname} is not a listed POST host`);
    const body = request.postData() ?? '';
    if (request.url().includes(MARKER) || body.includes(MARKER)) problems.push(`${name}: typed sequence left the page in ${request.url()}`);
  }

  expect(problems).toEqual([]);
  expect(markers).toBeGreaterThanOrEqual(5);
  expect(seen.has('files.rcsb.org'), 'the request recorder saw the Structure demo fetch from RCSB').toBe(true);
  for (const host of [...GET_HOSTS, ...POST_HOSTS]) expect(allow.reasons[host], `allow-list reason for ${host}`).toBeTruthy();
  console.log(`privacy: ${records.length} requests over ${scenarios.length} demos, ${markers} marker inputs`);
});

interface OfflineFlow {
  name: string;
  route: string;
  /** Load the lazy chunks and workers online with one real run, then repeat offline. */
  warm?: boolean;
  run: (page: Page) => Promise<void>;
  result: (page: Page) => Promise<void>;
  timeout?: number;
}

const offlineFlows: OfflineFlow[] = [
  {
    name: 'lab', route: '/lab',
    run: async (p) => { await btn(p, 'Livak 2001 example'); await btn(p, 'Calculate'); },
    result: async (p) => { await expect(p.locator('table').first()).toContainText('kidney', { timeout: 20_000 }); },
  },
  {
    name: 'sequence', route: '/sequence', warm: true,
    run: async (p) => { await btn(p, 'Demo DNA', 15_000); await tab(p, 'Proteomics'); await btn(p, 'Digest'); },
    result: async (p) => { await expect(p.getByText('Residues covered')).toBeVisible({ timeout: 30_000 }); },
  },
  {
    name: 'crispr', route: '/crispr', warm: true,
    run: async (p) => { await btn(p, /Demo: 600-bp/); },
    result: async (p) => { await expect(p.getByRole('columnheader', { name: 'Protospacer' })).toBeVisible({ timeout: 60_000 }); },
  },
  {
    name: 'primer', route: '/primers',
    run: async (p) => { await btn(p, /Demo: 2-kb template/); },
    result: async (p) => { await expect(p.getByRole('columnheader', { name: 'Forward primer' })).toBeVisible({ timeout: 30_000 }); },
  },
  {
    name: 'enrich', route: '/enrichment', warm: true,
    run: async (p) => { await tab(p, 'Gene sets'); await btn(p, 'Load demo sets'); await tab(p, 'Over-representation'); await btn(p, 'Run ORA'); },
    result: async (p) => { await expect(p.getByRole('columnheader', { name: 'FDR' })).toBeVisible({ timeout: 60_000 }); },
  },
  {
    name: 'protocol', route: '/protocols',
    run: async (p) => { await btn(p, 'PCR (Taq) template'); await p.getByLabel('Reactions').fill('8'); },
    result: async (p) => { await expect(p.locator('table').last()).toContainText('88', { timeout: 15_000 }); },
  },
  {
    name: 'sanger', route: '/sanger',
    run: async (p) => { await btn(p, /Load demo \(400-base synthetic trace\)/); },
    result: async (p) => { await expect(p.getByText('SYNTHETIC_DEMO')).toBeVisible({ timeout: 20_000 }); },
  },
  {
    name: 'imagecount', route: '/image-counter',
    run: async (p) => { await btn(p, /Load demo \(42 colonies\)/); },
    result: async (p) => { await expect(p.locator('.stat', { hasText: 'Count' }).locator('.v')).toHaveText('42', { timeout: 60_000 }); },
  },
  {
    name: 'flow', route: '/flow',
    run: async (p) => { await btn(p, /Load demo \(30,000 events\)/); },
    result: async (p) => { await expect(p.locator('.stat', { hasText: 'Events' }).locator('.v')).toHaveText('30,000', { timeout: 30_000 }); },
  },
  {
    name: 'reads', route: '/reads', warm: true,
    run: async (p) => { await btn(p, /Load SYNTHETIC demo/); await tab(p, 'Trim & filter'); await btn(p, 'Run', 20_000); },
    result: async (p) => { await expect(p.getByText('Reads kept')).toBeVisible({ timeout: 60_000 }); },
  },
  {
    name: 'dynamics', route: '/dynamics',
    run: async (p) => { await btn(p, 'Run', 15_000); },
    result: async (p) => {
      const steps = p.locator('.card.stat', { hasText: 'Steps/s' }).locator('.v');
      await expect(steps).toHaveText(/^[1-9][\d,]* \(CPU\)$/, { timeout: 30_000 });
    },
  },
  {
    name: 'search', route: '/similarity-search', warm: true, timeout: 400_000,
    run: async (p) => { await tab(p, 'Search'); await btn(p, 'Load demo database'); await btn(p, 'Run search'); },
    result: async (p) => { await expect(p.getByRole('columnheader', { name: 'E-value' })).toBeVisible({ timeout: 120_000 }); },
  },
  {
    name: 'counts', route: '/counts-peaks', warm: true, timeout: 300_000,
    run: async (p) => { await tab(p, 'Gene counts'); await btn(p, /Load SYNTHETIC demo/); },
    result: async (p) => { await expect(p.getByRole('cell', { name: 'GENE01', exact: true }).first()).toBeVisible({ timeout: 90_000 }); },
  },
  {
    name: 'amplicon', route: '/amplicon', warm: true, timeout: 400_000,
    run: async (p) => { await btn(p, /Load demo \(3 synthetic samples/); await btn(p, 'Run'); },
    result: async (p) => { await expect(p.getByText('5 ASVs')).toBeVisible({ timeout: 180_000 }); },
  },
];

async function countDoneJobs(page: Page): Promise<number> {
  await page.getByRole('button', { name: 'Jobs' }).click();
  const drawer = page.getByRole('dialog', { name: 'Job Center' });
  await expect(drawer).toBeVisible({ timeout: 10_000 });
  const done = await drawer.locator('.badge').filter({ hasText: 'done' }).count();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden({ timeout: 10_000 });
  return done;
}

for (const flow of offlineFlows) {
  test(`offline: ${flow.name} still computes with the network cut`, async ({ page, context }) => {
    test.setTimeout(flow.timeout ?? 180_000);
    expect(needsNetworkByDesign).not.toContain(flow.name);
    await page.goto(flow.route);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
    // Chunks and workers are fetched online: a first run warms them, then the network is cut and the run is repeated.
    if (flow.warm) { await flow.run(page); await flow.result(page); }
    const doneBefore = flow.warm ? await countDoneJobs(page) : 0;
    await context.setOffline(true);
    try {
      await flow.run(page);
      await flow.result(page);
      if (flow.warm) expect(await countDoneJobs(page), 'a new finished job was recorded offline').toBeGreaterThan(doneBefore);
    } finally {
      await context.setOffline(false);
    }
  });
}

test('no WebGPU: Search Studio falls back to its CPU worker and says so', async ({ page }) => {
  test.setTimeout(400_000);
  await page.addInitScript(() => {
    try { Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined }); }
    catch { try { delete (Navigator.prototype as unknown as { gpu?: unknown }).gpu; } catch { /* leave the browser default */ } }
  });
  await page.goto('/similarity-search');
  await expect(page.locator('h1').first()).toHaveText(/Search Studio/);
  await expect(page.getByText(/^CPU: \d+ threads$/).first()).toBeVisible({ timeout: 30_000 });
  await btn(page, 'Load demo database');
  await page.getByRole('button', { name: 'Run search' }).click();
  await expect(page.getByRole('columnheader', { name: 'E-value' })).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText('WebGPU is not available, so the search ran on the CPU.')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('table')).toContainText(/PLANTED_\d/);
});

test('no WebGPU: Dynamics Studio runs the fluid on the CPU when the GPU engine is selected', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    try { Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined }); }
    catch { try { delete (Navigator.prototype as unknown as { gpu?: unknown }).gpu; } catch { /* leave the browser default */ } }
  });
  await page.goto('/dynamics');
  await page.getByRole('combobox', { name: 'Engine' }).selectOption('gpu');
  await expect(page.getByText('WebGPU is unavailable for this size on this device, so the CPU path is used.')).toBeVisible({ timeout: 30_000 });
  await btn(page, 'Run', 15_000);
  const steps = page.locator('.card.stat', { hasText: 'Steps/s' }).locator('.v');
  await expect(steps).toContainText('(CPU)', { timeout: 30_000 });
  await expect(steps).not.toHaveText('0 (CPU)');
});

test('bridge: no request to a local Bridge until the visitor presses Connect', async ({ page }) => {
  test.setTimeout(120_000);
  const local: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname === '127.0.0.1' || (u.hostname === 'localhost' && u.port === '8787')) local.push(`${r.method()} ${r.url()}`);
  });
  await page.goto('/');
  await expect(page.getByText('Nayancode Bridge').first()).toBeVisible({ timeout: 30_000 });
  await page.goto('/dynamics');
  await page.getByRole('tab', { name: 'Native MD (GROMACS)' }).click();
  await expect(page.getByTestId('bridge-connect')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('bridge-connect')).toBeDisabled();
  await page.waitForTimeout(2_000);
  expect(local).toEqual([]);
});

