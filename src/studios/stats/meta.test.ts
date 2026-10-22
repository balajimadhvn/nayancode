import { describe, expect, it } from 'vitest';
import { BCG, eggerTest, hedgesG, leaveOneOut, logOddsRatio, logRiskRatio, metaAnalysis, riskDifference, subgroups } from './meta';

const eff = BCG.map((s) => logRiskRatio(s.a, s.b, s.c, s.d));
const yi = eff.map((e) => e.yi), vi = eff.map((e) => e.vi);

describe('effect sizes', () => {
  it('reproduces the published BCG log risk ratios (4 decimals)', () => {
    const expected = [-0.8893, -1.5854, -1.3481, -1.4416, -0.2175, -0.7861, -1.6209, 0.0120, -0.4694, -1.3713, -0.3394, 0.4459, -0.0173];
    yi.forEach((y, i) => expect(y).toBeCloseTo(expected[i], 4));
  });

  it('log odds ratio adds 0.5 to a zero cell and flags it', () => {
    const e = logOddsRatio(0, 10, 5, 5);
    expect(e.corrected).toBe(true);
    expect(e.yi).toBeCloseTo(Math.log((0.5 * 5.5) / (10.5 * 5.5)), 12);
    expect(logOddsRatio(7, 3, 2, 9).corrected).toBe(false);
  });

  it('risk difference and Hedges g follow their formulas', () => {
    const rd = riskDifference(10, 90, 20, 80);
    expect(rd.yi).toBeCloseTo(0.1 - 0.2, 12);
    expect(rd.vi).toBeCloseTo((0.1 * 0.9) / 100 + (0.2 * 0.8) / 100, 12);
    const g = hedgesG(10, 2, 20, 8, 2, 20);
    const J = 1 - 3 / (4 * 38 - 1);
    expect(g.yi).toBeCloseTo((2 / 2) * J, 12);
    expect(g.vi).toBeCloseTo(40 / 400 + (g.yi * g.yi) / 80, 12);
  });
});

describe('metaAnalysis: BCG vaccine (metafor)', () => {
  it('fixed effect: estimate −0.43028516 and se 0.04049875', () => {
    const r = metaAnalysis(yi, vi, 'FE');
    expect(r.estimate).toBeCloseTo(-0.43028516, 6);
    expect(r.se).toBeCloseTo(0.04049875, 6);
    expect(r.Q).toBeCloseTo(152.233008, 6);
    expect(r.Qdf).toBe(12);
    expect(r.I2).toBeCloseTo(92.1173, 4);
    expect(r.H2).toBeCloseTo(r.Q / 12, 9);
  });

  it('DerSimonian–Laird: τ² 0.30876026, estimate −0.71411722, se 0.17874209', () => {
    const r = metaAnalysis(yi, vi, 'DL');
    expect(r.tau2).toBeCloseTo(0.30876026, 6);
    expect(r.estimate).toBeCloseTo(-0.71411722, 6);
    expect(r.se).toBeCloseTo(0.17874209, 6);
    expect(r.p).toBeLessThan(0.001);
  });

  it('REML: τ² 0.31324326, estimate −0.71453234, se 0.17978152 and the prediction interval', () => {
    const r = metaAnalysis(yi, vi, 'REML');
    expect(r.tau2).toBeCloseTo(0.31324326, 6);
    expect(r.estimate).toBeCloseTo(-0.71453234, 6);
    expect(r.se).toBeCloseTo(0.17978152, 6);
    expect(r.predictionInterval).not.toBeNull();
    expect(r.predictionInterval![0]).toBeCloseTo(-2.00838, 4);
    expect(r.predictionInterval![1]).toBeCloseTo(0.57931, 4);
  });

  it('Paule–Mandel gives τ² 0.31807', () => {
    const r = metaAnalysis(yi, vi, 'PM');
    expect(r.tau2).toBeCloseTo(0.3180685, 5);
  });

  it('Egger intercept −2.1120421, p 0.1887070 on 11 df', () => {
    const e = eggerTest(yi, vi);
    expect(e.intercept).toBeCloseTo(-2.1120421, 6);
    expect(e.p).toBeCloseTo(0.1887070, 4);
    expect(e.df).toBe(11);
  });

  it('all-equal effects give τ² = 0 and I² = 0', () => {
    const r = metaAnalysis([0.5, 0.5, 0.5], [0.1, 0.2, 0.3], 'DL');
    expect(r.tau2).toBe(0);
    expect(r.I2).toBe(0);
    expect(r.estimate).toBeCloseTo(0.5, 12);
  });

  it('a single study throws', () => {
    expect(() => metaAnalysis([0.1], [0.2], 'DL')).toThrow(/at least 2/);
  });
});

describe('influence and subgroups', () => {
  it('leave-one-out returns one estimate per study and never drops more', () => {
    const loo = leaveOneOut(yi, vi, 'DL');
    expect(loo).toHaveLength(13);
    for (const l of loo) expect(Number.isFinite(l.estimate)).toBe(true);
    const withoutLargest = loo.find((l) => l.omitted === 7)!;
    expect(Math.abs(withoutLargest.estimate - metaAnalysis(yi, vi, 'DL').estimate)).toBeGreaterThan(1e-6);
  });

  it('subgroups split by an arbitrary label and test the difference', () => {
    const labels = BCG.map((_, i) => (i < 6 ? 'early' : 'late'));
    const s = subgroups(yi, vi, labels, 'DL');
    expect(s.groups).toHaveLength(2);
    expect(s.df).toBe(1);
    expect(s.groups.reduce((a, g) => a + g.k, 0)).toBe(13);
    expect(s.p).toBeGreaterThanOrEqual(0);
    expect(s.p).toBeLessThanOrEqual(1);
  });
});
