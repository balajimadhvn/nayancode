import { describe, expect, it } from 'vitest';
import { nca, parseProfiles, summarise, terminalPhase } from './nca';

const IV_TIMES = [0, 0.25, 0.5, 1, 2, 4, 6, 8, 12, 16, 24, 36, 48];
const iv = (D = 100, V = 10, k = 0.1) => IV_TIMES.map((t) => (D / V) * Math.exp(-k * t));

const ORAL_TIMES = [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 8, 12, 16, 24, 36, 48];
const oral = (D = 100, F = 1, V = 10, k = 0.1, ka = 1) =>
  ORAL_TIMES.map((t) => (D * F * ka) / (V * (ka - k)) * (Math.exp(-k * t) - Math.exp(-ka * t)));

describe('NCA: IV bolus, one compartment (analytic truth)', () => {
  const r = nca(IV_TIMES, iv(), { dose: 100, route: 'iv' });

  it('recovers λz = k to 1e-9 and t½ = ln 2 / k', () => {
    expect(r.lambdaZ).not.toBeNull();
    expect(Math.abs(r.lambdaZ! - 0.1)).toBeLessThan(1e-9);
    expect(Math.abs(r.halfLife! - 6.931471806)).toBeLessThan(1e-6);
  });

  it('recovers AUCinf = D/(V·k), CL and Vz within 0.3 %', () => {
    expect(Math.abs(r.aucInf! - 100) / 100).toBeLessThan(0.003);
    expect(Math.abs(r.cl! - 1)).toBeLessThan(0.003);
    expect(Math.abs(r.vz! - 10) / 10).toBeLessThan(0.003);
  });

  it('recovers MRTinf = 1/k within 0.5 %', () => {
    expect(Math.abs(r.mrt! - 10) / 10).toBeLessThan(0.005);
  });

  it('reports Cmax at t = 0 and the last sample', () => {
    expect(r.cmax).toBeCloseTo(10, 12);
    expect(r.tmax).toBe(0);
    expect(r.tlast).toBe(48);
    expect(r.clast).toBeCloseTo(10 * Math.exp(-4.8), 12);
  });

  it('prefers the longest terminal window when adjusted R² is equivalent', () => {
    expect(r.nPointsLambda).toBe(IV_TIMES.length - 1);
    expect(r.r2adj!).toBeGreaterThan(0.999999);
  });
});

describe('NCA: extravascular Bateman profile', () => {
  const r = nca(ORAL_TIMES, oral(), { dose: 100, route: 'extravascular' });

  it('finds tmax at the sample closest to ln(ka/k)/(ka − k)', () => {
    const ideal = Math.log(10) / 0.9;
    const closest = ORAL_TIMES.reduce((a, b) => (Math.abs(b - ideal) < Math.abs(a - ideal) ? b : a));
    expect(r.tmax).toBe(closest);
  });

  it('fits the terminal phase and reproduces AUCinf within 0.5 %', () => {
    expect(r.lambdaZ!).toBeCloseTo(0.1, 3);
    expect(Math.abs(r.aucInf! - 100) / 100).toBeLessThan(0.005);
  });
});

describe('NCA: rules and edge cases', () => {
  it('throws for fewer than three positive concentrations', () => {
    expect(() => nca([0, 1, 2], [0, 3, 0], { dose: 10, route: 'iv' })).toThrow(/three positive/);
  });

  it('returns null λz and no AUCinf when the terminal slope is not negative', () => {
    const r = nca([0, 1, 2, 4, 6], [1, 2, 3, 4, 5], { dose: 10, route: 'iv' });
    expect(r.lambdaZ).toBeNull();
    expect(r.aucInf).toBeNull();
    expect(r.cl).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/terminal phase/i);
  });

  it('drops missing values and repeated times', () => {
    const times = [...IV_TIMES, 48, 60];
    const conc = [...iv(), NaN, NaN];
    const r = nca(times, conc, { dose: 100, route: 'iv' });
    expect(r.tlast).toBe(48);
    expect(r.lambdaZ!).toBeCloseTo(0.1, 9);
  });

  it('treats concentrations below the LOQ as zero when asked', () => {
    const times = [0, 1, 2, 4, 6, 8];
    const conc = [10, 8, 6, 4, 0.01, 0.005];
    const r = nca(times, conc, { dose: 100, route: 'iv', loq: 0.1, blqAsZero: true });
    expect(r.clast).toBe(0);
  });

  it('linear-up/log-down differs from pure linear integration on a decaying curve', () => {
    const logDown = nca(IV_TIMES, iv(), { dose: 100, route: 'iv' });
    const linear = nca(IV_TIMES, iv(), { dose: 100, route: 'iv', trapezoid: 'linear' });
    expect(linear.aucLast).toBeGreaterThan(logDown.aucLast);
    // Exact integral of 10·e^(−0.1t) over 0…48.
    expect(logDown.aucLast).toBeCloseTo(100 * (1 - Math.exp(-4.8)), 6);
  });

  it('honours a fixed number of terminal points', () => {
    const r = nca(IV_TIMES, iv(), { dose: 100, route: 'iv', lambdaPoints: 4 });
    expect(r.nPointsLambda).toBe(4);
    expect(r.lambdaZ!).toBeCloseTo(0.1, 9);
  });

  it('warns when more than 20 % of AUCinf is extrapolated', () => {
    const r = nca([0, 0.5, 1, 2, 3], [10, 9.5, 9, 8, 7.4], { dose: 100, route: 'iv' });
    expect(r.aucExtrapPct!).toBeGreaterThan(20);
    expect(r.warnings.some((w) => /extrapolated by/.test(w))).toBe(true);
  });

  it('reports the terminal window used for plotting', () => {
    const tp = terminalPhase(IV_TIMES, iv(), { dose: 100, route: 'iv' });
    expect(tp).not.toBeNull();
    expect(tp!.n).toBe(IV_TIMES.length - 1);
    expect(tp!.from).toBe(0.25);
  });
});

describe('NCA: table parsing and summaries', () => {
  it('reads time, conc with a subject column', () => {
    const p = parseProfiles('subject,time,conc\nA,0,0\nA,1,5\nB,0,0\nB,1,7\n');
    expect(p.map((x) => x.name)).toEqual(['A', 'B']);
    expect(p[1].conc).toEqual([0, 7]);
  });

  it('reads several concentration columns as subjects', () => {
    const p = parseProfiles('time,subject 1,subject 2\n0,0,0\n1,4,6\n');
    expect(p.map((x) => x.name)).toEqual(['subject 1', 'subject 2']);
    expect(p[0].conc).toEqual([0, 4]);
    expect(p[1].conc).toEqual([0, 6]);
  });

  it('reads a headerless two-column table', () => {
    const p = parseProfiles('0,0\n1,5\n2,8\n');
    expect(p).toHaveLength(1);
    expect(p[0].time).toEqual([0, 1, 2]);
  });

  it('summarises with sample SD and geometric mean', () => {
    const s = summarise([10, 20, 40]);
    expect(s.n).toBe(3);
    expect(s.mean).toBeCloseTo(23.333333, 5);
    expect(s.sd).toBeCloseTo(15.275252, 5);
    expect(s.geoMean).toBeCloseTo(20, 9);
  });
});
