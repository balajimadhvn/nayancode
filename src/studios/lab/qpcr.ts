import { pfUpper, pt, qt } from './dist';

/**
 * qPCR relative quantification. One code path covers Livak ΔΔCt (E = 2) and efficiency-corrected Pfaffl:
 *   Q_i = E_target^(−Ct_target) / NF_i,   NF_i = geometric mean over reference genes of E_ref^(−Ct_ref)
 *   x_i = −log2 Q_i                       (= ΔCt when every E = 2, with the mean Ct of the reference genes)
 *   ΔΔCt_i = x_i − mean(x_control),  fold_i = 2^(−ΔΔCt_i)
 * Pfaffl's ratio E_t^ΔCt_t / E_r^ΔCt_r (control − sample) is the same quantity with the control mean as calibrator.
 */
export interface PlateRow { sample: string; group: string; gene: string; ct: number; well?: string }

const num = (s: string) => { const t = s.trim(); if (!t || /^(undetermined|nan|na|n\/a|-)$/i.test(t)) return NaN; const v = Number(t); return Number.isFinite(v) ? v : NaN; };

/** Plate CSV/TSV. Long format: sample[,group],gene,ct[,well]. Wide format: sample[,group], one column per gene. Replicates are repeated rows. */
export function parsePlate(text: string): { rows: PlateRow[]; undetermined: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('Plate file needs a header row and data rows.');
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const split = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]), low = head.map((h) => h.toLowerCase());
  const find = (re: RegExp) => low.findIndex((h) => re.test(h));
  const si = find(/^(sample|sample.?name|name|id|biological.?sample)$/), gi = find(/^(group|condition|treatment|class|genotype)$/), wi = find(/^well$/);
  const ti = find(/^(gene|target|detector|assay|primer)$/), ci = find(/^(ct|cq|cp|c_t|ct.?value)$/);
  if (si < 0) throw new Error('No sample column found (expected a header such as "sample").');
  const rows: PlateRow[] = []; let undetermined = 0;
  if (ti >= 0 && ci >= 0) {
    for (const l of lines.slice(1)) { const c = split(l), ct = num(c[ci] ?? ''); if (!Number.isFinite(ct)) { undetermined++; continue; } rows.push({ sample: c[si], group: gi >= 0 ? c[gi] : c[si], gene: c[ti], ct, well: wi >= 0 ? c[wi] : undefined }); }
  } else {
    const genes = head.map((h, i) => ({ h, i })).filter((x) => x.i !== si && x.i !== gi && x.i !== wi);
    if (!genes.length) throw new Error('No gene columns found.');
    for (const l of lines.slice(1)) { const c = split(l); for (const g of genes) { const ct = num(c[g.i] ?? ''); if (!Number.isFinite(ct)) { if ((c[g.i] ?? '').trim()) undetermined++; continue; } rows.push({ sample: c[si], group: gi >= 0 ? c[gi] : c[si], gene: g.h, ct, well: wi >= 0 ? c[wi] : undefined }); } }
  }
  if (!rows.length) throw new Error('No numeric Ct values found.');
  return { rows, undetermined };
}

// ---------------------------------------------------------------- technical replicates
export interface Cell { sample: string; group: string; gene: string; values: number[]; flagged: boolean[]; used: number[]; mean: number; sd: number; note: string }
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
export const sd = (a: number[]) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

/**
 * Averages technical replicates per sample × gene and flags outliers: with ≥ 3 replicates, a value further than `delta`
 * cycles from the median; with 2, both when they differ by more than `delta`; SD > `maxSd` is noted as well.
 */
export function averageReplicates(rows: PlateRow[], opts: { delta?: number; maxSd?: number; exclude?: boolean } = {}): Cell[] {
  const delta = opts.delta ?? 0.5, maxSd = opts.maxSd ?? 0.3, map = new Map<string, PlateRow[]>();
  for (const r of rows) { const k = `${r.sample}\u0000${r.gene}`; (map.get(k) ?? map.set(k, []).get(k)!).push(r); }
  return [...map.values()].map((rs) => {
    const values = rs.map((r) => r.ct), med = median(values);
    const flagged = values.length >= 3 ? values.map((v) => Math.abs(v - med) > delta) : values.length === 2 ? values.map(() => Math.abs(values[0] - values[1]) > delta) : values.map(() => false);
    const keep = values.map((_, i) => i).filter((i) => !(opts.exclude && values.length >= 3 && flagged[i]));
    const used = keep.map((i) => values[i]), s = sd(used);
    const notes: string[] = [];
    if (flagged.some(Boolean)) notes.push(values.length >= 3 ? `outlier ${values.filter((_, i) => flagged[i]).map((v) => v.toFixed(2)).join(', ')} (> ${delta} from median)` : `duplicates differ by ${Math.abs(values[0] - values[1]).toFixed(2)}`);
    if (s > maxSd) notes.push(`SD ${s.toFixed(2)} > ${maxSd}`);
    if (values.length === 1) notes.push('single replicate');
    return { sample: rs[0].sample, group: rs[0].group, gene: rs[0].gene, values, flagged, used, mean: mean(used), sd: s, note: notes.join('; ') };
  });
}

