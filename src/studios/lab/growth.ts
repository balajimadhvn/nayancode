/** Growth-curve fitting (Zwietering et al. 1990): modified Gompertz and logistic
 * models on y = ln(OD/OD0), plus a model-free maximum specific growth rate from
 * a sliding log-linear regression.
 */
import { fitNls } from './nls';

export type GrowthModel = 'gompertz' | 'logistic';

export interface GrowthFit {
  model: GrowthModel;
  label: string;
  /** Asymptote in ln(OD/OD0) units. */
  A: number;
  /** Maximum specific growth rate (per time unit). */
  mu: number;
  /** Lag time (same unit as t). */
  lambda: number;
  doublingTime: number;
  se: { A: number; mu: number; lambda: number };
  ci95: { A: [number, number]; mu: [number, number]; lambda: [number, number] };
  rss: number;
  r2: number;
  aic: number;
  n: number;
  converged: boolean;
  warning: string;
}

/** Modified Gompertz: y = A·exp(−exp(μe/A·(λ − t) + 1)). */
export const gompertz = (A: number, mu: number, lambda: number, t: number) =>
  A * Math.exp(-Math.exp((mu * Math.E) / A * (lambda - t) + 1));
/** Logistic: y = A/(1 + exp(4μ/A·(λ − t) + 2)). */
export const logisticGrowth = (A: number, mu: number, lambda: number, t: number) =>
  A / (1 + Math.exp((4 * mu) / A * (lambda - t) + 2));

const aicOf = (rss: number, n: number, k: number) => (rss > 0 ? n * Math.log(rss / n) + 2 * k : -Infinity);

function linreg(x: number[], y: number[]) {
  const n = x.length, xb = x.reduce((a, b) => a + b, 0) / n, yb = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - xb) * (y[i] - yb); sxx += (x[i] - xb) ** 2; syy += (y[i] - yb) ** 2; }
  return { slope: sxy / sxx, intercept: yb - (sxy / sxx) * xb, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : NaN };
}

/**
 * Fits the model to y = ln(OD/OD0) values. Use `fitGrowth` when you have raw OD.
 * `mu` is in reciprocal time units; `lambda` uses the same time unit as `t`.
 */
export function fitGrowthCurve(t: number[], y: number[], model: GrowthModel): GrowthFit {
  if (t.length !== y.length) throw new Error('t and y must have the same length');
  const pts = t.map((x, i) => ({ t: x, y: y[i] })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y)).sort((a, b) => a.t - b.t);
  if (pts.length < 5) throw new Error(`Need at least 5 time points to fit a growth curve (have ${pts.length}).`);
  const ts = pts.map((p) => p.t), ys = pts.map((p) => p.y);
  const yMax = Math.max(...ys);
  if (!(yMax > 0.02)) {
    return {
      model, label: model === 'gompertz' ? 'Modified Gompertz' : 'Logistic', A: 0, mu: 0, lambda: ts[0], doublingTime: Infinity,
      se: { A: 0, mu: 0, lambda: 0 }, ci95: { A: [0, 0], mu: [0, 0], lambda: [0, 0] }, rss: 0, r2: NaN, aic: NaN, n: pts.length, converged: true,
      warning: 'no growth detected',
    };
  }
  const free = modelFreeMu(ts, ys.map((v) => Math.exp(v)), 4);
  const tHalf = (() => {
    const half = yMax / 2;
    for (let i = 1; i < ys.length; i++) if (ys[i - 1] < half && ys[i] >= half) {
      const f = (half - ys[i - 1]) / (ys[i] - ys[i - 1]);
      return ts[i - 1] + f * (ts[i] - ts[i - 1]);
    }
    return ts[0] + (ts[ts.length - 1] - ts[0]) / 4;
  })();
  const f = model === 'gompertz'
    ? (xi: number[], p: number[]) => gompertz(p[0], p[1], p[2], xi[0])
    : (xi: number[], p: number[]) => logisticGrowth(p[0], p[1], p[2], xi[0]);
  // Try a small grid of starts; keep the best residual.
  let best: ReturnType<typeof fitNls> | null = null;
  for (const A0 of [yMax, yMax * 1.05, yMax * 1.2]) for (const mu0 of [Math.max(free.mu, 1e-3), Math.max(free.mu, 1e-3) * 1.5, 0.6]) for (const l0 of [Math.max(tHalf * 0.5, ts[0]), Math.max(tHalf, ts[0] + 0.5)]) {
    const fit = fitNls(f, ts.map((x) => [x]), ys, [A0, mu0, l0], { lower: [1e-9, 1e-12, -Infinity], maxIter: 400 });
    if (!best || fit.rss < best.rss) best = fit;
  }
  const fit = best!;
  return {
    model, label: model === 'gompertz' ? 'Modified Gompertz' : 'Logistic',
    A: fit.p[0], mu: fit.p[1], lambda: fit.p[2], doublingTime: fit.p[1] > 0 ? Math.LN2 / fit.p[1] : Infinity,
    se: { A: fit.se[0], mu: fit.se[1], lambda: fit.se[2] },
    ci95: { A: fit.ci95[0] as [number, number], mu: fit.ci95[1] as [number, number], lambda: fit.ci95[2] as [number, number] },
    rss: fit.rss, r2: fit.r2, aic: aicOf(fit.rss, pts.length, 3), n: pts.length, converged: fit.converged, warning: '',
  };
}

