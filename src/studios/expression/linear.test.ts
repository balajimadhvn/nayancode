import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CountMatrix } from './kernels';
import { buildDesign, contrastTest, factorContrasts, fitDesign, fTest, levelContrast, lmFit, lowess, moderate, tmmFactors, voom } from './linear';

// Reference values were produced by edgeR + limma (benchmarks/limma/make-fixture.R).
const fx = JSON.parse(readFileSync(new URL('../../../benchmarks/limma/fixture.json', import.meta.url), 'utf8'));

function subset(counts: number[][], genes: string[], kept: string[]): CountMatrix {
  const S = counts[0].length, idx = kept.map((g) => genes.indexOf(g));
  const out = new Float64Array(idx.length * S);
  idx.forEach((gi, k) => { for (let j = 0; j < S; j++) out[k * S + j] = counts[gi][j]; });
  return { genes: kept, samples: Array.from({ length: S }, (_, j) => `s${j + 1}`), counts: out };
}
const corr = (a: number[], b: number[]) => { const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
const maxAbs = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
const sigSet = (fdr: number[], cut = 0.05) => new Set(fdr.map((q, i) => (q <= cut ? i : -1)).filter((i) => i >= 0));
const jaccard = (a: Set<number>, b: Set<number>) => { if (!a.size && !b.size) return 1; const inter = [...a].filter((x) => b.has(x)).length; return inter / (a.size + b.size - inter); };

describe('linear models agree with edgeR + limma', () => {
  const T = fx.three;
  const m = subset(T.counts, T.genes, T.kept);
  const design = buildDesign([{ name: 'group', kind: 'factor', values: T.group, reference: 'ctrl' }, { name: 'batch', kind: 'factor', values: T.batch }], 12);
  const nf = tmmFactors(m);
  const v = voom(m, design, nf);
  const fit = lmFit(v.y, v.w, m.genes, design);
  const eb = moderate(fit);

  it('TMM normalisation factors match calcNormFactors', () => {
    expect(maxAbs(nf, T.normFactors)).toBeLessThan(1e-6);
  });
  it('voom weights match', () => {
    const w0 = Array.from(v.w.subarray(0, 12));
    expect(maxAbs(w0, T.voomWeightsFirst)).toBeLessThan(1e-6 * Math.max(...T.voomWeightsFirst));
    const mean = v.w.reduce((a, b) => a + b, 0) / v.w.length;
    expect(Math.abs(mean - T.voomWeightsMean) / T.voomWeightsMean).toBeLessThan(1e-8);
  });
  it('empirical-Bayes prior matches eBayes', () => {
    expect(Math.abs(eb.d0 - T.df0) / T.df0).toBeLessThan(1e-6);
    expect(Math.abs(eb.s02 - T.s02) / T.s02).toBeLessThan(1e-6);
  });
  it('coefficient tests (drugA vs control, drugB vs control) match topTable', () => {
    for (const [coef, ref] of [['groupdrugA', T.drugA], ['groupdrugB', T.drugB]] as const) {
      const c = design.columns.map((x) => (x === coef ? 1 : 0));
      const r = contrastTest(fit, eb, c);
      expect(maxAbs(r.map((x) => x.logFC), ref.logFC)).toBeLessThan(1e-6);
      expect(corr(r.map((x) => x.t), ref.t)).toBeGreaterThan(0.9999);
      expect(maxAbs(r.map((x) => x.t), ref.t)).toBeLessThan(1e-6);
      expect(maxAbs(r.map((x) => x.p), ref.p)).toBeLessThan(1e-8);
      expect(jaccard(sigSet(r.map((x) => x.fdr)), sigSet(ref.fdr))).toBe(1);
    }
  });
  it('a contrast between two non-reference groups (drugB − drugA) matches contrasts.fit', () => {
    const r = contrastTest(fit, eb, levelContrast(design, 'group', 'drugA', 'drugB'));
    expect(maxAbs(r.map((x) => x.logFC), T.BvsA.logFC)).toBeLessThan(1e-6);
    expect(maxAbs(r.map((x) => x.t), T.BvsA.t)).toBeLessThan(1e-6);
  });
  it('the moderated F-test for any group difference matches topTable(coef = 2:3)', () => {
    const f = fTest(fit, eb, factorContrasts(design, 'group'));
    expect(maxAbs(f.map((x) => x.F), T.F.F)).toBeLessThan(1e-6 * Math.max(...T.F.F));
    expect(jaccard(sigSet(f.map((x) => x.fdr)), sigSet(T.F.fdr))).toBe(1);
  });
  it('unweighted fit on the same log-CPM matches lmFit without weights', () => {
    const f0 = lmFit(v.y, null, m.genes, design), e0 = moderate(f0);
    const r = contrastTest(f0, e0, design.columns.map((x) => (x === 'groupdrugA' ? 1 : 0)));
    expect(maxAbs(r.map((x) => x.logFC), T.noVoom.logFC)).toBeLessThan(1e-6);
    expect(maxAbs(r.map((x) => x.t), T.noVoom.t)).toBeLessThan(1e-3);
  });
});

describe('paired designs', () => {
  const P = fx.paired;
  it('a subject-blocked before/after design matches limma', () => {
    const m = subset(P.counts, fx.three.genes, P.kept);
    const design = buildDesign([{ name: 'subject', kind: 'factor', values: P.subject }, { name: 'time', kind: 'factor', values: P.time, reference: 'before' }], 12);
    const nf = tmmFactors(m);
    expect(maxAbs(nf, P.normFactors)).toBeLessThan(1e-6);
    const v = voom(m, design, nf), fit = lmFit(v.y, v.w, m.genes, design), eb = moderate(fit);
    const r = contrastTest(fit, eb, design.columns.map((x) => (x === 'timeafter' ? 1 : 0)));
    expect(maxAbs(r.map((x) => x.logFC), P.after.logFC)).toBeLessThan(1e-6);
    expect(maxAbs(r.map((x) => x.t), P.after.t)).toBeLessThan(1e-6);
    expect(jaccard(sigSet(r.map((x) => x.fdr)), sigSet(P.after.fdr))).toBe(1);
  });
});

describe('design building', () => {
  it('rejects confounded designs and designs without residual degrees of freedom', () => {
    const g = ['a', 'a', 'b', 'b'];
    expect(() => buildDesign([{ name: 'g', kind: 'factor', values: g }, { name: 'h', kind: 'factor', values: g }], 4)).toThrow(/full rank/);
    expect(() => buildDesign([{ name: 'g', kind: 'factor', values: ['a', 'b', 'c', 'd'] }], 4)).toThrow(/no residual/);
  });
  it('centres numeric covariates and codes factors against the reference level', () => {
    const d = buildDesign([{ name: 'dose', kind: 'numeric', values: ['0', '1', '2', '3'] }, { name: 'g', kind: 'factor', values: ['x', 'y', 'x', 'y'], reference: 'y' }], 4);
    expect(d.columns).toEqual(['(Intercept)', 'dose', 'gx']);
    expect(d.X.map((r) => r[1])).toEqual([-1.5, -0.5, 0.5, 1.5]);
  });
  it('fitDesign runs end to end and reports filtered genes', () => {
    const T = fx.three, m = subset(T.counts, T.genes, T.genes);
    const r = fitDesign(m, { terms: [{ name: 'group', kind: 'factor', values: T.group, reference: 'ctrl' }], minCpm: 1, minSamples: 3, useVoom: true, fdr: 0.05, lfc: 0 });
    expect(r.kept + r.filtered).toBe(T.genes.length);
    expect(r.fit.columns).toEqual(['(Intercept)', 'groupdrugA', 'groupdrugB']);
  });
});

describe('lowess', () => {
  it('reproduces a straight line exactly and matches R lowess() with an outlier', () => {
    const x = Array.from({ length: 50 }, (_, i) => i), y = x.map((v) => 2 * v + 1);
    expect(maxAbs(lowess(x, y, 0.5), y)).toBeLessThan(1e-8);
    const yo = [...y]; yo[25] = 500;
    const l = lowess(x, yo, 0.5);
    // R 4.4: lowess(0:49, y, f = 0.5)$y at positions 1, 20, 26, 30, 50
    expect(maxAbs([0, 19, 25, 29, 49].map((i) => l[i]), [1, 60.66183, 83.33486, 87.87352, 99])).toBeLessThan(1e-4);
  });
});