// ---------------------------------------------------------------- statistics
export interface TTest { t: number; df: number; p: number; diff: number; lo: number; hi: number }
export function tTest(a: number[], b: number[], equalVar = false): TTest {
  const na = a.length, nb = b.length, ma = mean(a), mb = mean(b), va = sd(a) ** 2, vb = sd(b) ** 2;
  let se: number, df: number;
  if (equalVar) { const sp = ((na - 1) * va + (nb - 1) * vb) / (na + nb - 2); se = Math.sqrt(sp * (1 / na + 1 / nb)); df = na + nb - 2; }
  else { se = Math.sqrt(va / na + vb / nb); df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1)); }
  const t = (ma - mb) / se, p = 2 * pt(-Math.abs(t), df), h = qt(0.975, df) * se;
  return { t, df, p, diff: ma - mb, lo: ma - mb - h, hi: ma - mb + h };
}
export function anova1(groups: number[][]): { F: number; df1: number; df2: number; p: number } {
  const all = groups.flat(), N = all.length, k = groups.length, gm = mean(all);
  const ssb = groups.reduce((s, g) => s + g.length * (mean(g) - gm) ** 2, 0), ssw = groups.reduce((s, g) => s + g.reduce((q, v) => q + (v - mean(g)) ** 2, 0), 0);
  const df1 = k - 1, df2 = N - k, F = ssb / df1 / (ssw / df2);
  return { F, df1, df2, p: pfUpper(F, df1, df2) };
}
export function holm(p: number[]): number[] {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b]), out = new Array<number>(p.length); let run = 0;
  idx.forEach((i, r) => { run = Math.max(run, Math.min(1, (p.length - r) * p[i])); out[i] = run; });
  return out;
}

// ---------------------------------------------------------------- relative quantification
export interface QpcrParams {
  refGenes: string[]; controlGroup: string;
  /** Amplification efficiency per gene as a factor (2 = 100 %); genes not listed use 2. */
  efficiency?: Record<string, number>;
  /** Pair target and reference wells by the `well` column before averaging (Livak's same-well design). */
  pairedWells?: boolean;
  equalVar?: boolean; delta?: number; excludeOutliers?: boolean; maxSd?: number;
}
export interface SampleValue { sample: string; group: string; x: number; ddct: number; fold: number; /** SD of the per-well ΔCt (paired wells only) */ sdWells?: number }
export interface GroupStat { group: string; n: number; meanX: number; sdX: number; semX: number; ddct: number; fold: number; foldLo: number; foldHi: number; foldSemLo: number; foldSemHi: number; p?: number; pAdj?: number; t?: number; df?: number }
export interface GeneResult { gene: string; efficiency: number; samples: SampleValue[]; groups: GroupStat[]; anova?: { F: number; df1: number; df2: number; p: number } }
export interface QpcrResult { genes: GeneResult[]; cells: Cell[]; warnings: string[]; refCt: Map<string, number> }

