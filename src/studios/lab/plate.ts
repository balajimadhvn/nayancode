/** Plate-reader / ELISA analysis: blank subtraction, replicate statistics, a
 * standard curve (4PL, 5PL or linear) and back-calculation of unknowns.
 *
 * The grid is the raw plate as CSV (rows = A–H, columns = 1–12) and the layout
 * is a same-sized CSV of labels: `blank`, `std:<concentration>`,
 * `unk:<name>[:<dilution>]`.
 */
import { fitDoseResponse, type DrPoint } from './doseResponse';

export type CurveModel = '4PL' | '5PL' | 'linear';

export interface Well { row: number; col: number; label: string; value: number }

export interface Replicate {
  label: string;
  kind: 'blank' | 'std' | 'unk';
  name?: string;
  dilution?: number;
  concentration?: number;
  n: number;
  mean: number;
  sd: number;
  cv: number;
}

export interface StandardCurve {
  model: CurveModel;
  /** Predicted absorbance at a concentration. */
  at(x: number): number;
  /** Concentration at an absorbance (NaN outside the fitted range for 5PL). */
  invert(y: number): number;
  r2: number;
  n: number;
  params: { name: string; value: number; se: number; lo: number; hi: number }[];
  lo: number;
  hi: number;
  note: string;
}

export interface PlateResult {
  wells: Well[];
  blank: { n: number; mean: number; sd: number };
  lod: number;
  loq: number;
  curve: StandardCurve;
  replicates: Replicate[];
  unknowns: (Replicate & { absorbance: number; concRaw: number; conc: number; outOfRange: boolean; belowLod: boolean })[];
  warnings: string[];
}

const num = (s: string) => {
  const t = s.trim();
  if (!t || /^(na|nan|null|empty|-)$/i.test(t)) return NaN;
  return Number(t);
};

/** Parses a rectangular numeric CSV/TSV grid; cells that are not numbers become NaN. */
export function parseGrid(text: string): number[][] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
  if (!lines.length) throw new Error('The plate CSV is empty.');
  const sep = lines[0].includes('\t') ? '\t' : ',';
  return lines.map((l) => l.split(sep).map(num));
}

/** Parses a layout grid of labels (blanks allowed). */
export function parseLayout(text: string): string[][] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
  if (!lines.length) throw new Error('The layout CSV is empty.');
  const sep = lines[0].includes('\t') ? '\t' : ',';
  return lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
}

const sd = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

/** Mean, sample SD and coefficient of variation (%) of a set of replicate readings. */
export function replicateStats(values: number[]): { n: number; mean: number; sd: number; cv: number } {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return { n: 0, mean: NaN, sd: NaN, cv: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / v.length, s = sd(v);
  return { n: v.length, mean, sd: s, cv: mean !== 0 ? (s / Math.abs(mean)) * 100 : NaN };
}

function parseLabel(label: string): { kind: 'blank' | 'std' | 'unk'; name?: string; concentration?: number; dilution?: number } {
  const l = label.trim();
  if (!l) return { kind: 'blank' };
  if (/^blank$|^blk$|^b$/i.test(l)) return { kind: 'blank' };
  const m = l.match(/^(std|standard|unk|unknown)\s*[:;]\s*(.+)$/i);
  if (!m) throw new Error(`Unrecognised layout label "${label}". Use blank, std:<concentration> or unk:<name>[:<dilution>].`);
  const parts = m[2].split(':').map((s) => s.trim());
  if (/^std/i.test(m[1])) {
    const c = num(parts[0]);
    if (!Number.isFinite(c)) throw new Error(`Standard "${label}" has no numeric concentration.`);
    return { kind: 'std', concentration: c };
  }
  return { kind: 'unk', name: parts[0] || 'unknown', dilution: parts[1] !== undefined ? num(parts[1]) : undefined };
}

function linearFit(pts: DrPoint[]) {
  const n = pts.length, xb = pts.reduce((s, p) => s + p.x, 0) / n, yb = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) { sxy += (p.x - xb) * (p.y - yb); sxx += (p.x - xb) ** 2; syy += (p.y - yb) ** 2; }
  const slope = sxy / sxx, intercept = yb - slope * xb;
  const resid = pts.map((p) => p.y - (intercept + slope * p.x));
  const s2 = n > 2 ? resid.reduce((s, r) => s + r * r, 0) / (n - 2) : NaN;
  const seSlope = Math.sqrt(s2 / sxx), seInt = Math.sqrt(s2 * (1 / n + xb ** 2 / sxx));
  return { slope, intercept, seSlope, seInt, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : NaN, s2 };
}

