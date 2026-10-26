import { describe, expect, it } from 'vitest';
import { planSearchGpu, swWgsl } from './swGpu';

const MiB = 1024 * 1024;

describe('search batching planner', () => {
  it('fits the demo database in one submission at the default WebGPU limits', () => {
    const p = planSearchGpu(2000, 650_000, 300, {});
    expect(p.fits).toBe(true);
    expect(p.batches).toBe(1);
    expect(p.seqsPerBatch).toBe(2000);
    expect(p.bytesPerBatch).toBeLessThanOrEqual(128 * MiB);
  });

  it('splits the same work into batches under a 1 MiB storage limit', () => {
    const p = planSearchGpu(2000, 650_000, 300, { maxStorageBufferBindingSize: MiB, maxBufferSize: 2 * MiB }, { longest: 600 });
    expect(p.fits).toBe(true);
    expect(p.batches).toBeGreaterThan(1);
    expect(p.seqsPerBatch).toBeGreaterThan(0);
    expect(p.bytesPerBatch).toBeLessThanOrEqual(MiB);
    expect(p.batches).toBe(Math.ceil(2000 / p.seqsPerBatch));
    // Worst case: every sequence in the batch is the longest one (600 residues).
    expect(p.bytesPerBatch).toBe(4 * (600 * p.seqsPerBatch + p.seqsPerBatch + 1));
  });

  it('refuses cleanly when even one sequence does not fit', () => {
    const p = planSearchGpu(2000, 650_000, 300, { maxStorageBufferBindingSize: 4096, maxBufferSize: 4096 });
    expect(p.fits).toBe(false);
    expect(p.seqsPerBatch).toBe(0);
    expect(p.reason).toMatch(/CPU path/);
  });

  it('emits the fixed private DP arrays and one invocation per sequence', () => {
    const w = swWgsl();
    expect(w).toContain('array<i32, 1025>');
    expect(w).toContain('@workgroup_size(64)');
    expect(w).toContain('scores[p.base + seq] = best');
    expect(w).toContain('max(hPrev - 12, E[j] - 1)');
  });
});
