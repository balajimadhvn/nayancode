/**
 * Proteomics and metabolomics quantification: intensity-matrix I/O (including MaxQuant proteinGroups.txt),
 * missing-value summaries, log2 transformation, feature filtering, normalisation, imputation and a two-group
 * moderated t-test. The test reuses Expression Studio's limma-style engine (Smyth 2004) and Benjamini–Hochberg.
 * Missing values are NaN throughout; imputation returns a mask so the UI can mark filled cells.
 */
import { buildDesign, contrastTest, levelContrast, lmFit, moderate } from '../expression/linear';
import { clusterOrder, pca as pcaLogged, type Logged } from '../expression/kernels';

export interface QuantMatrix { ids: string[]; samples: string[]; values: Float64Array /* ids × samples, NaN = missing */ }

const unq = (s: string) => s.trim().replace(/^"|"$/g, '');
const isMissing = (s: string) => s === '' || /^(na|n\/a|nan|null|\.)$/i.test(s);

/** CSV/TSV intensity matrix: first column is the feature id, remaining columns are samples. Blank/NA/NaN and
 *  non-positive values are missing. MaxQuant proteinGroups.txt is detected from `LFQ intensity ` / `Intensity `
 *  columns (the prefix is stripped); rows flagged `+` in Reverse, Potential contaminant or Only identified by site
 *  are dropped. */
export function parseMatrix(text: string): QuantMatrix {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new Error('Matrix needs a header row and at least one feature row.');
  const d = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : /\s+/;
  const head = lines[0].split(d).map(unq);
  if (head.length < 2) throw new Error('Matrix needs a feature column and at least two sample columns.');
  const lfq = head.map((h, i) => [h, i] as const).filter(([h, i]) => i > 0 && h.startsWith('LFQ intensity '));
  const plain = head.map((h, i) => [h, i] as const).filter(([h, i]) => i > 0 && h.startsWith('Intensity '));
  const cols = lfq.length ? lfq : plain;
  const maxquant = cols.length > 0, sampleCols = maxquant ? cols.map(([, i]) => i) : head.map((_, i) => i).slice(1);
  const samples = maxquant ? cols.map(([h]) => h.replace(/^(LFQ intensity |Intensity )/, '')) : head.slice(1);
  if (samples.length < 2) throw new Error('Need at least two sample columns.');
  if (new Set(samples).size !== samples.length) throw new Error('Two sample columns have the same name.');
  const flags = maxquant ? ['Reverse', 'Potential contaminant', 'Only identified by site'].map((n) => head.indexOf(n)).filter((i) => i >= 0) : [];
  const ids: string[] = [], values: number[] = [];
  for (let r = 1; r < lines.length; r++) {
    const f = lines[r].split(d).map(unq);
    if (f.length !== head.length) throw new Error(`Line ${r + 1}: expected ${head.length} columns, found ${f.length}.`);
    if (flags.some((i) => f[i] === '+')) continue;
    ids.push(f[0] || `feature_${r}`);
    for (const c of sampleCols) {
      const v = isMissing(f[c]) ? NaN : Number(f[c]);
      values.push(Number.isFinite(v) && v > 0 ? v : NaN);
    }
  }
  if (!ids.length) throw new Error('No feature rows remain after removing flagged MaxQuant rows.');
  return { ids, samples, values: Float64Array.from(values) };
}

export interface MissingnessSummary {
  perSample: { sample: string; missing: number; pct: number }[];
  perFeature: { id: string; missing: number; pct: number }[];
}

export function missingnessSummary(m: QuantMatrix): MissingnessSummary {
  const S = m.samples.length, G = m.ids.length;
  const perSample = m.samples.map((sample, j) => {
    let n = 0; for (let i = 0; i < G; i++) if (Number.isNaN(m.values[i * S + j])) n++;
    return { sample, missing: n, pct: (100 * n) / G };
  });
  const perFeature = m.ids.map((id, i) => {
    let n = 0; for (let j = 0; j < S; j++) if (Number.isNaN(m.values[i * S + j])) n++;
    return { id, missing: n, pct: (100 * n) / S };
  });
  return { perSample, perFeature };
}

/** log2 of positive intensities; zeros, negatives and missing stay missing. A pseudocount of 1 can be added first. */
export function log2Transform(m: QuantMatrix, opts: { addPseudocount?: boolean } = {}): QuantMatrix {
  const add = opts.addPseudocount ? 1 : 0;
  return { ids: [...m.ids], samples: [...m.samples], values: Float64Array.from(m.values, (v) => (v > 0 ? Math.log2(v + add) : NaN)) };
}

