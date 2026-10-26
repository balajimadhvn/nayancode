import { describe, expect, it } from 'vitest';
import { knnCpu, planKnnGpu, MAX_DIMS, MAX_K } from './knnGpu';

/** Same 32-bit generator as /tmp/phase4-scratch/knn.py and the GPU e2e test. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('knnCpu known answers', () => {
  it('finds the nearest neighbours of a hand example', () => {
    // A(0,0) B(1,0) C(0,2) D(3,3) E(0.5,0)
    const X = new Float32Array([0, 0, 1, 0, 0, 2, 3, 3, 0.5, 0]);
    const r = knnCpu(X, 5, 2, 2);
    expect(Array.from(r.idx)).toEqual([4, 1, 4, 0, 0, 4, 2, 1, 0, 1]);
    expect(r.dist[0]).toBeCloseTo(0.5, 6);
    expect(r.dist[1]).toBeCloseTo(1, 6);
  });

  it('matches Python numpy on 200 seeded cells in 10 dimensions', () => {
    const rnd = mulberry32(20261026);
    const X = new Float32Array(200 * 10);
    for (let i = 0; i < X.length; i++) X[i] = rnd() * 2 - 1;
    const r = knnCpu(X, 200, 10, 10);
    // Python: numpy Euclidean distances, self excluded, argsort(kind='stable')[:10]
    const expected: Record<number, number[]> = {
      0: [34, 176, 127, 145, 68, 50, 51, 141, 32, 193],
      1: [42, 27, 23, 35, 84, 136, 79, 28, 58, 30],
      17: [175, 196, 128, 93, 143, 198, 160, 75, 115, 84],
      99: [49, 46, 38, 96, 50, 169, 5, 65, 82, 176],
      199: [107, 47, 186, 138, 192, 2, 32, 22, 119, 15],
    };
    for (const [i, want] of Object.entries(expected)) {
      const row = +i;
      expect(Array.from(r.idx.subarray(row * 10, row * 10 + 10))).toEqual(want);
    }
    // Distances from the same Python run (six decimals), allowing f32 readout.
    const d0 = [1.29548, 1.451547, 1.471516, 1.500605, 1.527324, 1.586517, 1.594978, 1.639768, 1.672116, 1.703982];
    for (let t = 0; t < 10; t++) expect(r.dist[t]).toBeCloseTo(d0[t], 4);
  });

  it('rejects impossible shapes', () => {
    expect(() => knnCpu(new Float32Array(4), 1, 4, 1)).toThrow(/at least two/);
    expect(() => knnCpu(new Float32Array(20), 2, 10, 0)).toThrow(/at least 1/);
  });
});

describe('GPU batching planner', () => {
  it('plans the default limits without exceeding them', () => {
    const p = planKnnGpu(5000, 50, 15);
    expect(p.fits).toBe(true);
    expect(p.k).toBe(15);
    expect(p.perBatch).toBe(512);
    expect(p.batches).toBe(10);
    expect(p.xBytes).toBe(1_000_000);
    expect(p.bytesPerBatch).toBe(61_440);
    expect(p.xBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
    expect(p.bytesPerBatch).toBeLessThanOrEqual(128 * 1024 * 1024);
  });

  it('still fits the planned batches in a 1 MiB binding limit', () => {
    const cap = 1024 * 1024;
    const p = planKnnGpu(5000, 50, 15, { maxStorageBufferBindingSize: cap, maxBufferSize: cap });
    expect(p.fits).toBe(true);
    expect(p.perBatch).toBe(512);
    expect(p.batches).toBe(10);
    expect(p.xBytes).toBeLessThanOrEqual(cap);
    expect(p.bytesPerBatch).toBeLessThanOrEqual(cap);
    expect(p.perBatch * (p.batches - 1)).toBeLessThan(5000);
  });

  it('refuses a coordinate matrix larger than one binding', () => {
    const p = planKnnGpu(5000, 100, 15, { maxStorageBufferBindingSize: 1024 * 1024, maxBufferSize: 1024 * 1024 });
    expect(p.fits).toBe(false);
    expect(p.reason).toMatch(/binding limit/);
  });

  it('documented kernel bounds are enforced', () => {
    expect(planKnnGpu(100, MAX_DIMS + 1, 5).fits).toBe(false);
    expect(planKnnGpu(100, 10, MAX_K + 1).fits).toBe(false);
  });
});
