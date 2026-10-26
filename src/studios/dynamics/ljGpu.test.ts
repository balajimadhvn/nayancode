import { describe, expect, it } from 'vitest';
import { forceWgsl, kickWgsl, planLjGpu } from './ljGpu';

describe('planLjGpu', () => {
  it('fits 2048 atoms in the WebGPU default 128 MiB storage limit', () => {
    const p = planLjGpu(2048, {}, { steps: 1000 });
    expect(p.fits).toBe(true);
    expect(p.bytesPerBuffer).toBe(2048 * 12);
    expect(p.bytesPerBuffer).toBeLessThanOrEqual(128 * 1024 * 1024);
    expect(p.batches * p.stepsPerSubmit).toBeGreaterThanOrEqual(1000);
    expect(p.stepsPerSubmit).toBeLessThanOrEqual(1000);
    expect(p.batches).toBeGreaterThan(0);
  });

  it('refuses a run that does not fit a tiny 1 MiB device limit', () => {
    const p = planLjGpu(100_000, { maxStorageBufferBindingSize: 1024 * 1024, maxBufferSize: 1024 * 1024 });
    expect(p.fits).toBe(false);
    expect(p.batches).toBe(0);
    expect(p.bytesPerBuffer).toBeGreaterThan(1024 * 1024);
    expect(p.reason).toMatch(/MiB/);
  });

  it('splits a long run into batches that each fit', () => {
    const p = planLjGpu(8000, { maxStorageBufferBindingSize: 4 * 1024 * 1024, maxBufferSize: 8 * 1024 * 1024 }, { steps: 1000, targetStepsPerSubmit: 25 });
    expect(p.fits).toBe(true);
    expect(p.stepsPerSubmit).toBe(25);
    expect(p.batches).toBe(40);
    expect(p.bytesPerBuffer * p.stepsPerSubmit * 2).toBeLessThanOrEqual(8 * 1024 * 1024 * 8);
  });
});

describe('shaders are base-spec and bounds-checked', () => {
  it('uses 64 threads per workgroup and returns out-of-range invocations', () => {
    for (const src of [kickWgsl(108), forceWgsl(108)]) {
      expect(src).toContain('@workgroup_size(64)');
      expect(src).toContain('if (i >= N) { return; }');
      expect(src).toContain('const N: u32 = 108u');
      expect(src).not.toMatch(/f16|subgroup/i);
    }
  });

  it('wraps positions and applies the minimum image', () => {
    expect(kickWgsl(8)).toContain('floor(x / p.L)');
    expect(forceWgsl(8)).toContain('round(d / p.L)');
  });
});
