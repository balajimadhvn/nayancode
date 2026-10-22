import { describe, expect, it } from 'vitest';
import { demoGrowth, fitGrowth, fitGrowthCurve, gompertz, logisticGrowth, modelFreeMu, parseGrowth } from './growth';

const grid = (step: number, end: number) => Array.from({ length: Math.round(end / step) + 1 }, (_, i) => i * step);

describe('growth-curve fitting', () => {
  it('recovers noise-free modified Gompertz parameters to 1e-3', () => {
    const t = grid(0.5, 24), y = t.map((x) => gompertz(2.5, 0.6, 1.5, x));
    const fit = fitGrowthCurve(t, y, 'gompertz');
    expect(Math.abs(fit.A - 2.5)).toBeLessThan(1e-3);
    expect(Math.abs(fit.mu - 0.6)).toBeLessThan(1e-3);
    expect(Math.abs(fit.lambda - 1.5)).toBeLessThan(1e-3);
    expect(fit.doublingTime).toBeCloseTo(Math.LN2 / 0.6, 9);
  });

  it('recovers noise-free logistic parameters to 1e-3', () => {
    const t = grid(0.5, 24), y = t.map((x) => logisticGrowth(2.5, 0.6, 1.5, x));
    const fit = fitGrowthCurve(t, y, 'logistic');
    expect(Math.abs(fit.A - 2.5)).toBeLessThan(1e-3);
    expect(Math.abs(fit.mu - 0.6)).toBeLessThan(1e-3);
    expect(Math.abs(fit.lambda - 1.5)).toBeLessThan(1e-3);
  });

  it('model-free μmax of a pure exponential OD = 0.05·exp(0.4t) is 0.4 to 1e-9', () => {
    const t = grid(0.5, 20), od = t.map((x) => 0.05 * Math.exp(0.4 * x));
    const free = modelFreeMu(t, od, 4);
    expect(Math.abs(free.mu - 0.4)).toBeLessThan(1e-9);
    expect(free.window).toHaveLength(2);
    expect(free.doublingTime).toBeCloseTo(Math.LN2 / 0.4, 9);
  });

  it('a flat line gives μ ≈ 0 and the "no growth detected" warning', () => {
    const t = grid(0.5, 24), y = t.map(() => 0);
    const fit = fitGrowthCurve(t, y, 'gompertz');
    expect(fit.mu).toBe(0);
    expect(fit.warning).toMatch(/no growth detected/);
  });

  it('refuses too few points', () => {
    expect(() => fitGrowthCurve([0, 1], [0, 1], 'gompertz')).toThrow(/at least 5/);
    expect(() => fitGrowth([0, 1], [0.1, 0.2])).toThrow(/at least 5/);
  });
});

describe('fitGrowth on raw OD', () => {
  it('picks the planted model by AIC', () => {
    const t = grid(0.5, 24);
    const g = fitGrowth(t, t.map((x) => 0.05 * Math.exp(gompertz(2.5, 0.6, 1.5, x))));
    expect(g.best).toBe('gompertz');
    const l = fitGrowth(t, t.map((x) => 0.05 * Math.exp(logisticGrowth(2.1, 0.35, 3, x))));
    expect(l.best).toBe('logistic');
    expect(l.gompertz.aic).toBeGreaterThan(l.logistic.aic);
  });

  it('uses the supplied OD0 and ignores non-positive readings', () => {
    const t = grid(0.5, 24);
    const od = t.map((x) => 0.05 * Math.exp(gompertz(2.5, 0.6, 1.5, x)));
    od[0] = 0;
    const fit = fitGrowth(t, od, 0.05);
    expect(fit.gompertz.mu).toBeGreaterThan(0.4);
    expect(fit.free.mu).toBeGreaterThan(0.3);
  });
});

describe('parsing', () => {
  it('reads time plus one column per strain and skips bad rows', () => {
    const p = parseGrowth('time,WT,mut\ntime,WT,mut\n0,0.05,0.05\n1,0.08,0.07\n2,0.12,0.09');
    const good = parseGrowth('time,WT,mut\n0,0.05,0.05\n1,0.08,0.07\nx,1,1');
    expect(good.t).toEqual([0, 1]);
    expect(good.series.map((s) => s.name)).toEqual(['WT', 'mut']);
    expect(good.series[1].od).toEqual([0.05, 0.07]);
    expect(good.skipped).toBe(1);
    void p;
  });

  it('rejects a header-only file', () => {
    expect(() => parseGrowth('time,WT')).toThrow(/at least one data row/);
  });

  it('the demo data parses and fits two strains', () => {
    const d = demoGrowth(), p = parseGrowth(d);
    expect(p.series).toHaveLength(2);
    expect(p.t.length).toBeGreaterThan(40);
    for (const s of p.series) expect(fitGrowth(p.t, s.od).gompertz.mu).toBeGreaterThan(0);
  });
});