export function relativeQuantification(rows: PlateRow[], prm: QpcrParams): QpcrResult {
  const E = (g: string) => prm.efficiency?.[g] ?? 2, warnings: string[] = [];
  const cells = averageReplicates(rows, { delta: prm.delta, maxSd: prm.maxSd, exclude: prm.excludeOutliers });
  const samples = [...new Map(cells.map((c) => [c.sample, c.group])).entries()], genes = [...new Set(cells.map((c) => c.gene))];
  for (const r of prm.refGenes) if (!genes.includes(r)) throw new Error(`Reference gene "${r}" is not in the data (genes: ${genes.join(', ')}).`);
  if (!prm.refGenes.length) throw new Error('Select at least one reference gene.');
  if (!samples.some(([, g]) => g === prm.controlGroup)) throw new Error(`Control group "${prm.controlGroup}" is not in the data.`);
  const cellOf = (s: string, g: string) => cells.find((c) => c.sample === s && c.gene === g);
  const targets = genes.filter((g) => !prm.refGenes.includes(g));
  const log2NF = (s: string, wellVals?: Map<string, number[]>, w?: number): number => {
    // log2 of the geometric mean of the reference quantities
    const v = prm.refGenes.map((r) => { const ct = wellVals ? wellVals.get(`${s}\u0000${r}`)![w!] : cellOf(s, r)?.mean; return ct === undefined ? NaN : -ct * Math.log2(E(r)); });
    return mean(v);
  };
  const out: GeneResult[] = [];
  const refCt = new Map<string, number>();
  for (const t of targets) {
    const xs: { sample: string; group: string; x: number; sdWells?: number }[] = [];
    for (const [s, g] of samples) {
      const tc = cellOf(s, t); if (!tc || !Number.isFinite(tc.mean)) { warnings.push(`${t}: no Ct for sample ${s}`); continue; }
      if (prm.refGenes.some((r) => !cellOf(s, r) || !Number.isFinite(cellOf(s, r)!.mean))) { warnings.push(`${t}: sample ${s} is missing a reference gene`); continue; }
      let x: number, sdWells: number | undefined;
      if (prm.pairedWells) {
        const wells = rows.filter((r) => r.sample === s && r.gene === t).map((r) => r.well);
        if (wells.some((w) => w === undefined)) throw new Error('Paired wells need a "well" column.');
        const get = (gene: string) => new Map(rows.filter((r) => r.sample === s && r.gene === gene).map((r) => [r.well!, r.ct]));
        const tm = get(t), rm = prm.refGenes.map((r) => get(r)), xsw: number[] = [];
        for (const [w, ct] of tm) { if (rm.every((m) => m.has(w))) xsw.push(-(-ct * Math.log2(E(t)) - mean(rm.map((m, i) => -m.get(w)! * Math.log2(E(prm.refGenes[i])))))); }
        if (!xsw.length) { warnings.push(`${t}: sample ${s} has no paired wells`); continue; }
        x = mean(xsw); sdWells = sd(xsw);
      } else x = -(-tc.mean * Math.log2(E(t)) - log2NF(s));
      xs.push({ sample: s, group: g, x, sdWells });
    }
    const ctrl = xs.filter((v) => v.group === prm.controlGroup).map((v) => v.x), cMean = mean(ctrl);
    const sv: SampleValue[] = xs.map((v) => ({ ...v, ddct: v.x - cMean, fold: 2 ** -(v.x - cMean) }));
    const groupNames = [...new Set(xs.map((v) => v.group))].sort((a, b) => (a === prm.controlGroup ? -1 : b === prm.controlGroup ? 1 : 0));
    const stats: GroupStat[] = groupNames.map((g) => {
      const v = xs.filter((q) => q.group === g).map((q) => q.x), m = mean(v), s = sd(v), sem = s / Math.sqrt(v.length), dd = m - cMean;
      const r: GroupStat = { group: g, n: v.length, meanX: m, sdX: s, semX: sem, ddct: dd, fold: 2 ** -dd, foldLo: 2 ** -(dd + (s || 0)), foldHi: 2 ** -(dd - (s || 0)), foldSemLo: 2 ** -(dd + (sem || 0)), foldSemHi: 2 ** -(dd - (sem || 0)) };
      if (g !== prm.controlGroup && v.length >= 2 && ctrl.length >= 2) { const tt = tTest(v, ctrl, prm.equalVar); r.p = tt.p; r.t = tt.t; r.df = tt.df; }
      return r;
    });
    const tested = stats.filter((s) => s.p !== undefined), adj = holm(tested.map((s) => s.p!)); tested.forEach((s, i) => { s.pAdj = adj[i]; });
    const groupsX = groupNames.map((g) => xs.filter((q) => q.group === g).map((q) => q.x));
    const an = groupNames.length >= 3 && groupsX.every((a) => a.length >= 2) ? anova1(groupsX) : undefined;
    if (stats.some((s) => s.n < 3)) warnings.push(`${t}: some groups have fewer than 3 biological replicates; tests have little power.`);
    out.push({ gene: t, efficiency: E(t), samples: sv, groups: stats, anova: an });
  }
  for (const r of prm.refGenes) refCt.set(r, mean(cells.filter((c) => c.gene === r).map((c) => c.mean)));
  return { genes: out, cells, warnings: [...new Set(warnings)], refCt };
}

