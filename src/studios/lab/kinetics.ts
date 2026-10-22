/** Enzyme-kinetics models and fits for the Lab Studio "Enzyme kinetics" tab.
 *
 * Initial-rate models are fitted by the shared Levenberg–Marquardt routine in
 * `nls.ts`; the linearisations are displayed for teaching only (they distort the
 * error structure, so the non-linear fit is preferred).
 */
import { fitNls } from './nls';

export type SingleModel = 'mm' | 'substrate' | 'hill';
export type InhibitionModel = 'competitive' | 'noncompetitive' | 'uncompetitive' | 'mixed';
export type KineticsModel = SingleModel | InhibitionModel;

export interface Param { name: string; value: number; se: number; lo: number; hi: number }

export interface KineticsFit {
  model: KineticsModel;
  label: string;
  n: number;
  df: number;
  rss: number;
  r2: number;
  aic: number;
  converged: boolean;
  params: Param[];
  /** Convenience accessors (NaN when the model has no such parameter). */
  vmax: number;
  km: number;
  ki: number;
}

const NAMES: Record<KineticsModel, string[]> = {
  mm: ['Vmax', 'Km'],
  substrate: ['Vmax', 'Km', 'Ksi'],
  hill: ['Vmax', 'K', 'n'],
  competitive: ['Vmax', 'Km', 'Ki'],
  noncompetitive: ['Vmax', 'Km', 'Ki'],
  uncompetitive: ['Vmax', 'Km', 'Ki'],
  mixed: ['Vmax', 'Km', 'Ki', 'alpha'],
};
const LABELS: Record<KineticsModel, string> = {
  mm: 'Michaelis–Menten',
  substrate: 'Substrate inhibition',
  hill: 'Hill',
  competitive: 'Competitive inhibition',
  noncompetitive: 'Non-competitive inhibition',
  uncompetitive: 'Uncompetitive inhibition',
  mixed: 'Mixed inhibition',
};

/** v = Vmax·S/(Km + S) */
export const michaelisMenten = (p: number[], S: number) => (p[0] * S) / (p[1] + S);
/** v = Vmax·S/(Km + S·(1 + S/Ksi)) */
export const substrateInhibition = (p: number[], S: number) => (p[0] * S) / (p[1] + S * (1 + S / p[2]));
/** v = Vmax·Sⁿ/(Kⁿ + Sⁿ) */
export const hill = (p: number[], S: number) => {
  const sn = S ** p[2];
  return (p[0] * sn) / (p[1] ** p[2] + sn);
};

/** Rate at substrate S and inhibitor I for one of the inhibition models. */
export function inhibitionRate(model: InhibitionModel, p: number[], S: number, I: number): number {
  const [vmax, km, ki] = p;
  switch (model) {
    case 'competitive': return (vmax * S) / (km * (1 + I / ki) + S);
    case 'noncompetitive': return (vmax * S) / ((km + S) * (1 + I / ki));
    case 'uncompetitive': return (vmax * S) / (km + S * (1 + I / ki));
    case 'mixed': return (vmax * S) / (km * (1 + I / ki) + S * (1 + I / (p[3] * ki)));
  }
}

const aicOf = (rss: number, n: number, k: number) => (rss > 0 ? n * Math.log(rss / n) + 2 * k : -Infinity);

function pack(model: KineticsModel, p: number[], se: number[], ci: [number, number][], n: number, rss: number, r2: number, converged: boolean): KineticsFit {
  const params = NAMES[model].map((name, i) => ({ name, value: p[i], se: se[i], lo: ci[i][0], hi: ci[i][1] }));
  const get = (name: string) => params.find((q) => q.name === name)?.value ?? NaN;
  return {
    model, label: LABELS[model], n, df: n - p.length, rss, r2, aic: aicOf(rss, n, p.length), converged, params,
    vmax: get('Vmax'), km: get('Km'), ki: get('Ki'),
  };
}

