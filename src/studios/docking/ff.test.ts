import { describe, expect, it } from 'vitest';
import { ffEnergy, type FFTerms } from './ff';

describe('force field gradients', () => {
  it('match finite differences for every term type', () => {
    const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5; })();
    const n = 6, x = Float64Array.from({ length: 3 * n }, () => rnd() * 3);
    const T: FFTerms = {
      bonds: [{ a: 0, b: 1, r0: 1.5 }], angles: [{ a: 0, b: 1, c: 2, t0: 1.9, k: 100 }],
      torsions: [{ a: 0, b: 1, c: 2, d: 3, k: 1, n: 3, delta: 0 }, { a: 1, b: 2, c: 3, d: 4, k: 2, n: 2, delta: Math.PI }, { a: 2, b: 3, c: 4, d: 5, k: 3, n: 1, delta: 1 }],
      chiral: [{ c: 0, a: 1, b: 2, d: 3, sign: 1 }, { c: 4, a: 1, b: 2, d: 3, sign: -1 }], planar: [[0, 1, 2, 3]], repel: [[0, 5, 4]],
    };
    const g = new Float64Array(3 * n); ffEnergy(x, T, g);
    for (let i = 0; i < 3 * n; i++) {
      const h = 1e-6, xp = Float64Array.from(x), xm = Float64Array.from(x); xp[i] += h; xm[i] -= h;
      const num = (ffEnergy(xp, T, null) - ffEnergy(xm, T, null)) / (2 * h);
      expect(Math.abs(num - g[i]), `coordinate ${i}`).toBeLessThan(1e-4 * Math.max(1, Math.abs(num)));
    }
  });
});
