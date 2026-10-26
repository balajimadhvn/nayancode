import { expect, test, type Page } from '@playwright/test';

async function hasAdapter(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    try { return (await gpu.requestAdapter()) !== null; } catch { return false; }
  });
}

interface Parity { gpu: boolean; cells: number; k: number; mismatch: number; maxRel: number; speedup: number; cpuMs: number; gpuMs: number }

test('exact kNN on 5,000 clustered cells matches the CPU neighbour sets and distances', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/single-cell?knnParity=1');
  test.skip(!(await hasAdapter(page)), 'no WebGPU adapter');
  await page.waitForFunction(() => typeof (window as unknown as { __ncKnnParity?: unknown }).__ncKnnParity === 'function', undefined, { timeout: 30_000 });
  const r = await page.evaluate(() => (window as unknown as { __ncKnnParity(): Promise<Parity> }).__ncKnnParity());
  expect(r.gpu).toBe(true);
  expect(r.cells).toBe(5000);
  expect(r.k).toBe(15);
  // A set difference is only allowed when the CPU's 15th and 16th distances are
  // within 1e-4 (a genuine tie for the last place).
  expect(r.mismatch).toBe(0);
  expect(r.maxRel).toBeLessThanOrEqual(1e-3);
  expect(r.speedup).toBeGreaterThan(0);
  console.log(`GPU exact kNN: ${r.cells} cells, k=${r.k}, CPU ${r.cpuMs.toFixed(0)} ms, GPU ${r.gpuMs.toFixed(0)} ms, speed-up ${r.speedup.toFixed(2)}x`);
});
