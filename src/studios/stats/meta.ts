/** Meta-analysis for the Statistics Studio: effect sizes, fixed-effect and
 * random-effects pooling (DerSimonian–Laird, REML, Paule–Mandel), heterogeneity,
 * Egger's test, leave-one-out and subgroups.
 *
 * The BCG vaccine data of Colditz et al. (1994) are used as the known-answer
 * test; the expected values were computed independently in Python and match
 * R metafor's documentation.
 */
import { pchisq, pnorm, pt, qt } from '../lab/dist';

export type Method = 'FE' | 'DL' | 'REML' | 'PM';
export interface Effect { yi: number; vi: number }

/** Log odds ratio; any zero cell triggers a 0.5 continuity correction for that study. */
export function logOddsRatio(a: number, b: number, c: number, d: number): Effect & { corrected: boolean } {
  const zero = [a, b, c, d].some((v) => v === 0);
  const [A, B, C, D] = zero ? [a + 0.5, b + 0.5, c + 0.5, d + 0.5] : [a, b, c, d];
  return { yi: Math.log((A * D) / (B * C)), vi: 1 / A + 1 / B + 1 / C + 1 / D, corrected: zero };
}

/** Log risk ratio with its delta-method variance. */
export function logRiskRatio(a: number, b: number, c: number, d: number): Effect {
  const n1 = a + b, n2 = c + d;
  if (!a || !c) throw new Error('The log risk ratio needs at least one event in each group.');
  return { yi: Math.log(a / n1 / (c / n2)), vi: 1 / a - 1 / n1 + 1 / c - 1 / n2 };
}

/** Risk difference with its Wald variance. */
export function riskDifference(a: number, b: number, c: number, d: number): Effect {
  const n1 = a + b, n2 = c + d, p1 = a / n1, p2 = c / n2;
  return { yi: p1 - p2, vi: (p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2 };
}

/** Hedges' g with the small-sample correction J and the usual variance. */
export function hedgesG(m1: number, sd1: number, n1: number, m2: number, sd2: number, n2: number): Effect {
  const df = n1 + n2 - 2, sp = Math.sqrt(((n1 - 1) * sd1 * sd1 + (n2 - 1) * sd2 * sd2) / df);
  const d = (m1 - m2) / sp, J = 1 - 3 / (4 * df - 1), g = J * d;
  return { yi: g, vi: (n1 + n2) / (n1 * n2) + (g * g) / (2 * (n1 + n2)) };
}

export interface MetaResult {
  method: Method;
  k: number;
  estimate: number;
  se: number;
  z: number;
  p: number;
  ci95: [number, number];
  tau2: number;
  I2: number;
  H2: number;
  Q: number;
  Qdf: number;
  Qp: number;
  weights: number[];
  predictionInterval: [number, number] | null;
}

const weightedMean = (yi: number[], w: number[]) => yi.reduce((s, y, i) => s + w[i] * y, 0) / w.reduce((a, b) => a + b, 0);

/** Pooled estimate under a fixed-effect (FE) or random-effects model. */
export function metaAnalysis(yi: number[], vi: number[], method: Method = 'DL'): MetaResult {
  const k = yi.length;
  if (k < 2) throw new Error('need at least 2 studies');
  if (vi.some((v) => !(v > 0))) throw new Error('Every study needs a positive variance.');
  const w = vi.map((v) => 1 / v), sumW = w.reduce((a, b) => a + b, 0);
  const fe = weightedMean(yi, w);
  const Q = yi.reduce((s, y, i) => s + w[i] * (y - fe) ** 2, 0);
  const Qdf = k - 1, Qp = Q > 0 ? 1 - pchisq(Q, Qdf) : 1;
  const I2 = Q > 0 ? Math.max(0, (Q - Qdf) / Q) * 100 : 0;
  const H2 = Q / Qdf;
  const c = sumW - w.reduce((s, v) => s + v * v, 0) / sumW;
  const dl = Math.max(0, (Q - Qdf) / c);

  const profile = (t2: number) => {
    const ww = vi.map((v) => 1 / (v + t2)), mu = weightedMean(yi, ww);
    return -0.5 * (vi.reduce((s, v) => s + Math.log(v + t2), 0) + Math.log(ww.reduce((a, b) => a + b, 0)) + yi.reduce((s, y, i) => s + ww[i] * (y - mu) ** 2, 0));
  };
  const pmGap = (t2: number) => {
    const ww = vi.map((v) => 1 / (v + t2)), mu = weightedMean(yi, ww);
    return yi.reduce((s, y, i) => s + ww[i] * (y - mu) ** 2, 0) - Qdf;
  };
  const hi = Math.max(10 * varianceOf(yi), 1);
  let tau2 = 0;
  if (method === 'REML') {
    // Golden-section maximisation of the profile restricted likelihood on [0, hi].
    const gr = (Math.sqrt(5) - 1) / 2;
    let a = 0, b = hi, c1 = b - gr * (b - a), d1 = a + gr * (b - a), fc = profile(c1), fd = profile(d1);
    while (b - a > 1e-10) {
      if (fc > fd) { b = d1; d1 = c1; fd = fc; c1 = b - gr * (b - a); fc = profile(c1); }
      else { a = c1; c1 = d1; fc = fd; d1 = a + gr * (b - a); fd = profile(d1); }
    }
    tau2 = Math.max(0, (a + b) / 2);
  } else if (method === 'PM') {
    if (pmGap(0) > 0) {
      let a = 0, b = hi;
      while (pmGap(b) > 0 && b < 1e6) b *= 2;
      for (let i = 0; i < 200; i++) { const m = (a + b) / 2; if (pmGap(m) > 0) a = m; else b = m; }
      tau2 = (a + b) / 2;
    }
  } else if (method === 'DL') tau2 = dl;

  const weights = method === 'FE' ? w : vi.map((v) => 1 / (v + tau2));
  const estimate = weightedMean(yi, weights), se = Math.sqrt(1 / weights.reduce((a, b) => a + b, 0));
  const z = estimate / se, crit = 1.959963984540054;
  const tcrit = k >= 3 ? qt(0.975, k - 2) : NaN;
  return {
    method, k, estimate, se, z, p: 2 * (1 - pnorm(Math.abs(z))),
    ci95: [estimate - crit * se, estimate + crit * se],
    tau2, I2, H2, Q, Qdf, Qp, weights,
    predictionInterval: k >= 3 ? [estimate - tcrit * Math.sqrt(tau2 + se * se), estimate + tcrit * Math.sqrt(tau2 + se * se)] : null,
  };
}

const varianceOf = (a: number[]) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return a.length > 1 ? a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1) : 0;
};

