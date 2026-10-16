import { qt } from './dist';

/**
 * Four- and five-parameter logistic dose–response fits by Levenberg–Marquardt.
 *   y = bottom + (top − bottom) / (1 + exp(−hill · (ln x − ln EC50)))^asym        (asym = 1 for 4PL)
 * hill > 0 rises with dose, hill < 0 falls (GraphPad sign; drc's b = −hill). For 5PL EC50 is the location parameter
 * (drc's e); `x50` is the dose at the response midpoint, which is what an IC50 usually means.
 */
export type Model = '4PL' | '5PL';
export interface Fixed { bottom?: number; top?: number; hill?: number; asym?: number }
export interface DrPoint { x: number; y: number }
export const PARAMS = ['bottom', 'top', 'lnEC50', 'hill', 'asym'] as const;

export function logistic(p: number[], x: number): number {
  const [bottom, top, lne, hill, asym] = p;
  return bottom + (top - bottom) / (1 + Math.exp(-hill * (Math.log(x) - lne))) ** asym;
}

export interface LmResult { p: number[]; rss: number; iterations: number; converged: boolean; cov: number[][] | null }

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) return null; [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function invert(A: number[][]): number[][] | null {
  const n = A.length, cols: number[][] = [];
  for (let j = 0; j < n; j++) { const e = new Array<number>(n).fill(0); e[j] = 1; const s = solve(A, e); if (!s) return null; cols.push(s); }
  return A.map((_, i) => cols.map((c) => c[i]));
}

/** Generic LM on the free parameters (mask); numeric central-difference Jacobian. */
export function levenbergMarquardt(f: (p: number[], x: number) => number, xs: number[], ys: number[], p0: number[], free: boolean[], maxIter = 500): LmResult {
  const idx = free.map((b, i) => (b ? i : -1)).filter((i) => i >= 0), m = xs.length, k = idx.length;
  let p = [...p0], lambda = 1e-3;
  const resid = (q: number[]) => { let s = 0; const r = new Array<number>(m); for (let i = 0; i < m; i++) { r[i] = ys[i] - f(q, xs[i]); s += r[i] * r[i]; } return { r, s }; };
  const jac = (q: number[]) => idx.map((j) => { const h = 1e-6 * Math.max(Math.abs(q[j]), 1e-3), a = [...q], b = [...q]; a[j] += h; b[j] -= h; return xs.map((x) => (f(a, x) - f(b, x)) / (2 * h)); });
  let cur = resid(p), it = 0, converged = false;
  for (; it < maxIter; it++) {
    const J = jac(p), JtJ = J.map((a) => J.map((b) => a.reduce((s, v, i) => s + v * b[i], 0))), g = J.map((a) => a.reduce((s, v, i) => s + v * cur.r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 30; tries++) {
      const A = JtJ.map((row, i) => row.map((v, j) => v + (i === j ? lambda * (v || 1) : 0))), step = solve(A, g);
      if (!step || step.some((v) => !Number.isFinite(v))) { lambda *= 10; continue; }
      const q = [...p]; idx.forEach((j, a) => { q[j] += step[a]; });
      const nxt = resid(q);
      if (Number.isFinite(nxt.s) && nxt.s < cur.s) {
        const rel = (cur.s - nxt.s) / (cur.s || 1), smallStep = Math.max(...step.map((v, a) => Math.abs(v) / (Math.abs(p[idx[a]]) + 1e-8))) < 1e-10;
        p = q; cur = nxt; lambda = Math.max(lambda / 10, 1e-12); improved = true;
        if (rel < 1e-14 || smallStep) converged = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved) { converged = true; break; }
    if (converged) break;
  }
  const J = jac(p), JtJ = J.map((a) => J.map((b) => a.reduce((s, v, i) => s + v * b[i], 0))), inv = k ? invert(JtJ) : null;
  let cov: number[][] | null = null;
  if (inv && m > k) { const s2 = cur.s / (m - k); cov = Array.from({ length: p.length }, () => new Array<number>(p.length).fill(NaN)); idx.forEach((a, i) => idx.forEach((b, j) => { cov![a][b] = inv[i][j] * s2; })); }
  return { p, rss: cur.s, iterations: it, converged, cov };
}

export interface ParamEstimate { name: string; value: number; se: number; lo: number; hi: number; fixed: boolean }
export interface FitResult {
  model: Model; n: number; df: number; params: ParamEstimate[]; rss: number; r2: number; sigma: number; iterations: number; converged: boolean;
  bottom: number; top: number; hill: number; asym: number;
  ec50: number; ec50Se: number; ec50Lo: number; ec50Hi: number;           // location parameter e (drc "e"), Wald linear CI
  ec50LogLo: number; ec50LogHi: number;                                   // asymmetric CI from the t interval on ln EC50
  x50: number; x50Lo: number; x50Hi: number;                              // dose at the midpoint response (delta method), equals EC50 for 4PL
  warnings: string[];
}

const midFactor = (hill: number, asym: number) => Math.exp(-(1 / hill) * Math.log(2 ** (1 / asym) - 1)); // x50/EC50 ratio, = 1 when asym = 1

/** Fits the model to (dose, response) pairs. Dose 0 rows are kept: they anchor the lower or upper asymptote exactly as in drc. */
export function fitDoseResponse(data: DrPoint[], model: Model = '4PL', fixed: Fixed = {}): FitResult {
  const warnings: string[] = [], pts = data.filter((d) => d.x >= 0 && Number.isFinite(d.y));
  if (pts.length < data.length) warnings.push(`${data.length - pts.length} rows with negative dose or missing response were excluded.`);
  const xs = pts.map((d) => d.x), ys = pts.map((d) => d.y), n = pts.length, lx = xs.filter((x) => x > 0).map(Math.log);
  if (lx.length < 3) throw new Error('Need at least three doses above zero.');
  const free = [fixed.bottom === undefined, fixed.top === undefined, true, fixed.hill === undefined, model === '5PL' && fixed.asym === undefined];
  const nFree = free.filter(Boolean).length;
  if (n <= nFree) throw new Error(`Need more than ${nFree} data points to fit a ${model} with ${nFree} free parameters (have ${n}).`);
  const ymin = Math.min(...ys), ymax = Math.max(...ys), span = ymax - ymin || 1;
  // rising or falling: compare mean response of the lowest and highest thirds of dose
  const order = pts.map((_, i) => i).sort((a, b) => xs[a] - xs[b]), t = Math.max(1, Math.floor(n / 3));
  const lowMean = order.slice(0, t).reduce((s, i) => s + ys[i], 0) / t, highMean = order.slice(-t).reduce((s, i) => s + ys[i], 0) / t, sign = highMean >= lowMean ? 1 : -1;
  const bottom0 = fixed.bottom ?? (sign > 0 ? ymin : ymin), top0 = fixed.top ?? ymax;
  const mid = (bottom0 + top0) / 2; let lne0 = lx.reduce((s, v) => s + v, 0) / lx.length, bestd = Infinity;
  for (let i = 0; i < n; i++) { const d = Math.abs(ys[i] - mid); if (xs[i] > 0 && d < bestd) { bestd = d; lne0 = Math.log(xs[i]); } }
  const asym0 = fixed.asym ?? 1;
  const starts: number[][] = [];
  for (const h of [1, 2, 0.5, 4]) for (const dl of [0, -1, 1]) starts.push([bottom0, top0, lne0 + dl, (fixed.hill ?? sign * h), asym0]);
  // fixed bottom/top must be honoured in every start
  let best: LmResult | null = null;
  for (const s0 of starts) {
    if (fixed.hill !== undefined) s0[3] = fixed.hill;
    const r = levenbergMarquardt(logistic, xs.map((x) => x), ys, [s0[0], s0[1], s0[2], s0[3], s0[4]], free);
    if (!best || r.rss < best.rss - 1e-12 * Math.max(1, best.rss)) best = r;
    if (best.converged && best.rss < 1e-10 * span * span) break;
  }
  const fit = best!, p = fit.p, df = n - nFree, tcrit = qt(0.975, df);
  const names = ['bottom', 'top', 'EC50', 'hill', 'asym'];
  const est = (i: number): ParamEstimate => {
    const se = fit.cov ? Math.sqrt(fit.cov[i][i]) : NaN, value = i === 2 ? Math.exp(p[2]) : p[i], s = i === 2 ? value * se : se;
    return { name: names[i], value, se: free[i] ? s : 0, lo: free[i] ? value - tcrit * s : value, hi: free[i] ? value + tcrit * s : value, fixed: !free[i] };
  };
  const params = [0, 1, 2, 3, ...(model === '5PL' ? [4] : [])].map(est);
  const ec50 = Math.exp(p[2]), seLn = fit.cov ? Math.sqrt(fit.cov[2][2]) : NaN;
  const ybar = ys.reduce((s, v) => s + v, 0) / n, tss = ys.reduce((s, v) => s + (v - ybar) ** 2, 0);
  // delta-method CI for the midpoint dose x50 = e · (2^{1/f} − 1)^{1/b}
  let x50 = ec50, x50Lo = ec50 - tcrit * ec50 * seLn, x50Hi = ec50 + tcrit * ec50 * seLn;
  if (model === '5PL' && fit.cov) {
    const g = (q: number[]) => Math.exp(q[2]) * midFactor(q[3], q[4]); x50 = g(p);
    const grad = [0, 0, 0, 0, 0].map((_, j) => { if (!free[j]) return 0; const h = 1e-6 * Math.max(Math.abs(p[j]), 1e-3), a = [...p], b = [...p]; a[j] += h; b[j] -= h; return (g(a) - g(b)) / (2 * h); });
    let v = 0; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (free[i] && free[j]) v += grad[i] * fit.cov[i][j] * grad[j];
    const se = Math.sqrt(v); x50Lo = x50 - tcrit * se; x50Hi = x50 + tcrit * se;
  }
  if (!fit.converged) warnings.push('Levenberg–Marquardt did not fully converge; treat the estimates with caution.');
  if (!fit.cov) warnings.push('Parameter covariance is singular: the data do not constrain every free parameter (try fixing top/bottom or use 4PL).');
  if (ec50 < Math.min(...xs.filter((x) => x > 0)) || ec50 > Math.max(...xs)) warnings.push('EC50 lies outside the tested dose range: it is an extrapolation.');
  return {
    model, n, df, params, rss: fit.rss, r2: tss > 0 ? 1 - fit.rss / tss : NaN, sigma: Math.sqrt(fit.rss / df), iterations: fit.iterations, converged: fit.converged,
    bottom: p[0], top: p[1], hill: p[3], asym: p[4],
    ec50, ec50Se: ec50 * seLn, ec50Lo: ec50 - tcrit * ec50 * seLn, ec50Hi: ec50 + tcrit * ec50 * seLn, ec50LogLo: Math.exp(p[2] - tcrit * seLn), ec50LogHi: Math.exp(p[2] + tcrit * seLn),
    x50, x50Lo, x50Hi, warnings,
  };
}

/** Curve of a fitted model over a log-spaced dose grid. */
export function curvePoints(fit: Pick<FitResult, 'bottom' | 'top' | 'hill' | 'asym' | 'ec50'>, lo: number, hi: number, n = 120) {
  const p = [fit.bottom, fit.top, Math.log(fit.ec50), fit.hill, fit.asym], a = Math.log(lo), b = Math.log(hi);
  return Array.from({ length: n }, (_, i) => { const x = Math.exp(a + ((b - a) * i) / (n - 1)); return { x, y: logistic(p, x) }; });
}

/** Parses "compound,dose,response" (compound optional) CSV/TSV; replicates are repeated rows. */
export function parseDoseResponse(text: string): { groups: Map<string, DrPoint[]>; note: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new Error('No data');
  const sep = lines[0].includes('\t') ? '\t' : ',', cells = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const head = cells(lines[0]).map((h) => h.toLowerCase()), isHead = head.some((h) => /[a-z]/.test(h) && Number.isNaN(Number(h)));
  const body = isHead ? lines.slice(1) : lines;
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  let ci = -1, di = 0, ri = 1;
  if (isHead) { ci = find(/compound|drug|group|sample|name|id/); di = find(/dose|conc|x$/); ri = find(/resp|y$|signal|viab|activity|value|od/); if (di < 0 || ri < 0) { const nums = head.map((_, i) => i).filter((i) => i !== ci); di = nums[0]; ri = nums[1]; } }
  else if (cells(lines[0]).length >= 3) { ci = 0; di = 1; ri = 2; }
  const groups = new Map<string, DrPoint[]>(); let bad = 0;
  for (const l of body) {
    const c = cells(l), x = Number(c[di]), y = Number(c[ri]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { bad++; continue; }
    const g = ci >= 0 ? c[ci] || 'sample' : 'sample'; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push({ x, y });
  }
  if (!groups.size) throw new Error('No numeric dose/response rows found. Expected columns: [compound,] dose, response.');
  return { groups, note: bad ? `${bad} unparseable rows skipped.` : '' };
}

