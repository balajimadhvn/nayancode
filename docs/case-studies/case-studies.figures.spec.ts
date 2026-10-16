// Captures the case-study figures exactly as the Workbench draws them (cards are screenshotted as PNG).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

const root = new URL('../../', import.meta.url).pathname, out = root + 'docs/case-studies/figures/', cache = root + 'benchmarks/.cache/';
mkdirSync(out, { recursive: true });
const card = (page: Page, title: string | RegExp) => page.locator('.card').filter({ has: page.locator('.card-title').filter({ hasText: title }) }).first();
const shot = async (page: Page, title: string | RegExp, file: string) => { const c = card(page, title); await c.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await c.screenshot({ path: out + file }); };

test('A · airway: volcano, MA and Reactome GSEA', async ({ page }) => {
  writeFileSync(cache + 'airway_counts.tsv', gunzipSync(readFileSync(root + 'benchmarks/deseq2/airway_counts.tsv.gz')));
  await page.goto('/expression');
  const inputs = page.locator('input[type=file]');
  await inputs.nth(0).setInputFiles(cache + 'airway_counts.tsv'); await inputs.nth(1).setInputFiles(root + 'benchmarks/deseq2/airway_samples.tsv');
  await expect(page.getByText(/~ cell \+ dex/)).toBeVisible();
  await page.locator('select').filter({ has: page.locator('option[value="dex"]') }).first().selectOption('dex');
  await page.locator('label.field', { hasText: 'Reference level' }).locator('select').selectOption('untrt');
  await page.locator('label.field', { hasText: 'Comparison level' }).locator('select').selectOption('trt');
  await page.getByRole('button', { name: 'Run analysis' }).click(); await expect(page.getByText('Genes tested')).toBeVisible({ timeout: 120_000 });
  await shot(page, 'Volcano', 'airway_volcano.png'); await shot(page, 'MA plot', 'airway_ma.png');
  await page.getByRole('tab', { name: 'Enrichment' }).click();
  await page.locator('label.field', { hasText: 'Method' }).locator('select').selectOption('gsea'); await page.getByRole('button', { name: 'Run enrichment' }).click();
  await expect(page.getByText('Top terms')).toBeVisible({ timeout: 300_000 }); await shot(page, 'Top terms', 'airway_gsea_reactome.png');
});

test('B · PBMC3k: UMAP and cluster annotation', async ({ page }) => {
  const d = cache + 'pbmc3k/filtered_gene_bc_matrices/hg19/';
  await page.goto('/single-cell');
  await page.locator('input[type=file]').first().setInputFiles([d + 'matrix.mtx', d + 'genes.tsv', d + 'barcodes.tsv']);
  await page.getByRole('button', { name: 'Run pipeline' }).click(); await expect(page.getByText('Cells kept')).toBeVisible({ timeout: 300_000 });
  await shot(page, /UMAP embedding/, 'pbmc3k_umap.png'); await shot(page, 'Cluster annotation', 'pbmc3k_annotation.png');
});

test('C · E. coli LTEE line: coverage and variants', async ({ page }) => {
  const e = cache + 'ecoli/';
  await page.goto('/genome'); await page.getByRole('tab', { name: 'Mapping & variants' }).click();
  await page.locator('input[type=file]').first().setInputFiles(e + 'REL606.fa');
  await page.locator('label.dropzone input[type=file][accept=".fastq,.fq"]').setInputFiles(e + 'SRR2584863_1.800k.fastq');
  await page.locator('label.field', { hasText: 'Ploidy' }).locator('select').selectOption('1');
  const t0 = Date.now(); await page.getByRole('button', { name: 'Map & call' }).click();
  await expect(page.getByText('Variants called')).toBeVisible({ timeout: 1_500_000 });
  writeFileSync(root + 'docs/case-studies/results/ecoli_browser_runtime.json', JSON.stringify({ browserSeconds: Math.round((Date.now() - t0) / 1000), browser: 'Chromium (Playwright, headless)' }) + '\n');
  await shot(page, 'Coverage', 'ecoli_coverage.png'); await shot(page, 'Variants', 'ecoli_variants.png');
});