/** Fits one of the single-substrate models to (S, v) data. */
export function fitKinetics(S: number[], v: number[], model: SingleModel = 'mm'): KineticsFit {
  if (S.length !== v.length) throw new Error('S and v must have the same length');
  const pts = S.map((s, i) => ({ s, v: v[i] })).filter((d) => Number.isFinite(d.s) && Number.isFinite(d.v) && d.s > 0);
  if (pts.length < NAMES[model].length + 1) throw new Error(`Need at least ${NAMES[model].length + 1} positive substrate points to fit this model (have ${pts.length}).`);
  const xs = pts.map((d) => d.s), ys = pts.map((d) => d.v), sMax = Math.max(...xs);
  const vmax0 = Math.max(...ys) * 1.1;
  const half = vmax0 / 2;
  const km0 = (() => {
    const sorted = [...pts].sort((a, b) => a.v - b.v);
    const near = sorted.reduce((best, d) => (Math.abs(d.v - half) < Math.abs(best.v - half) ? d : best), sorted[0]);
    return Math.max(near.s, 1e-6);
  })();
  const p0 = model === 'mm' ? [vmax0, km0]
    : model === 'substrate' ? [vmax0, km0, sMax * 4]
      : [vmax0, km0, 1.5];
  const f = model === 'mm' ? michaelisMenten : model === 'substrate' ? substrateInhibition : hill;
  const fit = fitNls(([s], p) => f(p, s), xs.map((s) => [s]), ys, p0, { lower: p0.map(() => 1e-12) });
  return pack(model, fit.p, fit.se, fit.ci95, pts.length, fit.rss, fit.r2, fit.converged);
}

/** Fits one of the inhibition models globally, across every (S, I, v) row. */
export function fitInhibition(rows: { S: number; I: number; v: number }[], model: InhibitionModel): KineticsFit {
  const pts = rows.filter((d) => [d.S, d.I, d.v].every(Number.isFinite) && d.S > 0 && d.I >= 0);
  const need = NAMES[model].length + 1;
  if (pts.length < need) throw new Error(`Need at least ${need} data points to fit ${LABELS[model]} (have ${pts.length}).`);
  const iMax = Math.max(...pts.map((d) => d.I));
  const vmax0 = Math.max(...pts.filter((d) => d.I === 0).map((d) => d.v), ...pts.map((d) => d.v)) * 1.1;
  const km0 = Math.max(Math.min(...pts.filter((d) => d.I === 0).map((d) => d.S)), 1e-6);
  const ki0 = iMax > 0 ? Math.max(iMax, 1e-3) : 1;
  const p0 = model === 'mixed' ? [vmax0, km0, ki0, 1] : [vmax0, km0, ki0];
  const fit = fitNls(([s, i], p) => inhibitionRate(model, p, s, i), pts.map((d) => [d.S, d.I]), pts.map((d) => d.v), p0, { lower: p0.map(() => 1e-12) });
  return pack(model, fit.p, fit.se, fit.ci95, pts.length, fit.rss, fit.r2, fit.converged);
}

/** Linear regression of y on x (used by the linearisations). */
function linreg(x: number[], y: number[]) {
  const n = x.length, xb = x.reduce((a, b) => a + b, 0) / n, yb = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - xb) * (y[i] - yb); sxx += (x[i] - xb) ** 2; syy += (y[i] - yb) ** 2; }
  const slope = sxy / sxx, intercept = yb - slope * xb;
  return { slope, intercept, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : NaN };
}

export interface Linearisation {
  kind: 'Lineweaver–Burk' | 'Eadie–Hofstee' | 'Hanes–Woolf';
  x: number[]; y: number[]; xLabel: string; yLabel: string;
  slope: number; intercept: number; r2: number; vmax: number; km: number;
}

