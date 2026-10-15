import { describe, expect, it } from 'vitest';
import { bh, clusterOrder, differential, digamma, normalise, parseGroups, parseMatrix, pca, sizeFactors, squeezeVar, syntheticExperiment, tTwoSided, trigamma } from './kernels';

describe('special functions', () => {
  it('digamma / trigamma reference values', () => {
    expect(digamma(1)).toBeCloseTo(-0.5772156649, 7);
    expect(digamma(0.5)).toBeCloseTo(-1.9635100260, 7);
    expect(trigamma(1)).toBeCloseTo(Math.PI ** 2 / 6, 7);
    expect(trigamma(0.5)).toBeCloseTo(Math.PI ** 2 / 2, 7);
  });
  it('t-distribution two-sided p matches tables', () => {
    expect(tTwoSided(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(tTwoSided(2.0, Infinity)).toBeCloseTo(0.0455, 3);
    expect(tTwoSided(0, 5)).toBeCloseTo(1, 10);
    expect(tTwoSided(12.706, 1)).toBeCloseTo(0.05, 3);
  });
  it('BH matches the R p.adjust example', () => {
    const adj = bh([0.01, 0.02, 0.03, 0.04, 0.05]);
    adj.forEach((v) => expect(v).toBeCloseTo(0.05, 10));
    const adj2 = bh([0.001, 0.04, 0.03, 0.5]);
    expect(adj2[0]).toBeCloseTo(0.004, 10);
    expect(adj2[3]).toBeCloseTo(0.5, 10);
  });
  it('squeezeVar recovers a simulated prior', () => {
    // s2 ~ s0² * chi2_d / d is F-scaled; draw with d=4, d0 large-ish
    let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const chi = (k: number) => { let s = 0; for (let i = 0; i < k; i++) { const u = rnd(), v = rnd(); s += (Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)) ** 2; } return s; };
    const s2 = Array.from({ length: 6000 }, () => 2 * (chi(4) / 4));
    const { s02, d0 } = squeezeVar(s2, 4);
    expect(s02).toBeGreaterThan(1.5); expect(s02).toBeLessThan(2.6);
    expect(d0).toBeGreaterThan(20); // true prior df is infinite here
  });
});

describe('normalisation', () => {
  it('size factors undo a known depth scaling', () => {
    const base = [10, 20, 50, 100, 5, 80, 30, 60];
    const csv = 'g,a,b\n' + base.map((v, i) => `g${i},${v},${v * 3}`).join('\n');
    const sf = sizeFactors(parseMatrix(csv));
    expect(sf[1] / sf[0]).toBeCloseTo(3, 8);
  });
  it('rejects malformed matrices with a useful message', () => {
    expect(() => parseMatrix('g,a,b\nx,1,foo')).toThrow(/not a non-negative count/);
    expect(() => parseMatrix('g,a,b\nx,1')).toThrow(/expected 3 columns/);
  });
});

describe('end-to-end on synthetic data', () => {
  const exp = syntheticExperiment(7, 3000, 4);
  const m = parseMatrix(exp.csv);
  const groups = parseGroups(exp.sheet, m.samples);
  it('PCA separates the groups on PC1', () => {
    const l = normalise(m);
    const r = pca(l, 500, 3);
    const a = r.scores.filter((_, i) => groups[i] === 'control').map((s) => s[0]);
    const b = r.scores.filter((_, i) => groups[i] === 'treated').map((s) => s[0]);
    expect(Math.max(...a) < Math.min(...b) || Math.min(...a) > Math.max(...b)).toBe(true);
    expect(r.varExplained[0]).toBeGreaterThan(0.3);
  });
  it('DE recovers planted genes with controlled FDR', () => {
    const res = differential(m, groups, { groupA: 'control', groupB: 'treated', minCpm: 1, minSamples: 4, lfcThreshold: 0, fdr: 0.05 });
    const called = res.rows.filter((r) => r.fdr <= 0.05);
    const tp = called.filter((r) => exp.truth.has(r.gene)).length;
    const fp = called.length - tp;
    expect(tp / 300).toBeGreaterThan(0.6);   // sensitivity
    expect(fp / Math.max(1, called.length)).toBeLessThan(0.1); // empirical FDR near nominal 5%
    const up = res.rows.find((r) => r.gene === 'GENE0001')!;
    expect(Number.isFinite(up.p)).toBe(true);
  });
  it('null comparison gives few discoveries', () => {
    const shuffled = groups.map((_, i) => (i % 2 ? 'treated' : 'control'));
    const res = differential(m, shuffled, { groupA: 'control', groupB: 'treated', minCpm: 1, minSamples: 4, lfcThreshold: 0, fdr: 0.05 });
    expect(res.rows.filter((r) => r.fdr <= 0.05).length).toBeLessThan(40);
  });
  it('clusters rows deterministically', () => {
    const rows = [Float64Array.of(1, 2, 3), Float64Array.of(3, 2, 1), Float64Array.of(1.1, 2.1, 3.2), Float64Array.of(3.1, 2, 0.9)];
    const o = clusterOrder(rows);
    expect([...o].sort()).toEqual([0, 1, 2, 3]);
    expect(Math.abs(o.indexOf(0) - o.indexOf(2))).toBe(1);
  });
});
