import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg, bonferroni, chiSquare, cohensD, fisherExact, holm, kruskalWallis, leveneMedian,
  linearRegression, mannWhitney, oddsRatio2x2, oneSampleT, oneWayAnova, pairedT, pearson, ranks, spearman,
  studentT, welchT, wilcoxonSignedRank,
} from './tests';

interface Ref {
  a: number[]; b: number[]; paired1: number[]; paired2: number[]; g1: number[]; g2: number[]; g3: number[];
  x: number[]; y: number[]; table3: number[][]; table2: number[][]; pvalues: number[];
  welch: { t: number; df: number; p: number }; student: { t: number; df: number; p: number };
  paired: { t: number; df: number; p: number }; oneSample: { t: number; df: number; p: number };
  anova: { F: number; df1: number; df2: number; p: number }; levene: { W: number; p: number };
  mannWhitney: { U: number; p: number }; wilcoxon: { W: number; p: number }; kruskal: { H: number; p: number };
  chi3: { chi2: number; df: number; p: number }; chi2_yates: { chi2: number; df: number; p: number }; chi2_pearson: { chi2: number; df: number; p: number };
  fisher: { or: number; p: number }; fisher31: { or: number; p: number };
  pearson: { r: number; p: number }; spearman: { rho: number; p: number };
  linreg: { slope: number; intercept: number; se_slope: number; r2: number; t: number; p: number; se_intercept: number };
  bonferroni: number[]; holm: number[]; bh: number[];
}
const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/stats/reference.json', import.meta.url), 'utf8')) as Ref;

const near = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b) / Math.max(Math.abs(b), 1e-12)).toBeLessThan(rel);

describe('two-sample and paired t-tests (scipy.ttest_*)', () => {
  it('Welch', () => { const r = welchT(ref.a, ref.b); near(r.t, ref.welch.t); near(r.df, ref.welch.df, 1e-9); near(r.p, ref.welch.p, 1e-5); });
  it('Student', () => { const r = studentT(ref.a, ref.b); near(r.t, ref.student.t); near(r.p, ref.student.p, 1e-5); });
  it('paired', () => { const r = pairedT(ref.paired1, ref.paired2); near(r.t, ref.paired.t); near(r.p, ref.paired.p, 1e-5); });
  it('one-sample', () => { const r = oneSampleT(ref.a, 10); near(r.t, ref.oneSample.t); near(r.p, ref.oneSample.p, 1e-5); });
  it('the CI contains the difference', () => {
    const r = welchT(ref.a, ref.b);
    expect(r.ci95[0]).toBeLessThan(r.meanDiff);
    expect(r.ci95[1]).toBeGreaterThan(r.meanDiff);
  });
});

describe('ANOVA and variance tests', () => {
  it('one-way ANOVA', () => {
    const r = oneWayAnova([ref.g1, ref.g2, ref.g3]);
    near(r.F, ref.anova.F); expect(r.df1).toBe(2); expect(r.df2).toBe(24); near(r.p, ref.anova.p, 1e-5);
    expect(r.etaSquared).toBeGreaterThan(0); expect(r.etaSquared).toBeLessThan(1);
  });
  it('Brown–Forsythe / Levene on group medians', () => {
    const r = leveneMedian([ref.g1, ref.g2, ref.g3]);
    near(r.W, ref.levene.W); near(r.p, ref.levene.p, 1e-5);
  });
});

describe('rank tests', () => {
  it('Mann–Whitney U with tie and continuity correction', () => {
    const r = mannWhitney(ref.a, ref.b);
    expect(r.U).toBe(ref.mannWhitney.U); near(r.p, ref.mannWhitney.p, 1e-5);
  });
  it('Mann–Whitney of two identical samples gives p = 1', () => {
    const r = mannWhitney([1, 2, 3, 4], [1, 2, 3, 4]);
    expect(r.p).toBeCloseTo(1, 9);
  });
  it('Wilcoxon signed rank', () => {
    const r = wilcoxonSignedRank(ref.paired1, ref.paired2);
    expect(r.W).toBe(ref.wilcoxon.W); near(r.p, ref.wilcoxon.p, 1e-5);
  });
  it('Kruskal–Wallis with the tie correction', () => {
    const r = kruskalWallis([ref.g1, ref.g2, ref.g3]);
    near(r.H, ref.kruskal.H, 1e-9); near(r.p, ref.kruskal.p, 1e-5);
  });
  it('average ranks share ties', () => {
    expect(ranks([3, 1, 1, 2])).toEqual([4, 1.5, 1.5, 3]);
  });
});

