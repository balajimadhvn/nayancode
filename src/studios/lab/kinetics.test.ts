import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalyticEfficiency, demoInhibition, fitInhibition, fitKinetics, inhibitionRate, kcat, linearisations, parseKinetics, type InhibitionModel } from './kinetics';

const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/lab/kinetics-reference.json', import.meta.url), 'utf8')) as {
  S: number[]; v: number[]; Vmax: number; Km: number; VmaxSE: number; KmSE: number;
};

describe('fitKinetics', () => {
  it('recovers noise-free Michaelis–Menten parameters to 1e-6', () => {
    const S = [0.5, 1, 2, 5, 10, 20, 50], v = S.map((s) => (100 * s) / (5 + s));
    const fit = fitKinetics(S, v, 'mm');
    expect(fit.vmax).toBeCloseTo(100, 6);
    expect(fit.km).toBeCloseTo(5, 6);
    expect(Math.abs(fit.vmax - 100)).toBeLessThan(1e-6);
    expect(Math.abs(fit.km - 5)).toBeLessThan(1e-6);
    expect(fit.r2).toBeGreaterThan(1 - 1e-9);
  });

  it('matches scipy curve_fit on a 5 % noise data set (parameters and SEs)', () => {
    const fit = fitKinetics(ref.S, ref.v, 'mm');
    expect(Math.abs(fit.vmax - ref.Vmax) / ref.Vmax).toBeLessThan(1e-4);
    expect(Math.abs(fit.km - ref.Km) / ref.Km).toBeLessThan(1e-4);
    const seV = fit.params.find((p) => p.name === 'Vmax')!.se, seK = fit.params.find((p) => p.name === 'Km')!.se;
    expect(Math.abs(seV - ref.VmaxSE) / ref.VmaxSE).toBeLessThan(1e-3);
    expect(Math.abs(seK - ref.KmSE) / ref.KmSE).toBeLessThan(1e-3);
  });

  it('recovers the Hill coefficient n = 2.5 to 1e-5', () => {
    const S = [0.2, 0.5, 1, 2, 5, 10, 20, 50], v = S.map((s) => (100 * s ** 2.5) / (5 ** 2.5 + s ** 2.5));
    const fit = fitKinetics(S, v, 'hill');
    expect(Math.abs(fit.params.find((p) => p.name === 'n')!.value - 2.5)).toBeLessThan(1e-5);
    expect(Math.abs(fit.vmax - 100)).toBeLessThan(1e-5);
  });

  it('recovers substrate inhibition parameters from noise-free data', () => {
    const S = [0.5, 1, 2, 4, 8, 16, 32, 64], v = S.map((s) => (90 * s) / (3 + s * (1 + s / 40)));
    const fit = fitKinetics(S, v, 'substrate');
    expect(Math.abs(fit.params.find((p) => p.name === 'Ksi')!.value - 40)).toBeLessThan(1e-3);
  });

  it('rejects input shorter than the model needs', () => {
    expect(() => fitKinetics([1, 2], [1, 2], 'mm')).toThrow(/at least/);
    expect(() => fitKinetics([1, 2, 3], [1], 'mm')).toThrow(/same length/);
  });
});

describe('fitInhibition', () => {
  const rows: { S: number; I: number; v: number }[] = [];
  for (const I of [0, 1, 3]) for (const S of [0.5, 1, 2, 4, 8, 16, 32]) rows.push({ S, I, v: (80 * S) / (4 * (1 + I / 2) + S) });

  it('recovers Ki = 2 from a global competitive fit to 1e-5', () => {
    const fit = fitInhibition(rows, 'competitive');
    expect(Math.abs(fit.ki - 2)).toBeLessThan(1e-5);
    expect(Math.abs(fit.vmax - 80)).toBeLessThan(1e-5);
    expect(Math.abs(fit.km - 4)).toBeLessThan(1e-5);
  });

  it('AIC prefers competitive inhibition over uncompetitive for competitive data', () => {
    const models: InhibitionModel[] = ['competitive', 'noncompetitive', 'uncompetitive', 'mixed'];
    const fits = models.map((m) => fitInhibition(rows, m));
    const best = fits.reduce((a, b) => (b.aic < a.aic ? b : a));
    expect(best.model).toBe('competitive');
    expect(fitInhibition(rows, 'competitive').aic).toBeLessThan(fitInhibition(rows, 'uncompetitive').aic);
  });

  it('mixed inhibition recovers α, and the rate functions agree with the formulas', () => {
    const mixed = [] as { S: number; I: number; v: number }[];
    for (const I of [0, 0.5]) for (const S of [1, 2, 4, 8, 16]) mixed.push({ S, I, v: inhibitionRate('mixed', [60, 3, 2, 4], S, I) });
    const fit = fitInhibition(mixed, 'mixed');
    expect(Math.abs(fit.ki - 2)).toBeLessThan(1e-4);
    expect(Math.abs(fit.params.find((p) => p.name === 'alpha')!.value - 4)).toBeLessThan(1e-4);
  });

  it('the global fit recovers the parameters planted in the demo data', () => {
    const { rows: demo } = parseKinetics(demoInhibition());
    const fit = fitInhibition(demo, 'competitive');
    expect(fit.ki).toBeCloseTo(2, 9);
    expect(fit.vmax).toBeCloseTo(80, 9);
  });
});

describe('linearisations and helpers', () => {
  it('Lineweaver–Burk, Eadie–Hofstee and Hanes–Woolf recover Vmax and Km from clean data', () => {
    const S = [1, 2, 4, 8, 16], v = S.map((s) => (10 * s) / (2 + s));
    for (const l of linearisations(S, v)) {
      expect(l.r2).toBeCloseTo(1, 9);
      expect(l.vmax).toBeCloseTo(10, 6);
      expect(l.km).toBeCloseTo(2, 6);
    }
  });

  it('kcat and catalytic efficiency use the enzyme concentration', () => {
    expect(kcat(100, 2)).toBe(50);
    expect(catalyticEfficiency(100, 5, 2)).toBe(10);
    expect(Number.isNaN(kcat(100, 0))).toBe(true);
  });

  it('parses two- and three-column data and skips bad rows', () => {
    const a = parseKinetics('S,v\n1,2\n2,4\nx,9');
    expect(a.rows).toHaveLength(2);
    expect(a.hasInhibitor).toBe(false);
    expect(a.skipped).toBe(1);
    const b = parseKinetics('S\tI\tv\n1\t0\t5\n1\t2\t3');
    expect(b.hasInhibitor).toBe(true);
    expect(b.rows[1]).toEqual({ S: 1, I: 2, v: 3 });
    expect(() => parseKinetics('')).toThrow(/No data/);
    expect(() => parseKinetics('S,v\nfoo,bar')).toThrow(/No numeric/);
  });
});