/** Egger's regression test for funnel-plot asymmetry: z = yi/se on 1/se. */
export function eggerTest(yi: number[], vi: number[]): { intercept: number; se: number; t: number; p: number; df: number; slope: number } {
  const k = yi.length;
  if (k < 3) throw new Error('Egger\'s test needs at least 3 studies.');
  const z = yi.map((y, i) => y / Math.sqrt(vi[i])), prec = vi.map((v) => 1 / Math.sqrt(v));
  const mx = prec.reduce((a, b) => a + b, 0) / k, my = z.reduce((a, b) => a + b, 0) / k;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < k; i++) { sxy += (prec[i] - mx) * (z[i] - my); sxx += (prec[i] - mx) ** 2; }
  const slope = sxy / sxx, intercept = my - slope * mx;
  const sse = zi2(prec, z, intercept, slope), df = k - 2, s2 = sse / df;
  const se = Math.sqrt(s2 * (1 / k + mx * mx / sxx));
  const t = intercept / se;
  return { intercept, se, t, p: 2 * (1 - tCdf(Math.abs(t), df)), df, slope };
}

const zi2 = (x: number[], y: number[], a: number, b: number) => x.reduce((s, v, i) => s + (y[i] - (a + b * v)) ** 2, 0);
const tCdf = (t: number, df: number) => pt(t, df);

/** Leave-one-out estimates (same method) to show the influence of each study. */
export function leaveOneOut(yi: number[], vi: number[], method: Method = 'DL'): { omitted: number; estimate: number; ci95: [number, number]; tau2: number; I2: number }[] {
  if (yi.length < 3) throw new Error('Leave-one-out needs at least 3 studies.');
  return yi.map((_, i) => {
    const r = metaAnalysis(yi.filter((_y, j) => j !== i), vi.filter((_v, j) => j !== i), method);
    return { omitted: i, estimate: r.estimate, ci95: r.ci95, tau2: r.tau2, I2: r.I2 };
  });
}

/** Per-subgroup pooled estimates and a between-group Q test. */
export function subgroups(yi: number[], vi: number[], labels: string[], method: Method = 'DL'): { groups: { label: string; k: number; estimate: number; se: number; ci95: [number, number] }[]; betweenQ: number; df: number; p: number } {
  const ids = [...new Set(labels)], groups = ids.map((label) => {
    const idx = labels.map((l, i) => (l === label ? i : -1)).filter((i) => i >= 0);
    const r = metaAnalysis(idx.map((i) => yi[i]), idx.map((i) => vi[i]), method);
    return { label, k: idx.length, estimate: r.estimate, se: r.se, ci95: r.ci95 };
  });
  const w = groups.map((g) => 1 / (g.se * g.se));
  const pooled = groups.reduce((s, g, i) => s + g.estimate * w[i], 0) / w.reduce((a, b) => a + b, 0);
  const betweenQ = groups.reduce((s, g, i) => s + w[i] * (g.estimate - pooled) ** 2, 0), df = groups.length - 1;
  return { groups, betweenQ, df, p: df > 0 ? 1 - pchisq(betweenQ, df) : NaN };
}

/** The 13 BCG vaccine trials (Colditz et al. 1994); rows are tpos, tneg, cpos, cneg. */
export const BCG: { study: string; a: number; b: number; c: number; d: number }[] = [
  { study: 'Aronson', a: 4, b: 119, c: 11, d: 128 },
  { study: 'Ferguson & Simes', a: 6, b: 300, c: 29, d: 274 },
  { study: 'Rosenthal', a: 3, b: 228, c: 11, d: 209 },
  { study: 'Stein & Aronson', a: 62, b: 13536, c: 248, d: 12619 },
  { study: 'Vandiviere', a: 33, b: 5036, c: 47, d: 5761 },
  { study: 'Frimodt-Moller', a: 180, b: 1361, c: 372, d: 1079 },
  { study: 'Coetzee & Berjak', a: 8, b: 2537, c: 10, d: 619 },
  { study: 'Rosenthal et al.', a: 505, b: 87886, c: 499, d: 87892 },
  { study: 'Comstock & Webster', a: 29, b: 7470, c: 45, d: 7232 },
  { study: 'Comstock et al.', a: 17, b: 1699, c: 65, d: 1600 },
  { study: 'Hart & Sutherland', a: 186, b: 50448, c: 141, d: 27197 },
  { study: 'Frimodt-Moller et al.', a: 5, b: 2493, c: 3, d: 2338 },
  { study: 'Tuberculosis Prevention Trial', a: 27, b: 16886, c: 29, d: 17825 },
];