/** The three classical linearisations of Michaelis–Menten data (display only). */
export function linearisations(S: number[], v: number[]): Linearisation[] {
  const pts = S.map((s, i) => ({ s, v: v[i] })).filter((d) => d.s > 0 && d.v > 0);
  const lb = linreg(pts.map((d) => 1 / d.s), pts.map((d) => 1 / d.v));
  const eh = linreg(pts.map((d) => d.v / d.s), pts.map((d) => d.v));
  const hw = linreg(pts.map((d) => d.s), pts.map((d) => d.s / d.v));
  return [
    { kind: 'Lineweaver–Burk', x: pts.map((d) => 1 / d.s), y: pts.map((d) => 1 / d.v), xLabel: '1/S', yLabel: '1/v', slope: lb.slope, intercept: lb.intercept, r2: lb.r2, vmax: lb.slope > 0 ? 1 / lb.intercept : NaN, km: lb.slope * (lb.slope > 0 ? 1 / lb.intercept : NaN) },
    { kind: 'Eadie–Hofstee', x: pts.map((d) => d.v / d.s), y: pts.map((d) => d.v), xLabel: 'v/S', yLabel: 'v', slope: eh.slope, intercept: eh.intercept, r2: eh.r2, vmax: eh.intercept, km: -eh.slope },
    { kind: 'Hanes–Woolf', x: pts.map((d) => d.s), y: pts.map((d) => d.s / d.v), xLabel: 'S', yLabel: 'S/v', slope: hw.slope, intercept: hw.intercept, r2: hw.r2, vmax: hw.slope > 0 ? 1 / hw.slope : NaN, km: hw.intercept * (hw.slope > 0 ? 1 / hw.slope : NaN) },
  ];
}

/** kcat = Vmax/[E] in the same concentration unit as Vmax; kcat/Km in the inverse time·concentration unit. */
export const kcat = (vmax: number, enzyme: number) => (enzyme > 0 ? vmax / enzyme : NaN);
export const catalyticEfficiency = (vmax: number, km: number, enzyme: number) => (km > 0 && enzyme > 0 ? vmax / enzyme / km : NaN);

/** Parses "S,v" or "S,I,v" rows (CSV/TSV, optional header); replicates are repeated rows. */
export function parseKinetics(text: string): { rows: { S: number; I: number; v: number }[]; hasInhibitor: boolean; skipped: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new Error('No data');
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const cells = (l: string) => l.split(sep).map((c) => c.trim());
  const head = cells(lines[0]).map((h) => h.toLowerCase());
  const isHead = head.some((h) => /[a-z]/.test(h) && !Number.isFinite(Number(h)));
  const body = isHead ? lines.slice(1) : lines;
  const hasInhibitor = isHead ? head.some((h) => /^i(nh)?$|inhib/i.test(h)) : cells(lines[0]).length >= 3;
  const si = isHead ? head.findIndex((h) => /^s(ub)?$|substrate/i.test(h)) : 0;
  const ii = hasInhibitor ? (isHead ? head.findIndex((h) => /^i(nh)?$|inhib/i.test(h)) : 1) : -1;
  const vi = isHead ? head.findIndex((h) => /^v$|rate|velocity/i.test(h)) : hasInhibitor ? 2 : 1;
  const sCol = si < 0 ? 0 : si, iCol = ii, vCol = vi < 0 ? (hasInhibitor ? 2 : 1) : vi;
  const rows: { S: number; I: number; v: number }[] = [];
  let skipped = 0;
  for (const l of body) {
    const c = cells(l), S = Number(c[sCol]), I = hasInhibitor ? Number(c[iCol]) : 0, v = Number(c[vCol]);
    if (!Number.isFinite(S) || !Number.isFinite(v) || (hasInhibitor && !Number.isFinite(I))) { skipped++; continue; }
    rows.push({ S, I, v });
  }
  if (!rows.length) throw new Error('No numeric S,v rows found.');
  return { rows, hasInhibitor, skipped };
}

/** Demo data: Michaelis–Menten with 6 % noise, three replicates per substrate. */
export function demoKinetics(): string {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lines = ['S,v'];
  for (const S of [0.5, 1, 2, 5, 10, 20, 50]) for (let k = 0; k < 3; k++) lines.push(`${S},${((100 * S) / (5 + S)) * (1 + (rnd() - 0.5) * 0.12)}`);
  return lines.join('\n');
}

/** Demo data for the global inhibition fit: competitive, Vmax 80, Km 4, Ki 2. */
export function demoInhibition(): string {
  const lines = ['S,I,v'];
  for (const I of [0, 1, 3]) for (const S of [0.5, 1, 2, 4, 8, 16, 32]) lines.push(`${S},${I},${(80 * S) / (4 * (1 + I / 2) + S)}`);
  return lines.join('\n');
}
