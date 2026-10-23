/**
 * Non-compartmental analysis (NCA).
 *
 * Conventions follow Gibaldi & Perrier (1982) and the trapezoidal rules compared by Yeh & Kwan (1978):
 * concentrations are integrated with the linear trapezoid while rising and, optionally, the logarithmic
 * trapezoid while falling; the terminal rate constant is a least-squares slope of ln C on t over the last
 * points that give the best adjusted R².
 */

export type Trapezoid = 'linear-up-log-down' | 'linear';

export interface NcaOptions {
  dose: number;
  route: 'iv' | 'extravascular';
  /** Number of terminal points to use, or 'auto' (default) to choose the fit with the highest adjusted R². */
  lambdaPoints?: number | 'auto';
  trapezoid?: Trapezoid;
  /** Lowest quantifiable concentration; values below it are treated as 0 when `blqAsZero` is true. */
  loq?: number;
  blqAsZero?: boolean;
}

export interface NcaResult {
  nPoints: number;
  cmax: number;
  tmax: number;
  clast: number;
  tlast: number;
  aucLast: number;
  lambdaZ: number | null;
  halfLife: number | null;
  r2adj: number | null;
  nPointsLambda: number;
  aucInf: number | null;
  aucExtrapPct: number | null;
  aumcLast: number;
  aumcInf: number | null;
  mrt: number | null;
  cl: number | null;
  vz: number | null;
  warnings: string[];
}

export interface Profile { name: string; time: number[]; conc: number[] }

/** A single trapezoid segment under C(t), for the integration rule in use. */
function segAuc(t1: number, c1: number, t2: number, c2: number, rule: Trapezoid): number {
  const dt = t2 - t1;
  if (!(dt > 0)) return 0;
  if (rule === 'linear' || c1 <= 0 || c2 <= 0 || c2 >= c1) return ((c1 + c2) / 2) * dt;
  const l = Math.log(c1 / c2);
  return (c1 - c2) * dt / l;
}

/** A single trapezoid segment under t·C(t). */
function segAumc(t1: number, c1: number, t2: number, c2: number, rule: Trapezoid): number {
  const dt = t2 - t1;
  if (!(dt > 0)) return 0;
  if (rule === 'linear' || c1 <= 0 || c2 <= 0 || c2 >= c1) return (dt * (t1 * c1 + t2 * c2)) / 2;
  // Exact integral of t·C(t) over an exponential segment, with L = ln(C1/C2).
  const l = Math.log(c1 / c2);
  return (t1 * (c1 - c2) * dt) / l + ((c1 - c2) * dt * dt) / (l * l) - (c2 * dt * dt) / l;
}

interface LambdaFit { lambdaZ: number; r2adj: number; n: number; slope: number; intercept: number; from: number }

/** Log-linear regression on the last m positive points after the peak, for every candidate m. */
function fitLambda(points: { t: number; c: number }[], mode: number | 'auto'): LambdaFit | null {
  const n = points.length;
  if (n < 3) return null;
  const sizes: number[] = [];
  if (mode === 'auto') for (let m = 3; m <= n; m++) sizes.push(m);
  else {
    const m = Math.max(3, Math.min(n, Math.round(mode)));
    sizes.push(m);
  }
  let best: LambdaFit | null = null;
  for (const m of sizes) {
    const sub = points.slice(n - m);
    let st = 0, sy = 0;
    for (const p of sub) { st += p.t; sy += Math.log(p.c); }
    const mt = st / m, my = sy / m;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of sub) {
      const dx = p.t - mt, dy = Math.log(p.c) - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (!(sxx > 0)) continue;
    const slope = sxy / sxx;
    if (!(slope < 0)) continue; // a terminal phase must decay
    const intercept = my - slope * mt;
    const ssr = Math.max(0, syy - slope * sxy);
    const r2 = syy > 0 ? 1 - ssr / syy : 1;
    const r2adj = 1 - (1 - r2) * (m - 1) / (m - 2);
    if (!best || r2adj > best.r2adj + 1e-4 || (Math.abs(r2adj - best.r2adj) <= 1e-4 && m > best.n)) {
      best = { lambdaZ: -slope, r2adj, n: m, slope, intercept, from: sub[0].t };
    }
  }
  return best;
}