/**
 * Model-free maximum specific growth rate: regress ln(OD) on t over every window
 * of `window` consecutive points and take the largest slope. `mu` is per time unit.
 */
export function modelFreeMu(t: number[], od: number[], window = 4): { mu: number; doublingTime: number; window: [number, number]; r2: number } {
  const pts = t.map((x, i) => ({ t: x, od: od[i] })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.od) && p.od > 0).sort((a, b) => a.t - b.t);
  const w = Math.max(2, Math.min(window, pts.length));
  if (pts.length < w) throw new Error(`Need at least ${w} positive OD values for the sliding window.`);
  let best = { mu: -Infinity, r2: NaN, window: [pts[0].t, pts[w - 1].t] as [number, number] };
  for (let i = 0; i + w <= pts.length; i++) {
    const seg = pts.slice(i, i + w);
    const fit = linreg(seg.map((p) => p.t), seg.map((p) => Math.log(p.od)));
    if (fit.slope > best.mu) best = { mu: fit.slope, r2: fit.r2, window: [seg[0].t, seg[w - 1].t] };
  }
  return { ...best, doublingTime: best.mu > 0 ? Math.LN2 / best.mu : Infinity };
}

export interface GrowthSeriesResult { name: string; gompertz: GrowthFit; logistic: GrowthFit; best: GrowthModel; free: ReturnType<typeof modelFreeMu> }

/** Fits both models to raw OD data (y = ln(OD/OD0); OD0 defaults to the first positive reading). */
export function fitGrowth(t: number[], od: number[], od0?: number): GrowthSeriesResult {
  const pairs = t.map((x, i) => ({ t: x, od: od[i] })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.od) && p.od > 0).sort((a, b) => a.t - b.t);
  if (pairs.length < 5) throw new Error(`Need at least 5 positive OD readings to fit a growth curve (have ${pairs.length}).`);
  const base = od0 && od0 > 0 ? od0 : pairs[0].od;
  const ts = pairs.map((p) => p.t), ys = pairs.map((p) => Math.log(p.od / base));
  const gompertzFit = fitGrowthCurve(ts, ys, 'gompertz'), logisticFit = fitGrowthCurve(ts, ys, 'logistic');
  const best: GrowthModel = gompertzFit.aic <= logisticFit.aic ? 'gompertz' : 'logistic';
  return { name: '', gompertz: gompertzFit, logistic: logisticFit, best, free: modelFreeMu(ts, pairs.map((p) => p.od)) };
}

/** Parses "time,<strain A>,<strain B>,…" CSV/TSV (one column per well/strain). */
export function parseGrowth(text: string): { t: number[]; series: { name: string; od: number[] }[]; skipped: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('Need a header row and at least one data row.');
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const cells = (l: string) => l.split(sep).map((c) => c.trim());
  const head = cells(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  if (head.length < 2) throw new Error('Need a time column and at least one OD column.');
  const t: number[] = [], cols: number[][] = head.slice(1).map(() => []);
  let skipped = 0;
  for (const l of lines.slice(1)) {
    const c = cells(l), tv = Number(c[0]);
    if (!Number.isFinite(tv)) { skipped++; continue; }
    t.push(tv);
    head.slice(1).forEach((_, j) => cols[j].push(Number(c[j + 1])));
  }
  if (!t.length) throw new Error('No numeric time values found.');
  return { t, series: head.slice(1).map((name, j) => ({ name: name || `well ${j + 1}`, od: cols[j] })), skipped };
}

/** Demo: two strains with different lag and growth rate, plus multiplicative noise. */
export function demoGrowth(): string {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rows = ['time,WT,drug-treated'];
  for (let i = 0; i <= 48; i++) {
    const tt = i * 0.5;
    const wt = 0.05 * Math.exp(gompertz(2.5, 0.6, 1.5, tt)) * (1 + (rnd() - 0.5) * 0.04);
    const dr = 0.05 * Math.exp(logisticGrowth(2.1, 0.35, 3, tt)) * (1 + (rnd() - 0.5) * 0.04);
    rows.push(`${tt},${wt.toFixed(4)},${dr.toFixed(4)}`);
  }
  return rows.join('\n');
}