// ---------------------------------------------------------------- Pfaffl ratio for a single pair of conditions
/** Pfaffl (2001) eq. 1 from mean crossing points of control and sample. */
export function pfaffl(eTarget: number, ctTargetControl: number, ctTargetSample: number, eRef: number, ctRefControl: number, ctRefSample: number): number {
  return eTarget ** (ctTargetControl - ctTargetSample) / eRef ** (ctRefControl - ctRefSample);
}

// ---------------------------------------------------------------- reference-gene stability (geNorm, Vandesompele et al. 2002)
export interface GeNormStep { genes: string[]; M: number[]; meanM: number; removed?: string; variation?: number }
export interface GeNormResult { steps: GeNormStep[]; ranking: string[] }
/** Relative quantities a[gene][sample] (any positive scale). Genes are removed one at a time, largest M first. */
export function geNorm(a: number[][], names: string[]): GeNormResult {
  const logs = a.map((r) => r.map((v) => Math.log2(v)));
  const Mof = (idx: number[]) => idx.map((j) => mean(idx.filter((k) => k !== j).map((k) => sd(logs[j].map((v, i) => v - logs[k][i])))));
  let idx = names.map((_, i) => i); const steps: GeNormStep[] = [], removedOrder: string[] = [];
  const nf = (ids: number[]) => logs[0].map((_, i) => mean(ids.map((j) => logs[j][i])));
  while (idx.length >= 2) {
    const M = Mof(idx), worst = M.indexOf(Math.max(...M)), st: GeNormStep = { genes: idx.map((i) => names[i]), M, meanM: mean(M) };
    if (idx.length > 2) { st.removed = names[idx[worst]]; const next = idx.filter((_, k) => k !== worst), a1 = nf(idx), a2 = nf(next); st.variation = sd(a1.map((v, i) => v - a2[i])); removedOrder.push(st.removed); idx = next; }
    else { steps.push(st); break; }
    steps.push(st);
  }
  const last = steps[steps.length - 1];
  return { steps, ranking: [...last.genes, ...removedOrder.reverse()] };
}
/** Ct matrix [gene][sample] and per-gene efficiencies → relative quantities. */
export const ctToQuantity = (ct: number[][], eff: number[]) => ct.map((r, g) => r.map((c) => eff[g] ** -c));

// ---------------------------------------------------------------- standard curve
export interface StdCurve { slope: number; intercept: number; r2: number; efficiency: number; effPct: number; n: number; slopeLo: number; slopeHi: number; effLoPct: number; effHiPct: number; warnings: string[] }
/** Ct = intercept + slope · log10(quantity); E = 10^(−1/slope) − 1 (1 = 100 %). */
export function standardCurve(points: { quantity: number; ct: number }[]): StdCurve {
  const p = points.filter((q) => q.quantity > 0 && Number.isFinite(q.ct)), n = p.length, x = p.map((q) => Math.log10(q.quantity)), y = p.map((q) => q.ct);
  if (n < 3 || new Set(x).size < 3) throw new Error('A standard curve needs at least three distinct dilutions.');
  const mx = mean(x), my = mean(y), sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0), sxy = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0), slope = sxy / sxx, intercept = my - slope * mx;
  const rss = y.reduce((s, v, i) => s + (v - intercept - slope * x[i]) ** 2, 0), tss = y.reduce((s, v) => s + (v - my) ** 2, 0), se = Math.sqrt(rss / (n - 2) / sxx), h = qt(0.975, n - 2) * se;
  const eff = (s: number) => 10 ** (-1 / s) - 1, warnings: string[] = [];
  const e = eff(slope); if (e < 0.9 || e > 1.1) warnings.push(`Efficiency ${(e * 100).toFixed(1)} % is outside the usual 90–110 % window.`);
  if (1 - rss / tss < 0.98) warnings.push('R² < 0.98: check pipetting, dilution series and outlying points.');
  const lo = eff(slope + h), hi = eff(slope - h);
  return { slope, intercept, r2: 1 - rss / tss, efficiency: e, effPct: e * 100, n, slopeLo: slope - h, slopeHi: slope + h, effLoPct: Math.min(lo, hi) * 100, effHiPct: Math.max(lo, hi) * 100, warnings };
}
