import { expect, test, type Page } from '@playwright/test';

/**
 * WebGPU cannot run in Node/vitest, so these checks use the production build in
 * a Chromium with a real adapter (playwright.gpu.config.ts). On a machine with
 * no adapter every test skips rather than fails: absence of a GPU is normal.
 */
async function hasAdapter(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    try { return (await gpu.requestAdapter()) !== null; } catch { return false; }
  });
}

function parseNumber(s: string | null): number {
  const m = (s ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
  return m ? Number(m[0]) : NaN;
}

test('device card detects WebGPU and benchmarks CPU against GPU', async ({ page }) => {
  await page.goto('/');
  test.skip(!(await hasAdapter(page)), 'no WebGPU adapter');
  await expect(page.locator('.card-title').filter({ hasText: 'This device' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('WebGPU', { exact: true })).toBeVisible();
  await expect(page.getByTestId('bench-button')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('bench-button').click();

  const diff = page.getByTestId('bench-diff');
  await expect(diff).toBeVisible({ timeout: 90_000 });
  const maxDiff = parseNumber(await diff.textContent());
  expect(Number.isFinite(maxDiff)).toBe(true);
  expect(maxDiff).toBeLessThan(1e-3);

  const gflopsText = await page.getByTestId('bench-gflops').textContent();
  const gflops = parseNumber(gflopsText);
  expect(gflops).toBeGreaterThan(0);

  // The same kernel on an identity matrix must reproduce its input exactly.
  await expect(page.getByTestId('bench-identity')).toContainText('exact');
});

test('device card reports the tier and the honest guidance', async ({ page }) => {
  await page.goto('/');
  test.skip(!(await hasAdapter(page)), 'no WebGPU adapter');
  await expect(page.locator('.card-title').filter({ hasText: 'This device' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Want the full power of your own workstation/)).toBeVisible();
  await expect(page.getByText(/Runs in your browser/).first()).toBeVisible();
  await expect(page.getByText(/research-grade and not clinical/)).toBeVisible();
});