/** Number of points used by the terminal fit, and the fitted line, for plotting. */
export function terminalPhase(time: number[], conc: number[], opt: NcaOptions): { from: number; n: number; lambdaZ: number } | null {
  const pts = applyLoq(cleanPairs(time, conc), opt).filter((p) => p.c > 0);
  if (!pts.length) return null;
  const peak = pts.findIndex((p) => p.c === Math.max(...pts.map((q) => q.c)));
  const tail = pts.slice(peak + 1);
  const fit = fitLambda(tail, opt.lambdaPoints ?? 'auto');
  return fit ? { from: fit.from, n: fit.n, lambdaZ: fit.lambdaZ } : null;
}

function applyLoq(pts: { t: number; c: number }[], opt: NcaOptions): { t: number; c: number }[] {
  if (opt.loq === undefined || !opt.blqAsZero) return pts;
  return pts.map((p) => (p.c < opt.loq! ? { t: p.t, c: 0 } : p));
}

function cleanPairs(time: number[], conc: number[]): { t: number; c: number }[] {
  const out: { t: number; c: number }[] = [];
  const n = Math.min(time.length, conc.length);
  for (let i = 0; i < n; i++) {
    const t = time[i], c = conc[i];
    if (!Number.isFinite(t) || !Number.isFinite(c) || t < 0) continue;
    out.push({ t, c: Math.max(0, c) });
  }
  out.sort((a, b) => a.t - b.t);
  // A repeated sampling time is a data error; keep the first value.
  return out.filter((p, i) => i === 0 || p.t !== out[i - 1].t);
}

export function nca(time: number[], conc: number[], opt: NcaOptions): NcaResult {
  if (!Number.isFinite(opt.dose) || opt.dose <= 0) throw new Error('The dose must be a positive number.');
  const rule: Trapezoid = opt.trapezoid ?? 'linear-up-log-down';
  const pts = applyLoq(cleanPairs(time, conc), opt);
  const positive = pts.filter((p) => p.c > 0);
  if (positive.length < 3) throw new Error('A profile needs at least three positive concentrations after missing values are removed.');
  if (pts.length < 3) throw new Error('A profile needs at least three time points.');

  const maxC = Math.max(...pts.map((p) => p.c));
  const tmax = pts.find((p) => p.c === maxC)!.t;
  const last = pts[pts.length - 1];
  const warnings: string[] = [];

  let aucLast = 0, aumcLast = 0;
  for (let i = 1; i < pts.length; i++) {
    aucLast += segAuc(pts[i - 1].t, pts[i - 1].c, pts[i].t, pts[i].c, rule);
    aumcLast += segAumc(pts[i - 1].t, pts[i - 1].c, pts[i].t, pts[i].c, rule);
  }

  // Terminal phase: positive points after the peak, best adjusted R².
  const peakIdx = pts.findIndex((p) => p.t === tmax);
  const tail = pts.slice(peakIdx + 1).filter((p) => p.c > 0);
  const fit = fitLambda(tail, opt.lambdaPoints ?? 'auto');
  const lambdaZ = fit ? fit.lambdaZ : null;
  const halfLife = lambdaZ ? Math.LN2 / lambdaZ : null;

  let aucInf: number | null = null, aucExtrapPct: number | null = null, aumcInf: number | null = null;
  let mrt: number | null = null, cl: number | null = null, vz: number | null = null;
  if (lambdaZ && Number.isFinite(lambdaZ)) {
    aucInf = aucLast + last.c / lambdaZ;
    aucExtrapPct = aucInf > 0 ? ((aucInf - aucLast) / aucInf) * 100 : 0;
    aumcInf = aumcLast + (last.c * last.t) / lambdaZ + last.c / (lambdaZ * lambdaZ);
    mrt = aumcInf / aucInf;
    cl = opt.dose / aucInf;
    vz = opt.dose / (lambdaZ * aucInf);
    if (aucExtrapPct > 20) warnings.push(`AUC extrapolated by ${aucExtrapPct.toFixed(1)} % — extend sampling to cover more of the terminal phase.`);
    if (aucExtrapPct > 5 && aucExtrapPct <= 20) warnings.push(`AUC extrapolated by ${aucExtrapPct.toFixed(1)} % of AUCinf.`);
    if (fit && fit.r2adj < 0.9) warnings.push(`Terminal-phase adjusted R² is ${fit.r2adj.toFixed(3)}; λz is poorly determined.`);
  } else {
    warnings.push('No decreasing terminal phase could be fitted, so λz, AUCinf, CL, Vz and MRT are not reported.');
  }
  if (tail.length < 3) warnings.push('Fewer than three positive samples after the peak: λz is not estimable.');
  if (pts[0].t > 0) warnings.push('The profile starts after time zero, so AUC before the first sample is not included.');

  return {
    nPoints: pts.length, cmax: maxC, tmax, clast: last.c, tlast: last.t, aucLast,
    lambdaZ, halfLife, r2adj: fit ? fit.r2adj : null, nPointsLambda: fit ? fit.n : 0,
    aucInf, aucExtrapPct, aumcLast, aumcInf, mrt, cl, vz, warnings,
  };
}

