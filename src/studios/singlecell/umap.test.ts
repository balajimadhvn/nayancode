import { describe, expect, it } from 'vitest';
import { fitAB, knn, umap } from './umap';

const blobs = (seed: number, per: number, centres: number[][]) => { let s = seed; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); return centres.flatMap((c, ci) => Array.from({ length: per }, () => ({ x: c.map((v) => v + (r() - 0.5) * 1.5), ci }))); };

describe('UMAP', () => {
  it('fits the membership curve to the reference a, b for min_dist 0.1 / spread 1 (≈1.577, 0.895)', () => {
    const { a, b } = fitAB(0.1, 1); expect(a).toBeGreaterThan(1.4); expect(a).toBeLessThan(1.75); expect(b).toBeGreaterThan(0.84); expect(b).toBeLessThan(0.95);
  });
  it('exact kNN returns sorted nearest neighbours', () => {
    const { idx, dist } = knn([[0], [1], [3], [7]], 2); expect(Array.from(idx.subarray(0, 2))).toEqual([1, 2]); expect(Array.from(dist.subarray(0, 2))).toEqual([1, 3]);
  });
  it('separates planted clusters (10-NN purity in 2-D) and is deterministic', () => {
    const d = blobs(5, 60, [[0, 0, 0, 0, 0], [8, 0, 0, 0, 0], [0, 8, 0, 0, 0], [0, 0, 8, 8, 0]]), X = d.map((p) => p.x);
    const Y = umap(X, { nNeighbors: 12, epochs: 300, seed: 2 }); let pure = 0, tot = 0;
    for (let i = 0; i < Y.length; i++) { const nb = Y.map((p, j) => [Math.hypot(p[0] - Y[i][0], p[1] - Y[i][1]), j] as const).filter(([, j]) => j !== i).sort((p, q) => p[0] - q[0]).slice(0, 10); for (const [, j] of nb) { tot++; if (d[j].ci === d[i].ci) pure++; } }
    expect(pure / tot).toBeGreaterThan(0.97);
    expect(umap(X, { nNeighbors: 12, epochs: 50, seed: 2 })).toEqual(umap(X, { nNeighbors: 12, epochs: 50, seed: 2 }));
  });
});