/** Builds the standard curve from replicate means at each standard concentration. */
export function buildCurve(stds: Replicate[], model: CurveModel = '4PL'): StandardCurve {
  const pts: DrPoint[] = stds.filter((s) => Number.isFinite(s.concentration)).map((s) => ({ x: s.concentration!, y: s.mean }));
  if (pts.length < (model === 'linear' ? 2 : 4)) throw new Error(`Need at least ${model === 'linear' ? 2 : 4} standard concentrations to fit a ${model} curve (have ${pts.length}).`);
  const lo = Math.min(...pts.map((p) => p.x)), hi = Math.max(...pts.map((p) => p.x));
  if (model === 'linear') {
    const f = linearFit(pts);
    if (!Number.isFinite(f.slope) || f.slope === 0) throw new Error('The standards do not define a usable linear standard curve (zero slope).');
    return {
      model, r2: f.r2, n: pts.length, lo, hi,
      at: (x) => f.intercept + f.slope * x,
      invert: (y) => (y - f.intercept) / f.slope,
      params: [
        { name: 'intercept', value: f.intercept, se: f.seInt, lo: NaN, hi: NaN },
        { name: 'slope', value: f.slope, se: f.seSlope, lo: NaN, hi: NaN },
      ],
      note: 'Linear standard curve y = intercept + slope·concentration.',
    };
  }
  const fit = fitDoseResponse(pts, model);
  const at = (x: number) => fit.bottom + (fit.top - fit.bottom) / (1 + Math.exp(-fit.hill * (Math.log(x) - Math.log(fit.ec50)))) ** fit.asym;
  const invert = (y: number) => {
    if (model === '4PL') {
      const ratio = (y - fit.bottom) / (fit.top - y);
      if (!(ratio > 0) || fit.hill === 0) return NaN;
      return fit.ec50 * ratio ** (1 / fit.hill);
    }
    // 5PL: bisection on ln(concentration) over a wide bracket around the standards.
    const f = (x: number) => at(x) - y;
    let a = Math.log(Math.max(lo / 1000, 1e-12)), b = Math.log(hi * 1000);
    const fa = f(Math.exp(a)), fb = f(Math.exp(b));
    if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return NaN;
    for (let i = 0; i < 200; i++) {
      const m = (a + b) / 2, fm = f(Math.exp(m));
      if (fa * fm <= 0) b = m; else a = m;
    }
    return Math.exp((a + b) / 2);
  };
  const warnings = fit.warnings.length ? ` ${fit.warnings.join(' ')}` : '';
  return {
    model, r2: fit.r2, n: pts.length, lo, hi, at, invert,
    params: fit.params.map((p) => ({ name: p.name, value: p.value, se: p.se, lo: p.lo, hi: p.hi })),
    note: `${model} standard curve fitted by Levenberg–Marquardt.${warnings}`,
  };
}

