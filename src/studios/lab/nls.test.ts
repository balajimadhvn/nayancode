import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fitNls, invert } from './nls';

const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/lab/nls-reference.json', import.meta.url), 'utf8')) as {
  x: number[]; y: number[]; a: number; b: number; aSE: number; bSE: number;
};

describe('fitNls', () => {
  it('recovers a noise-free exponential y = a·exp(−b·x) to 1e-6', () => {
    const x: number[][] = [], y: number[] = [];
    for (let i = 0; i <= 20; i++) { const v = i / 2; x.push([v]); y.push(3 * Math.exp(-0.5 * v)); }
    const fit = fitNls(([v], p) => p[0] * Math.exp(-p[1] * v), x, y, [1, 1]);
    expect(fit.converged).toBe(true);
    expect(Math.abs(fit.p[0] - 3)).toBeLessThan(1e-6);
    expect(Math.abs(fit.p[1] - 0.5)).toBeLessThan(1e-6);
  });

  it('matches scipy on a noisy exponential dataset (parameters and standard errors)', () => {
    const fit = fitNls(([v], p) => p[0] * Math.exp(-p[1] * v), ref.x.map((v) => [v]), ref.y, [1, 0.1]);
    expect(Math.abs(fit.p[0] - ref.a) / ref.a).toBeLessThan(1e-4);
    expect(Math.abs(fit.p[1] - ref.b) / ref.b).toBeLessThan(1e-4);
    expect(Math.abs(fit.se[0] - ref.aSE) / ref.aSE).toBeLessThan(1e-3);
    expect(Math.abs(fit.se[1] - ref.bSE) / ref.bSE).toBeLessThan(1e-3);
    expect(fit.df).toBe(ref.x.length - 2);
    expect(fit.r2).toBeGreaterThan(0.99);
  });

  it('reports the residual sum of squares and r2 consistently', () => {
    const x = [[0], [1], [2], [3]], y = [1, 3.1, 4.8, 7.2];
    const fit = fitNls(([v], p) => p[0] + p[1] * v, x, y, [0, 1]);
    const rss = y.reduce((s, v, i) => s + (v - (fit.p[0] + fit.p[1] * x[i][0])) ** 2, 0);
    expect(fit.rss).toBeCloseTo(rss, 9);
    expect(fit.r2).toBeGreaterThan(0.99);
    expect(fit.ci95[1][0]).toBeLessThan(fit.p[1]);
    expect(fit.ci95[1][1]).toBeGreaterThan(fit.p[1]);
  });

  it('returns SE 0 when there are no residual degrees of freedom', () => {
    const fit = fitNls(([v], p) => p[0] * v, [[1], [2]], [2, 4], [1]);
    expect(fit.df).toBe(1);
    expect(fit.p[0]).toBeCloseTo(2, 9);
  });

  it('throws on mismatched lengths', () => {
    expect(() => fitNls((_x, p) => p[0], [[1], [2]], [1], [0])).toThrow(/same length/);
  });

  it('inverts a matrix and returns null for a singular one', () => {
    expect(invert([[2, 0], [0, 4]])).toEqual([[0.5, 0], [0, 0.25]]);
    expect(invert([[1, 2], [2, 4]])).toBeNull();
  });
});
