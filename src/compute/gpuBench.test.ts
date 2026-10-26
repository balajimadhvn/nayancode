import { describe, expect, it } from 'vitest';
import { benchmark, matmulCpu, matmulWgsl, mulberry32, pad16 } from './gpuBench';

const m = (rows: number[][]) => new Float32Array(rows.flat());

describe('matmulCpu (known answers)', () => {
  it('2x2 hand example', () => {
    const c = matmulCpu(m([[1, 2], [3, 4]]), m([[5, 6], [7, 8]]), 2);
    expect(Array.from(c)).toEqual([19, 22, 43, 50]);
  });

  it('4x4 identity times a known matrix returns that matrix', () => {
    const I = m([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
    const A = m([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]);
    expect(Array.from(matmulCpu(I, A, 4))).toEqual(Array.from(A));
    expect(Array.from(matmulCpu(A, I, 4))).toEqual(Array.from(A));
  });

  it('matches a numpy-style outer-product check for a 3x3 case', () => {
    // [[1,2,0],[0,1,3],[4,0,1]] x [[2,0,1],[1,1,0],[0,3,1]]
    const a = m([[1, 2, 0], [0, 1, 3], [4, 0, 1]]);
    const b = m([[2, 0, 1], [1, 1, 0], [0, 3, 1]]);
    expect(Array.from(matmulCpu(a, b, 3))).toEqual([4, 2, 1, 1, 10, 3, 8, 3, 5]);
  });
});

describe('padding and shader generation', () => {
  it('pads to the next multiple of 16 and keeps the top-left block', () => {
    const a = m([[1, 2], [3, 4]]);
    const p = pad16(a, 2);
    expect(p.size).toBe(16);
    expect(p.data.length).toBe(256);
    expect(Array.from(p.data.subarray(0, 2))).toEqual([1, 2]);
    expect(Array.from(p.data.subarray(16, 18))).toEqual([3, 4]);
    expect(p.data[2]).toBe(0);
  });

  it('does not copy when already aligned', () => {
    const a = new Float32Array(256 * 256);
    expect(pad16(a, 256).data).toBe(a);
  });

  it('emits a 16x16 workgroup shader with the size as a constant', () => {
    const src = matmulWgsl(32);
    expect(src).toContain('const N: u32 = 32u');
    expect(src).toContain('@workgroup_size(16, 16)');
    expect(src).toContain('workgroupBarrier()');
  });

  it('mulberry32 is deterministic and stays in [0,1)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('benchmark without WebGPU', () => {
  it('still times the CPU and reports gpu: false', async () => {
    const r = await benchmark(64);
    expect(r.gpu).toBe(false);
    expect(r.gflopsCpu).toBeGreaterThan(0);
    expect(r.gflopsGpu).toBe(0);
    expect(Number.isNaN(r.maxAbsDiff)).toBe(true);
    expect(r.identityExact).toBe(false);
  });
});