/** Full plate analysis. Throws with a clear message when grid and layout differ in shape. */
export function analysePlate(plateText: string, layoutText: string, opt: { model?: CurveModel; dilutionDefault?: number } = {}): PlateResult {
  const grid = parseGrid(plateText), layout = parseLayout(layoutText);
  const rows = Math.max(grid.length, layout.length);
  const cols = Math.max(...grid.map((r) => r.length), ...layout.map((r) => r.length));
  if (grid.length !== layout.length || grid.some((r) => r.length !== layout[0].length) || layout.some((r) => r.length !== grid[0].length)) {
    throw new Error(`The plate is ${grid.length}×${grid[0]?.length ?? 0} but the layout is ${layout.length}×${layout[0]?.length ?? 0}; they must have the same shape.`);
  }
  const warnings: string[] = [];
  const wells: Well[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const label = layout[r]?.[c] ?? '', value = grid[r]?.[c] ?? NaN;
    if (!label || !Number.isFinite(value)) continue;
    wells.push({ row: r, col: c, label, value });
  }
  const blanks = wells.filter((w) => parseLabel(w.label).kind === 'blank');
  const blankMean = blanks.length ? blanks.reduce((s, w) => s + w.value, 0) / blanks.length : 0;
  const blankSd = sd(blanks.map((w) => w.value));
  if (!blanks.length) warnings.push('No blank wells in the layout: the blank was taken as zero.');

  const groups = new Map<string, Well[]>();
  for (const w of wells) {
    const k = parseLabel(w.label).kind === 'blank' ? 'blank' : w.label;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(w);
  }
  const replicates: Replicate[] = [];
  for (const [label, ws] of groups) {
    if (label === 'blank') continue;
    const info = parseLabel(label);
    const stats = replicateStats(ws.map((w) => w.value - blankMean));
    replicates.push({ label, kind: info.kind as 'std' | 'unk', name: info.name, concentration: info.concentration, dilution: info.dilution, ...stats });
  }
  const stds = replicates.filter((r) => r.kind === 'std').sort((a, b) => (a.concentration ?? 0) - (b.concentration ?? 0));
  if (!stds.length) throw new Error('No standard wells (std:<concentration>) in the layout.');
  if (stds.some((s) => !(s.mean > 0))) warnings.push('Some standards have a non-positive blank-corrected absorbance; a 4PL/5PL fit needs y > 0 for the asymptotes.');
  const curve = buildCurve(stds, opt.model ?? '4PL');

  const stdMeanLow = stds[0].mean, stdMeanHigh = stds[stds.length - 1].mean;
  const bandLo = Math.min(stdMeanLow, stdMeanHigh), bandHi = Math.max(stdMeanLow, stdMeanHigh);
  const invBlank = (y: number) => curve.invert(y);
  const lodAbs = blankMean + 3 * blankSd, loqAbs = blankMean + 10 * blankSd;
  const lod = invBlank(lodAbs), loq = invBlank(loqAbs);
  const unknowns = replicates.filter((r) => r.kind === 'unk').map((r) => {
    const concRaw = curve.invert(r.mean);
    const dilution = Number.isFinite(r.dilution) ? r.dilution! : (opt.dilutionDefault ?? 1);
    return { ...r, absorbance: r.mean, concRaw, conc: concRaw * dilution, outOfRange: !(r.mean >= bandLo && r.mean <= bandHi), belowLod: r.mean < lodAbs };
  });
  if (unknowns.some((u) => u.outOfRange)) warnings.push(`${unknowns.filter((u) => u.outOfRange).length} unknown(s) fall outside the standard range: their concentrations are extrapolations.`);
  if (replicates.some((r) => Number.isFinite(r.cv) && r.cv > 15)) warnings.push('At least one set of replicates has a CV above 15 %: check pipetting.');
  return { wells, blank: { n: blanks.length, mean: blankMean, sd: blankSd }, lod, loq, curve, replicates, unknowns, warnings };
}

/** A 16×24 plate this size is common; 8×12 is the default demo. */
export function demoPlate(): { plate: string; layout: string } {
  const model = (x: number) => 0.05 + (1.85 * x) / (12 + x);
  const stds = [1, 2, 4, 8, 16, 32, 64];
  const plate: number[][] = [], layout: string[][] = [];
  for (let r = 0; r < 8; r++) { plate.push(new Array(12).fill(NaN)); layout.push(new Array(12).fill('')); }
  const put = (r: number, c: number, label: string, value: number) => { plate[r][c] = value; layout[r][c] = label; };
  put(0, 0, 'blank', 0.048); put(0, 1, 'blank', 0.052); put(0, 2, 'blank', 0.05);
  stds.forEach((c, i) => { for (let k = 0; k < 3; k++) put(1, i, `std:${c}`, +model(c).toFixed(4)); });
  const samples: [string, number, number][] = [['Sample A', 0.62, 1], ['Sample B', 1.21, 10], ['Sample C', 1.79, 2]];
  samples.forEach(([name, a, dil], i) => { for (let k = 0; k < 3; k++) put(3, i, `unk:${name}:${dil}`, +(a + [0.01, -0.008, 0.004][k]).toFixed(4)); });
  const fmt = (g: (number | string)[][]) => g.map((r) => r.map((v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v)).join(',')).join('\n');
  return { plate: fmt(plate), layout: fmt(layout.map((r) => r.map((v) => v || ''))) };
}