/** Mean, sample SD and geometric mean of a set of summary values. */
export function summarise(values: number[]): { n: number; mean: number; sd: number; geoMean: number } {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (!n) return { n: 0, mean: NaN, sd: NaN, geoMean: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  const pos = v.filter((x) => x > 0);
  const geoMean = pos.length ? Math.exp(pos.reduce((a, b) => a + Math.log(b), 0) / pos.length) : NaN;
  return { n, mean, sd, geoMean };
}

/**
 * Parse a concentration–time table.
 *
 * Accepted layouts: `time,conc`, `time,conc,subject`, `subject,time,conc`, or a header with several
 * concentration columns (one subject per column). Missing cells are skipped.
 */
export function parseProfiles(text: string): Profile[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new Error('The table is empty.');
  const split = (l: string) => l.split(/[\t,;]/).map((c) => c.trim());
  const first = split(lines[0]);
  const isHeader = first.some((c) => c !== '' && !Number.isFinite(Number(c)));
  const cols = isHeader ? first.map((c) => c.toLowerCase()) : [];
  const timeIdx = isHeader ? cols.findIndex((c) => /^(time|t|hours?|hr|h)$/.test(c)) : 0;
  const concIdx = isHeader ? cols.findIndex((c) => /^(conc|concentration|c|cp|c_p|conc_?ug_?ml|plasma)$/.test(c)) : 1;
  const subjIdx = isHeader ? cols.findIndex((c) => /^(subject|subject_?id|id|animal|patient)$/.test(c)) : -1;
  const numericCols = isHeader
    ? cols.map((c, i) => ({ c, i })).filter(({ i }) => i !== timeIdx && i !== subjIdx).map((x) => x.i)
    : [];
  const wide = isHeader && concIdx < 0 && numericCols.length > 0;

  const body = (isHeader ? lines.slice(1) : lines).map(split);
  if (timeIdx < 0 || (concIdx < 0 && !(isHeader && numericCols.length > 0))) throw new Error('A header needs a "time" column and either a "conc" column or one column per subject.');

  const groups = new Map<string, { time: number[]; conc: number[] }>();
  const push = (key: string, t: number, c: number) => {
    if (!Number.isFinite(t) || !Number.isFinite(c)) return;
    const g = groups.get(key) ?? { time: [], conc: [] };
    g.time.push(t); g.conc.push(c); groups.set(key, g);
  };

  for (const row of body) {
    const t = Number(row[timeIdx]);
    if (wide) {
      for (const i of numericCols) push(first[i] || `column ${i + 1}`, t, Number(row[i]));
    } else {
      const key = subjIdx >= 0 ? row[subjIdx] || 'subject' : 'profile';
      push(key, t, Number(row[concIdx]));
    }
  }
  const out = [...groups.entries()].filter(([, g]) => g.time.length > 0).map(([name, g]) => ({ name, ...g }));
  if (!out.length) throw new Error('No numeric time/concentration pairs were found.');
  return out;
}
