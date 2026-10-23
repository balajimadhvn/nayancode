import { describe, expect, it } from 'vitest';
import {
  oneCmtIV,
  oneCmtOral,
  oneCmtInfusion,
  twoCmtIV,
  simulateOde,
  twoCmtOde,
  multipleDose,
  accumulationRatio,
  cssAvg,
  loadingDose,
  multiDoseOneCmtIV,
} from './models';

describe('oneCmtIV', () => {
  it('is D/V at time zero and decays with rate k', () => {
    expect(oneCmtIV({ dose: 100, V: 10, k: 0.1 }, 0)).toBe(10);
    const c1 = oneCmtIV({ dose: 100, V: 10, k: 0.1 }, 1);
    const c2 = oneCmtIV({ dose: 100, V: 10, k: 0.1 }, 2);
    expect(c2 / c1).toBeCloseTo(Math.exp(-0.1), 12);
  });
});

describe('oneCmtOral (Bateman)', () => {
  it('matches the analytic expression for ka > k', () => {
    const p = { dose: 100, F: 1, V: 10, k: 0.1, ka: 1 };
    const expected = (100 * 1) / (10 * (1 - 0.1)) * (Math.exp(-0.1 * 2) - Math.exp(-1 * 2));
    expect(oneCmtOral(p, 2)).toBeCloseTo(expected, 12);
  });

  it('uses the ka = k limit without NaN', () => {
    const k = 0.1, t = 5;
    const c = oneCmtOral({ dose: 100, F: 1, V: 10, k, ka: k }, t);
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeCloseTo((100 / 10) * k * t * Math.exp(-k * t), 12);
  });
});

describe('oneCmtInfusion', () => {
  const p = { rate: 10, T: 5, V: 10, k: 0.1 };

  it('rises during the infusion and decays afterwards', () => {
    expect(oneCmtInfusion(p, 2)).toBeCloseTo(10 * (1 - Math.exp(-0.2)), 12);
    const cT = oneCmtInfusion(p, 5);
    expect(oneCmtInfusion(p, 10)).toBeCloseTo(cT * Math.exp(-0.5), 12);
  });

  it('is continuous at t = T', () => {
    const cAt = oneCmtInfusion(p, 5);
    expect(Math.abs(oneCmtInfusion(p, 5 - 1e-9) - cAt)).toBeLessThan(1e-8);
    expect(Math.abs(oneCmtInfusion(p, 5 + 1e-9) - cAt)).toBeLessThan(1e-8);
  });
});

describe('twoCmtIV', () => {
  const p = { dose: 100, V1: 10, k10: 0.1, k12: 0.5, k21: 0.3 };

  it('is D/V1 at time zero to 1e-12', () => {
    expect(Math.abs(twoCmtIV(p, 0) - 10)).toBeLessThan(1e-12);
  });

  it('RK4 matches the closed form within 1e-6 relative at t = 1, 5 and 20', () => {
    const { t, y } = simulateOde(twoCmtOde(p), [p.dose, 0], 20, 0.001);
    for (const target of [1, 5, 20]) {
      const i = Math.round(target / 0.001);
      expect(Math.abs(t[i] - target)).toBeLessThan(1e-9);
      const cOde = y[i][0] / p.V1;
      expect(Math.abs(cOde - twoCmtIV(p, target)) / twoCmtIV(p, target)).toBeLessThan(1e-6);
    }
  });
});

describe('multipleDose and accumulation', () => {
  it('a single dose equals the single-dose curve', () => {
    const single = (dose: number, t: number) => dose * Math.exp(-0.1 * t);
    expect(multipleDose(single, 1, 12, 1, 5)).toBeCloseTo(single(1, 5), 12);
  });

  it('two doses sum the underlying curves', () => {
    const single = (dose: number, t: number) => dose * Math.exp(-0.1 * t);
    expect(multipleDose(single, 1, 12, 2, 15)).toBeCloseTo(single(1, 15) + single(1, 3), 12);
  });

  it('reaches the steady-state trough ratio R = 1/(1−e^−kτ) within 1e-9 by 60 doses', () => {
    const p = { dose: 100, V: 10, k: 0.1 }, tau = 12, eps = 1e-9;
    // Trough before dose 2 (after one interval) versus the trough before dose 61.
    const first = multiDoseOneCmtIV(p, tau, 1, tau - eps);
    const last = multiDoseOneCmtIV(p, tau, 60, 60 * tau - eps);
    const R = accumulationRatio(p.k, tau);
    expect(Math.abs(last / first - R)).toBeLessThan(1e-9);
    // Five doses already capture 99.6 % of the steady-state accumulation.
    const fifth = multiDoseOneCmtIV(p, tau, 5, 5 * tau - eps);
    expect(fifth / first / R).toBeGreaterThan(0.99);
    expect(fifth / first / R).toBeLessThan(1);
  });

  it('accumulation ratio tends to 1 when k·tau is large', () => {
    expect(accumulationRatio(1, 24)).toBeCloseTo(1, 6);
  });
});

describe('Css,avg and loading dose', () => {
  it('Css,avg = F·D/(CL·tau) and LD = Css·V', () => {
    expect(cssAvg(1, 100, 10, 12)).toBeCloseTo(100 / 120, 12);
    expect(loadingDose(5, 10)).toBe(50);
  });
});