describe('contingency tables', () => {
  it('Pearson χ² for a 2×3 table', () => {
    const r = chiSquare(ref.table3);
    near(r.chi2, ref.chi3.chi2, 1e-9); expect(r.df).toBe(2); near(r.p, ref.chi3.p, 1e-5);
  });
  it('2×2 with and without Yates', () => {
    near(chiSquare(ref.table2, { yates: true }).chi2, ref.chi2_yates.chi2, 1e-9);
    near(chiSquare(ref.table2).chi2, ref.chi2_pearson.chi2, 1e-9);
    expect(chiSquare(ref.table2).yates!.chi2).toBeCloseTo(ref.chi2_yates.chi2, 9);
  });
  it('Fisher exact two-sided', () => {
    near(fisherExact(ref.table2[0][0], ref.table2[0][1], ref.table2[1][0], ref.table2[1][1]).p, ref.fisher.p, 1e-9);
    expect(fisherExact(3, 1, 1, 3).p).toBeCloseTo(0.4857142857142857, 12);
    expect(fisherExact(3, 1, 1, 3).oddsRatio).toBeCloseTo(9, 12);
  });
  it('odds ratio with a log-scale Wald CI', () => {
    const r = oddsRatio2x2(7, 3, 2, 9);
    expect(r.or).toBeCloseTo(10.5, 12);
    expect(r.lo).toBeLessThan(r.or); expect(r.hi).toBeGreaterThan(r.or);
  });
  it('rejects a malformed table', () => {
    expect(() => chiSquare([[1, 2], [3]])).toThrow(/same number/);
    expect(() => chiSquare([[1], [2]])).toThrow(/2 columns/);
  });
});

describe('correlation and regression', () => {
  it('Pearson r and p', () => { const r = pearson(ref.x, ref.y); near(r.r, ref.pearson.r, 1e-9); near(r.p, ref.pearson.p, 1e-5); });
  it('Spearman rho with average ranks', () => { const r = spearman(ref.x, ref.y); near(r.rho, ref.spearman.rho, 1e-9); near(r.p, ref.spearman.p, 1e-5); });
  it('linear regression matches scipy.linregress', () => {
    const r = linearRegression(ref.x, ref.y);
    near(r.slope, ref.linreg.slope); near(r.intercept, ref.linreg.intercept);
    near(r.seSlope, ref.linreg.se_slope); near(r.seIntercept, ref.linreg.se_intercept);
    near(r.r2, ref.linreg.r2, 1e-9); near(r.t, ref.linreg.t); near(r.p, ref.linreg.p, 1e-5);
  });
  it('Cohen’s d is the standardised mean difference', () => {
    expect(cohensD([10, 11, 12], [10, 11, 12])).toBe(0);
    expect(cohensD([5, 5, 5], [1, 1, 1])).toBeGreaterThan(1);
  });
});

describe('multiple testing', () => {
  it('Bonferroni, Holm and Benjamini–Hochberg match the hand-written reference', () => {
    expect(bonferroni(ref.pvalues).map((v) => +v.toFixed(12))).toEqual(ref.bonferroni.map((v) => +v.toFixed(12)));
    expect(holm(ref.pvalues).map((v) => +v.toFixed(12))).toEqual(ref.holm.map((v) => +v.toFixed(12)));
    expect(benjaminiHochberg(ref.pvalues).map((v) => +v.toFixed(12))).toEqual(ref.bh.map((v) => +v.toFixed(12)));
  });
  it('BH-adjusted p-values are monotone in the sorted order and never exceed 1', () => {
    const p = [0.5, 0.001, 0.2, 0.04], adj = benjaminiHochberg(p);
    expect(Math.max(...adj)).toBeLessThanOrEqual(1);
    const s = p.map((v, i) => ({ v, a: adj[i] })).sort((x, y) => x.v - y.v);
    for (let i = 1; i < s.length; i++) expect(s[i].a).toBeGreaterThanOrEqual(s[i - 1].a);
  });
});
