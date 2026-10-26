import { expect, test, type Page } from '@playwright/test';

async function hasAdapter(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    try { return (await gpu.requestAdapter()) !== null; } catch { return false; }
  });
}

interface Parity { gpu: boolean; mismatch: number; top5: string[]; familyRanks: number[]; maxFamilyE: number; gcups: number }

test('Smith-Waterman GPU scores equal the CPU scores exactly and rank the planted family', async ({ page }) => {
  await page.goto('/similarity-search?searchParity=1');
  test.skip(!(await hasAdapter(page)), 'no WebGPU adapter');
  await page.waitForFunction(() => typeof (window as unknown as { __ncSearchParity?: unknown }).__ncSearchParity === 'function', undefined, { timeout: 30_000 });
  const r = await page.evaluate(() => (window as unknown as { __ncSearchParity(): Promise<Parity> }).__ncSearchParity());
  expect(r.gpu).toBe(true);
  // 2,000 synthetic proteins, a 300-residue query: integer scores must match exactly.
  expect(r.mismatch).toBe(0);
  // The five planted family members must occupy the top five ranks, with tiny E-values.
  expect(r.top5.every((id) => id.startsWith('PLANTED_'))).toBe(true);
  expect(r.top5).toHaveLength(5);
  expect(Math.max(...r.familyRanks)).toBeLessThanOrEqual(5);
  expect(r.maxFamilyE).toBeLessThan(1e-5);
  expect(r.gcups).toBeGreaterThan(0);
});