const subset = (m: QuantMatrix, keep: number[]): QuantMatrix => {
  const S = m.samples.length, values = new Float64Array(keep.length * S);
  keep.forEach((g, i) => values.set(m.values.subarray(g * S, g * S + S), i * S));
  return { ids: keep.map((g) => m.ids[g]), samples: [...m.samples], values };
};

/** Keep a feature when at least one group has `minValidPerGroup` observed values. */
export function filterFeatures(m: QuantMatrix, groups: string[], minValidPerGroup = 2): QuantMatrix {
  if (groups.length !== m.samples.length) throw new Error(`The sample sheet has ${groups.length} groups for ${m.samples.length} samples.`);
  const S = m.samples.length, levels = [...new Set(groups)];
  const keep: number[] = [];
  for (let g = 0; g < m.ids.length; g++) {
    const count = new Map<string, number>();
    for (let j = 0; j < S; j++) if (!Number.isNaN(m.values[g * S + j])) count.set(groups[j], (count.get(groups[j]) ?? 0) + 1);
    if (levels.some((l) => (count.get(l) ?? 0) >= minValidPerGroup)) keep.push(g);
  }
  return subset(m, keep);
}

function medianSorted(a: number[]): number {
  if (!a.length) return NaN;
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}
const median = (a: number[]) => medianSorted([...a].sort((x, y) => x - y));

