import { expect, test, type Page } from '@playwright/test';

async function hasAdapter(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    try { return (await gpu.requestAdapter()) !== null; } catch { return false; }
  });
}

test('Lennard-Jones GPU kernel matches the CPU twin and conserves energy', async ({ page }) => {
  await page.goto('/dynamics?gpuParity=1');
  test.skip(!(await hasAdapter(page)), 'no WebGPU adapter');
  await page.waitForFunction(() => typeof (window as unknown as { __ncLjParity?: unknown }).__ncLjParity === 'function', undefined, { timeout: 30_000 });
  const r = await page.evaluate(() => (window as unknown as { __ncLjParity(): Promise<{ gpu: boolean; maxPosDiff: number; nveDrift: number }> }).__ncLjParity());
  expect(r.gpu).toBe(true);
  // Same seeded state, 20 velocity-Verlet steps: f32 GPU vs f64 CPU.
  expect(r.maxPosDiff).toBeLessThan(1e-3);
  // 1000 GPU steps in NVE: relative total-energy drift < 0.5 %.
  expect(r.nveDrift).toBeLessThan(5e-3);
});

test('GPU engine can be selected in the fluid tab', async ({ page }) => {
  await page.goto('/dynamics');
  test.skip(!(await hasAdapter(page)), 'no WebGPU adapter');
  await page.getByRole('combobox', { name: 'Engine' }).selectOption('gpu');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const speed = page.locator('.card.stat', { hasText: 'Steps/s' }).first().locator('.v');
  await expect(speed).toContainText('GPU', { timeout: 30_000 });
});
