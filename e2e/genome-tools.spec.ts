import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function watch(page: Page) {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ResizeObserver/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  return errs;
}

test('genome: primer specificity finds the one intended E. coli product', async ({ page }) => {
  const errs = watch(page); await page.goto('/genome');
  await page.getByRole('tab', { name: 'Primer specificity' }).click(); await page.getByRole('button', { name: /Demo: E. coli K-12 primers/ }).click();
  await page.getByRole('button', { name: 'Check specificity' }).click();
  await expect(page.getByText(/Specific:/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('cell', { name: 'intended' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /NC_000913\.3/ }).first()).toBeVisible();
  expect(errs).toEqual([]);
});

test('genome: CRISPR off-target search scores guides with CFD and MIT and annotates genes', async ({ page }) => {
  const errs = watch(page); await page.goto('/genome');
  await page.getByRole('tab', { name: 'CRISPR off-targets' }).click(); await page.getByRole('button', { name: /Demo: 3 SpCas9 guides/ }).click();
  await page.getByRole('button', { name: 'Find off-targets' }).click();
  await expect(page.getByText('Per-guide specificity')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('cell', { name: 'on-target' }).first()).toBeVisible();
  await expect(page.getByText(/PAM sites scanned/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /CFD specificity/ })).toBeVisible();
  expect(errs).toEqual([]);
});

test('genome: viewer opens a bundled genome, loads a local BED track and exports SVG', async ({ page }) => {
  const errs = watch(page); await page.goto('/genome');
  await page.getByRole('tab', { name: 'Genome viewer' }).click();
  const host = page.getByTestId('igv-host'); await expect(host.locator('.igv-viewport, canvas').first()).toBeVisible({ timeout: 60_000 });
  const bed = join(tmpdir(), 'e2e_peaks.bed'); writeFileSync(bed, 'NC_000913.3\t1000\t2000\tpeak1\nNC_000913.3\t3000\t4500\tpeak2\n');
  await page.getByLabel('Track files').setInputFiles(bed);
  await expect(page.getByText('e2e_peaks.bed').first()).toBeVisible();
  await page.getByLabel('Locus search').fill('NC_000913.3:1-6000'); await page.getByRole('button', { name: 'Go', exact: true }).click();
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export SVG' }).click();
  expect((await dl).suggestedFilename()).toMatch(/^vivofold-nayancode_genome_view_\d{4}-\d{2}-\d{2}\.svg$/);
  expect(errs.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test('genome: a bundled genome can be chosen as the mapping reference', async ({ page }) => {
  await page.goto('/genome'); await page.getByRole('tab', { name: 'Mapping & variants' }).click();
  await page.getByLabel('Bundled reference genome').selectOption('lambda');
  await expect(page.getByText(/Reference: 1 contig\(s\), 48,502 bp/)).toBeVisible({ timeout: 30_000 });
});

test('genome: Genome Studio mapping output opens in the viewer as BAM + VCF tracks', async ({ page }) => {
  const errs = watch(page); await page.goto('/genome');
  await page.getByRole('tab', { name: 'Mapping & variants' }).click(); await page.getByRole('button', { name: /Demo: simulated/ }).click(); await page.getByRole('button', { name: 'Map & call' }).click();
  await expect(page.getByText(/8\/8 planted variants recovered/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Open in genome browser' }).click();
  // Wait until the default (E. coli) browser is live, so that switching to the mapping reference replaces a ready browser (the slower CI timing).
  await expect(page.getByTestId('igv-host').locator('.igv-viewport, canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /Add Genome Studio mapping/ }).click();
  await expect(page.getByText('mapped.bam').first()).toBeVisible(); await expect(page.getByText('mapped_variants.vcf').first()).toBeVisible();
  await expect(page.getByTestId('igv-host').getByText(/mapped\.bam/).first()).toBeVisible({ timeout: 30_000 });
  expect(errs.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