/** Linear-interpolated quantile of a sorted array, p in [0, 1]. */
function quantileSorted(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  if (sorted.length === 1) return sorted[0];
  const h = Math.max(0, Math.min(1, p)) * (sorted.length - 1), lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export type NormMethod = 'none' | 'median' | 'quantile';

/** Median centring (subtract each sample median, add the grand median) or quantile normalisation with ties
 *  averaged. Missing values are ignored and stay missing. */
export function normalise(m: QuantMatrix, method: NormMethod): QuantMatrix {
  const S = m.samples.length, G = m.ids.length, out = Float64Array.from(m.values);
  if (method === 'none') return { ids: [...m.ids], samples: [...m.samples], values: out };
  const cols = Array.from({ length: S }, (_, j) => {
    const obs: { i: number; v: number }[] = [];
    for (let i = 0; i < G; i++) { const v = m.values[i * S + j]; if (!Number.isNaN(v)) obs.push({ i, v }); }
    return obs.sort((a, b) => a.v - b.v);
  });
  if (method === 'median') {
    const all = cols.flatMap((c) => c.map((o) => o.v));
    if (!all.length) throw new Error('No observed values to normalise.');
    const grand = median(all);
    cols.forEach((c, j) => { const med = median(c.map((o) => o.v)); for (const o of c) out[o.i * S + j] = o.v - med + grand; });
    return { ids: [...m.ids], samples: [...m.samples], values: out };
  }
  if (method !== 'quantile') throw new Error(`Unknown normalisation “${method as string}”.`);
  const L = Math.max(...cols.map((c) => c.length));
  if (!L) throw new Error('No observed values to normalise.');
  const ref = new Float64Array(L);
  for (let k = 0; k < L; k++) {
    const p = L > 1 ? k / (L - 1) : 0;
    let sum = 0, n = 0;
    for (const c of cols) if (c.length) { sum += quantileSorted(c.map((o) => o.v), p); n++; }
    ref[k] = sum / n;
  }
  const at = (p: number) => { if (L === 1) return ref[0]; const h = Math.max(0, Math.min(1, p)) * (L - 1), lo = Math.floor(h), hi = Math.ceil(h); return ref[lo] + (h - lo) * (ref[hi] - ref[lo]); };
  cols.forEach((c, j) => {
    const n = c.length;
    for (let lo = 0; lo < n;) {
      let hi = lo;
      while (hi + 1 < n && c[hi + 1].v === c[lo].v) hi++;
      let target = 0;
      for (let k = lo; k <= hi; k++) target += at(n > 1 ? k / (n - 1) : 0);
      target /= hi - lo + 1;
      for (let k = lo; k <= hi; k++) out[c[k].i * S + j] = target;
      lo = hi + 1;
    }
  });
  return { ids: [...m.ids], samples: [...m.samples], values: out };
}

export type ImputeMethod = 'none' | 'minprob' | 'knn' | 'halfmin';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normalDraw(rnd: () => number): number {
  let u = 0;
  while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

export interface ImputeOptions { seed?: number; k?: number }

/** Fills missing cells and returns a mask (1 = filled). Observed values are never changed.
 *  halfmin: half the feature minimum; minprob: left-censored normal at the 1 % quantile with σ = 0.3 × median
 *  feature SD; knn: mean of the k nearest well-observed features (≥ 70 % observed). */
export function impute(m: QuantMatrix, method: ImputeMethod, opts: ImputeOptions = {}): { matrix: QuantMatrix; mask: Uint8Array } {
  const S = m.samples.length, G = m.ids.length, values = Float64Array.from(m.values), mask = new Uint8Array(G * S);
  if (method === 'none') return { matrix: { ids: [...m.ids], samples: [...m.samples], values }, mask };
  const all: number[] = [];
  for (const v of values) if (!Number.isNaN(v)) all.push(v);
  if (!all.length) throw new Error('No observed values to base imputation on.');
  const sortedAll = [...all].sort((a, b) => a - b);
  const globalMin = sortedAll[0];
  const featureMean = (i: number) => {
    let s = 0, n = 0; for (let j = 0; j < S; j++) { const v = m.values[i * S + j]; if (!Number.isNaN(v)) { s += v; n++; } }
    return n ? s / n : NaN;
  };
  if (method === 'halfmin') {
    for (let i = 0; i < G; i++) {
      let min = Infinity;
      for (let j = 0; j < S; j++) { const v = m.values[i * S + j]; if (!Number.isNaN(v) && v < min) min = v; }
      const fill = (Number.isFinite(min) ? min : globalMin) / 2;
      for (let j = 0; j < S; j++) if (Number.isNaN(values[i * S + j])) { values[i * S + j] = fill; mask[i * S + j] = 1; }
    }
    return { matrix: { ids: [...m.ids], samples: [...m.samples], values }, mask };
  }
  if (method === 'minprob') {
    const mu = quantileSorted(sortedAll, 0.01);
    const sds: number[] = [];
    for (let i = 0; i < G; i++) {
      let s = 0, ss = 0, n = 0;
      for (let j = 0; j < S; j++) { const v = m.values[i * S + j]; if (!Number.isNaN(v)) { s += v; ss += v * v; n++; } }
      if (n > 1) sds.push(Math.sqrt(Math.max(0, (ss - (s * s) / n) / (n - 1))));
    }
    let sigma = 0.3 * median(sds);
    if (!(sigma > 0)) sigma = 0.1 * Math.sqrt(Math.max(0, sortedAll.reduce((a, v) => a + (v - median(sortedAll)) ** 2, 0) / Math.max(1, sortedAll.length - 1)));
    if (!(sigma > 0)) sigma = 0.01;
    const rnd = mulberry32(opts.seed ?? 1);
    for (let i = 0; i < G; i++) for (let j = 0; j < S; j++) if (Number.isNaN(values[i * S + j])) { values[i * S + j] = mu + sigma * normalDraw(rnd); mask[i * S + j] = 1; }
    return { matrix: { ids: [...m.ids], samples: [...m.samples], values }, mask };
  }
  if (method !== 'knn') throw new Error(`Unknown imputation “${method as string}”.`);
  const k = Math.max(1, Math.round(opts.k ?? 10)), donors: number[] = [];
  for (let i = 0; i < G; i++) { let n = 0; for (let j = 0; j < S; j++) if (!Number.isNaN(m.values[i * S + j])) n++; if (n >= 0.7 * S) donors.push(i); }
  for (let i = 0; i < G; i++) {
    const miss: number[] = [];
    for (let j = 0; j < S; j++) if (Number.isNaN(values[i * S + j])) miss.push(j);
    if (!miss.length) continue;
    const near = donors.filter((d) => d !== i).map((d) => {
      let s = 0, n = 0;
      for (let j = 0; j < S; j++) { const a = m.values[i * S + j], b = m.values[d * S + j]; if (!Number.isNaN(a) && !Number.isNaN(b)) { s += (a - b) ** 2; n++; } }
      return { d, dist: n ? s : Infinity };
    }).filter((o) => Number.isFinite(o.dist)).sort((a, b) => a.dist - b.dist).slice(0, k);
    const fallback = featureMean(i);
    for (const j of miss) {
      const avail = near.filter((o) => !Number.isNaN(m.values[o.d * S + j]));
      values[i * S + j] = avail.length ? avail.reduce((a, o) => a + m.values[o.d * S + j], 0) / avail.length : (Number.isFinite(fallback) ? fallback : median(sortedAll));
      mask[i * S + j] = 1;
    }
  }
  return { matrix: { ids: [...m.ids], samples: [...m.samples], values }, mask };
}

export interface Contrast { numerator: string; denominator: string }
export interface DiffRow { id: string; logFC: number; avg: number; t: number; p: number; fdr: number; sig: 'up' | 'down' | 'ns'; nA: number; nB: number }
export interface DiffResult { rows: DiffRow[]; tested: number; excluded: number; priorDf: number; contrast: Contrast }
export interface DiffOptions { imputed?: Uint8Array; fdr?: number; lfc?: number; imputedWeight?: number }

/** Two-group moderated t-test (Expression Studio's limma-style engine) with BH FDR. Features with fewer than two
 *  observed values in either group, or (when no imputation was run) any remaining missing value, are excluded.
 *  Imputed cells enter the weighted fit with a small weight (default 0.05) so that left-censored filler values
 *  cannot dominate the residual variance of a feature with only a few missing cells. */
export function differential(m: QuantMatrix, groups: string[], contrast: Contrast, opts: DiffOptions = {}): DiffResult {
  const S = m.samples.length, G = m.ids.length;
  if (groups.length !== S) throw new Error(`The sample sheet has ${groups.length} groups for ${S} samples.`);
  const { numerator: A, denominator: B } = contrast;
  if (A === B) throw new Error('Choose two different groups for the contrast.');
  const use = groups.map((g, j) => (g === A || g === B ? j : -1)).filter((j) => j >= 0);
  const grp = use.map((j) => groups[j]);
  if (!grp.includes(A) || !grp.includes(B)) throw new Error(`The contrast groups must both occur in the sample sheet.`);
  const design = buildDesign([{ name: 'group', kind: 'factor', values: grp, reference: B }], use.length);
  const c = levelContrast(design, 'group', B, A); // A − B
  const ids: string[] = [], kept: number[] = [], nA: number[] = [], nB: number[] = [];
  let excluded = 0;
  for (let i = 0; i < G; i++) {
    let a = 0, b = 0, complete = true;
    for (let j = 0; j < S; j++) {
      const observed = opts.imputed ? !opts.imputed[i * S + j] && !Number.isNaN(m.values[i * S + j]) : !Number.isNaN(m.values[i * S + j]);
      if (observed) { if (groups[j] === A) a++; else if (groups[j] === B) b++; }
    }
    for (const j of use) if (Number.isNaN(m.values[i * S + j])) complete = false;
    if (a < 2 || b < 2 || !complete) { excluded++; continue; }
    ids.push(m.ids[i]); kept.push(i); nA.push(a); nB.push(b);
  }
  if (!ids.length) throw new Error('No feature has at least two observed values in both groups.');
  const y = new Float64Array(ids.length * use.length);
  kept.forEach((g, r) => use.forEach((j, s) => { y[r * use.length + s] = m.values[g * S + j]; }));
  let w: Float64Array | null = null;
  if (opts.imputed) {
    const wi = opts.imputedWeight ?? 0.05;
    if (!(wi > 0 && wi <= 1)) throw new Error('imputedWeight must be in (0, 1].');
    w = new Float64Array(ids.length * use.length).fill(1);
    kept.forEach((g, r) => use.forEach((j, s) => { if (opts.imputed![g * S + j]) w![r * use.length + s] = wi; }));
  }
  const fit = lmFit(y, w, ids, design), eb = moderate(fit);
  const tests = contrastTest(fit, eb, c, { fdr: opts.fdr ?? 0.05, lfc: opts.lfc ?? 0 });
  const rows = tests.map((t, r) => ({ id: t.gene, logFC: t.logFC, avg: t.avgExpr, t: t.t, p: t.p, fdr: t.fdr, sig: t.sig, nA: nA[r], nB: nB[r] }));
  return { rows, tested: rows.length, excluded, priorDf: eb.d0, contrast };
}

/** PCA of samples over the top-variance features (reuses the expression Gram/Jacobi implementation). */
export function quantPca(m: QuantMatrix, nPc = 3): { scores: number[][]; varExplained: number[]; nFeatures: number } {
  for (const v of m.values) if (!Number.isNaN(v)) continue; else throw new Error('Impute missing values before PCA.');
  const S = m.samples.length;
  const logged: Logged = { genes: m.ids, samples: m.samples, x: m.values, norm: m.values, sf: new Float64Array(S).fill(1), libSize: new Array(S).fill(0), detected: new Array(S).fill(0) };
  const r = pcaLogged(logged, 500, nPc);
  return { scores: r.scores, varExplained: r.varExplained, nFeatures: r.nGenes };
}

/** Row z-scores of the top-variance features, ordered by UPGMA clustering (1 − Pearson r). */
export function heatmap(m: QuantMatrix, topN = 40): { rows: string[]; cols: string[]; z: number[][] } {
  const S = m.samples.length, G = m.ids.length;
  for (const v of m.values) if (Number.isNaN(v)) throw new Error('Impute missing values before clustering.');
  const vars: { g: number; v: number }[] = [];
  for (let g = 0; g < G; g++) {
    let mean = 0; for (let j = 0; j < S; j++) mean += m.values[g * S + j]; mean /= S;
    let ss = 0; for (let j = 0; j < S; j++) ss += (m.values[g * S + j] - mean) ** 2;
    vars.push({ g, v: ss / Math.max(1, S - 1) });
  }
  const keep = vars.filter((o) => o.v > 0).sort((a, b) => b.v - a.v).slice(0, topN);
  if (!keep.length) throw new Error('All features have zero variance.');
  const zRows = keep.map(({ g }) => {
    let mean = 0; for (let j = 0; j < S; j++) mean += m.values[g * S + j]; mean /= S;
    let ss = 0; for (let j = 0; j < S; j++) ss += (m.values[g * S + j] - mean) ** 2;
    const sd = Math.sqrt(ss / Math.max(1, S - 1)) || 1;
    return Float64Array.from({ length: S }, (_, j) => (m.values[g * S + j] - mean) / sd);
  });
  const order = clusterOrder(zRows);
  return { rows: order.map((k) => m.ids[keep[k].g]), cols: [...m.samples], z: order.map((k) => Array.from(zRows[k])) };
}

export interface QuantDemo { matrix: string; sheet: string; planted: Set<string>; samples: string[]; groups: string[] }

/** Simulated label-free experiment: 600 features × 6 samples (3 vs 3), log-normal intensities, 10 % missing
 *  completely at random and left-censoring below the 10th percentile; 40 features are up by 2 log2 in group B. */
export function simulateQuantDemo(opts: { seed?: number; features?: number; planted?: number; effect?: number; noise?: number; mcar?: number; censorQuantile?: number } = {}): QuantDemo {
  const G = opts.features ?? 600, planted = opts.planted ?? 40, effect = opts.effect ?? 2, noise = opts.noise ?? 0.35;
  const mcar = opts.mcar ?? 0.1, censor = opts.censorQuantile ?? 0.1, rnd = mulberry32(opts.seed ?? 20261023);
  const groups = ['Control', 'Control', 'Control', 'Treated', 'Treated', 'Treated'];
  const samples = ['CTRL_1', 'CTRL_2', 'CTRL_3', 'TREAT_1', 'TREAT_2', 'TREAT_3'];
  const sEffect = samples.map(() => 0.25 * normalDraw(rnd));
  const ids = Array.from({ length: G }, (_, i) => `FEAT_${String(i + 1).padStart(4, '0')}`);
  const truth = new Set(ids.slice(0, planted));
  const raw: number[][] = ids.map((id) => {
    const base = 28 + 0.75 * normalDraw(rnd);
    return samples.map((_, j) => 2 ** (base + sEffect[j] + (truth.has(id) && groups[j] === 'Treated' ? effect : 0) + noise * normalDraw(rnd)));
  });
  const finite = raw.flat().filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const q = quantileSorted(finite, censor);
  const lines = ['feature,' + samples.join(',')];
  ids.forEach((id, i) => lines.push(id + ',' + raw[i].map((v) => (v <= q || rnd() < mcar ? '' : v.toFixed(0))).join(',')));
  return { matrix: lines.join('\n'), sheet: 'sample,group\n' + samples.map((s, j) => `${s},${groups[j]}`).join('\n'), planted: truth, samples, groups };
}
