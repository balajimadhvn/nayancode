import { expect, test, type Page } from '@playwright/test';

async function hasAdapter(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    try { return (await gpu.requestAdapter()) !== null; } catch { return false; }
  });
}

interface Parity { gpu: boolean; n: number; maxDiff: number; topSame: boolean; values: number[] }

// Python RDKit reference: AllChem.GetMorganFingerprintAsBitVect(mol, 2, 2048)
// and DataStructs.TanimotoSimilarity for all 45 pairs of the 10 reference drugs.
const PYTHON = [0.1951219512195122, 0.2222222222222222, 0.08888888888888889, 0.20454545454545456, 0.1956521739130435, 0.0847457627118644, 0.05128205128205128, 0.15714285714285714, 0.1038961038961039, 0.18421052631578946, 0.08695652173913043, 0.42105263157894735, 0.16666666666666666, 0.08333333333333333, 0.05, 0.15492957746478872, 0.075, 0.0975609756097561, 0.16666666666666666, 0.1590909090909091, 0.09090909090909091, 0.05714285714285714, 0.16666666666666666, 0.06578947368421052, 0.08, 0.07692307692307693, 0.1206896551724138, 0.024390243902439025, 0.07894736842105263, 0.14666666666666667, 0.1320754716981132, 0.09523809523809523, 0.045454545454545456, 0.13157894736842105, 0.0975609756097561, 0.05970149253731343, 0.02127659574468085, 0.15789473684210525, 0.06976744186046512, 0.03636363636363636, 0.10227272727272728, 0.16091954022988506, 0.04225352112676056, 0.012987012987012988, 0.07272727272727272];

async function openParity(page: Page) {
  await page.goto('/chemistry?simParity=1');
  await page.getByRole('tab', { name: 'Similarity search', exact: true }).click();
  await page.waitForFunction(() => typeof (window as unknown as { __ncSimParity?: unknown }).__ncSimParity === 'function', undefined, { timeout: 30_000 });
  return page.evaluate(() => (window as unknown as { __ncSimParity(): Promise<Parity> }).__ncSimParity());
}

test('GPU Tanimoto equals the CPU values and the top-10 list on 5,000 random fingerprints', async ({ page }) => {
  await page.goto('/chemistry?simParity=1');
  test.skip(!(await hasAdapter(page)), 'no WebGPU adapter');
  const r = await openParity(page);
  expect(r.gpu).toBe(true);
  expect(r.n).toBe(5000);
  expect(r.maxDiff).toBeLessThanOrEqual(1e-6);
  expect(r.topSame).toBe(true);
});

test('browser RDKit Morgan fingerprints reproduce the Python Tanimoto matrix', async ({ page }) => {
  const r = await openParity(page);
  expect(r.values).toHaveLength(45);
  for (let i = 0; i < PYTHON.length; i++) {
    expect(Math.abs(r.values[i] - PYTHON[i]), `pair ${i}`).toBeLessThan(1e-9);
  }
});

test('UI parses the example library, ranks the query first, and clusters it', async ({ page }) => {
  await page.goto('/chemistry');
  await page.getByRole('tab', { name: 'Similarity search', exact: true }).click();
  const parse = page.getByRole('button', { name: 'Parse & fingerprint' });
  await expect(parse).toBeEnabled({ timeout: 40_000 });
  await parse.click();
  await expect(page.getByText('10 molecules are fingerprinted and ready.')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const hits = page.locator('section.card', { hasText: 'Top hits' });
  await expect(hits.locator('tbody tr').first()).toContainText('Aspirin', { timeout: 60_000 });
  await expect(hits.locator('tbody tr').first().locator('td').nth(2)).toHaveText('1');
  await page.getByRole('button', { name: 'Cluster (Butina)' }).click();
  const clusters = page.locator('section.card', { hasText: 'Butina clusters' });
  await expect(clusters.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
  await expect(clusters.getByText('Clusters', { exact: true })).toBeVisible();
});
