/** Bulk RNA-seq kernels: normalisation, PCA, limma-style moderated-t DE, BH FDR. Pure TS. */

export interface CountMatrix { genes: string[]; samples: string[]; counts: Float64Array /* genes × samples, row-major */ }

export function parseMatrix(text: string): CountMatrix {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new Error('Matrix needs a header row and at least one gene row.');
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : /\s+/;
  const split = (l: string) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]);
  const samples = head.slice(1);
  if (samples.length < 2) throw new Error('Need at least two sample columns.');
  const genes: string[] = [];
  const counts = new Float64Array((lines.length - 1) * samples.length);
  for (let r = 1; r < lines.length; r++) {
    const f = split(lines[r]);
    if (f.length !== head.length) throw new Error(`Line ${r + 1}: expected ${head.length} columns, found ${f.length}.`);
    genes.push(f[0]);
    for (let c = 0; c < samples.length; c++) {
      const v = Number(f[c + 1]);
      if (!Number.isFinite(v) || v < 0) throw new Error(`Line ${r + 1}, column "${samples[c]}": "${f[c + 1]}" is not a non-negative count.`);
      counts[(r - 1) * samples.length + c] = v;
    }
  }
  return { genes, samples, counts };
}

export function parseGroups(text: string, samples: string[]): string[] {
  const map = new Map<string, string>();
  for (const l of text.split(/\r?\n/)) {
    const f = l.split(/[\t,]/).map((x) => x.trim().replace(/^"|"$/g, ''));
    if (f.length >= 2 && f[0] && f[1]) map.set(f[0], f[1]);
  }
  const out = samples.map((s) => map.get(s));
  const missing = samples.filter((_, i) => !out[i]);
  if (missing.length) throw new Error(`Sample sheet is missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
  return out as string[];
}

/** DESeq2 median-of-ratios size factors (Anders & Huber 2010). */
export function sizeFactors(m: CountMatrix): Float64Array {
  const G = m.genes.length, S = m.samples.length;
  const logGeo = new Float64Array(G).fill(NaN);
  for (let g = 0; g < G; g++) {
    let s = 0, ok = true;
    for (let j = 0; j < S; j++) { const v = m.counts[g * S + j]; if (v <= 0) { ok = false; break; } s += Math.log(v); }
    if (ok) logGeo[g] = s / S;
  }
  const sf = new Float64Array(S);
  for (let j = 0; j < S; j++) {
    const r: number[] = [];
    for (let g = 0; g < G; g++) if (!Number.isNaN(logGeo[g])) r.push(Math.log(m.counts[g * S + j]) - logGeo[g]);
    if (!r.length) throw new Error('No genes are expressed in every sample; cannot compute size factors.');
    r.sort((a, b) => a - b);
    const mid = r.length >> 1;
    sf[j] = Math.exp(r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2);
  }
  return sf;
}

export interface Logged { genes: string[]; samples: string[]; x: Float64Array /* log2(norm count + 1) */; norm: Float64Array; sf: Float64Array; libSize: number[]; detected: number[] }

export function normalise(m: CountMatrix): Logged {
  const G = m.genes.length, S = m.samples.length;
  const sf = sizeFactors(m);
  const norm = new Float64Array(G * S), x = new Float64Array(G * S);
  const libSize = new Array(S).fill(0), detected = new Array(S).fill(0);
  for (let g = 0; g < G; g++) for (let j = 0; j < S; j++) {
    const c = m.counts[g * S + j];
    libSize[j] += c; if (c > 0) detected[j]++;
    const v = c / sf[j];
    norm[g * S + j] = v; x[g * S + j] = Math.log2(v + 1);
  }
  return { genes: m.genes, samples: m.samples, x, norm, sf, libSize, detected };
}

/** PCA on the top-variance genes via eigen-decomposition of the sample Gram matrix (Jacobi). */
export interface PcaResult { scores: number[][]; varExplained: number[]; nGenes: number }
export function pca(l: Logged, topN = 500, nPc = 4): PcaResult {
  const G = l.genes.length, S = l.samples.length;
  const vars = Array.from({ length: G }, (_, g) => {
    let mean = 0; for (let j = 0; j < S; j++) mean += l.x[g * S + j]; mean /= S;
    let v = 0; for (let j = 0; j < S; j++) v += (l.x[g * S + j] - mean) ** 2;
    return { g, mean, v: v / (S - 1) };
  }).filter((o) => o.v > 0).sort((a, b) => b.v - a.v).slice(0, topN);
  const k = vars.length;
  if (!k) throw new Error('All genes have zero variance.');
  const C = Array.from({ length: S }, () => new Float64Array(S)); // centred data Y (k×S); Gram = YᵀY
  const Y = vars.map(({ g, mean }) => Float64Array.from({ length: S }, (_, j) => l.x[g * S + j] - mean));
  for (let a = 0; a < S; a++) for (let b = a; b < S; b++) { let s = 0; for (let i = 0; i < k; i++) s += Y[i][a] * Y[i][b]; C[a][b] = C[b][a] = s; }
  const { values, vectors } = jacobiEigen(C);
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const total = values.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
  const nOut = Math.min(nPc, S - 1);
  const scores = Array.from({ length: S }, (_, j) => order.slice(0, nOut).map(([v, i]) => vectors[j][i] * Math.sqrt(Math.max(v, 0))));
  return { scores, varExplained: order.slice(0, nOut).map(([v]) => Math.max(v, 0) / total), nGenes: k };
}

export function jacobiEigen(A: Float64Array[]): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const a = A.map((r) => Float64Array.from(r));
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: Array.from({ length: n }, (_, i) => a[i][i]), vectors: v };
}

// ---------- special functions ----------
export function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
  let ser = 1.000000000190015; for (const cj of c) ser += cj / ++y;
  return -t + Math.log((2.5066282746310005 * ser) / x);
}
export function digamma(x: number): number {
  let r = 0; while (x < 6) { r -= 1 / x; x += 1; }
  const f = 1 / (x * x);
  return r + Math.log(x) - 0.5 / x - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f / 132))));
}
export function trigamma(x: number): number {
  let r = 0; while (x < 6) { r += 1 / (x * x); x += 1; }
  const f = 1 / (x * x);
  return r + 1 / x + f / 2 + (f / x) * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f / 30)));
}
function trigammaInverse(y: number): number {
  // Newton iteration as in limma::trigammaInverse; tetragamma by central difference.
  if (y > 1e7) return 1 / Math.sqrt(y);
  if (y < 1e-6) return 1 / y;
  let x = 0.5 + 1 / y;
  for (let i = 0; i < 50; i++) {
    const tri = trigamma(x);
    const tetra = (trigamma(x + 1e-5) - trigamma(x - 1e-5)) / 2e-5;
    const nx = Math.max(x + (tri * (1 - tri / y)) / tetra, 1e-8);
    if (Math.abs(nx - x) < 1e-10 * x) return nx;
    x = nx;
  }
  return x;
}
function betacf(a: number, b: number, x: number): number {
  const tiny = 1e-300; let c = 1, d = 1 - ((a + b) * x) / (a + 1); if (Math.abs(d) < tiny) d = tiny; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}
export function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
/** Two-sided p-value of Student t with (possibly fractional / infinite) df. */
export function tTwoSided(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  if (!Number.isFinite(df)) return 2 * (1 - normCdf(Math.abs(t)));
  return incBeta(df / (df + t * t), df / 2, 0.5);
}
function normCdf(z: number) { return 0.5 * erfc(-z / Math.SQRT2); }
function erfc(x: number): number {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Benjamini–Hochberg adjusted p-values (NaN-safe). */
export function bh(p: number[]): number[] {
  const idx = p.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  const m = idx.length, out = new Array(p.length).fill(NaN);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) { prev = Math.min(prev, (idx[k][0] * m) / (k + 1)); out[idx[k][1]] = prev; }
  return out;
}

/** limma squeezeVar (Smyth 2004): estimate prior (d0, s0²) from gene-wise residual variances. */
export function squeezeVar(s2: number[], df: number): { d0: number; s02: number; post: number[] } {
  const ok = s2.filter((v) => v > 0 && Number.isFinite(v));
  const z = ok.map((v) => Math.log(v));
  const e = z.map((v) => v - digamma(df / 2) + Math.log(df / 2));
  const mean = e.reduce((a, b) => a + b, 0) / e.length;
  const variance = e.reduce((a, b) => a + (b - mean) ** 2, 0) / (e.length - 1) - trigamma(df / 2);
  let d0: number, s02: number;
  if (variance > 0) { d0 = 2 * trigammaInverse(variance); s02 = Math.exp(mean + digamma(d0 / 2) - Math.log(d0 / 2)); }
  else { d0 = Infinity; s02 = Math.exp(mean); }
  const post = s2.map((v) => (Number.isFinite(d0) ? (d0 * s02 + df * v) / (d0 + df) : s02));
  return { d0, s02, post };
}

export interface DeParams { groupA: string; groupB: string; minCpm: number; minSamples: number; lfcThreshold: number; fdr: number }
export interface DeRow { gene: string; log2FC: number; avgExpr: number; t: number; p: number; fdr: number; sig: 'up' | 'down' | 'ns'; lfcs?: number[] /* F-test: one per non-reference level */ }
export interface DeResult { rows: DeRow[]; tested: number; filteredOut: number; priorDf: number; priorVar: number; nUp: number; nDown: number; params: DeParams }

/**
 * Two-group differential expression on log2-CPM with empirical-Bayes moderated t (limma-style, no voom weights yet).
 * Positive log2FC = higher in groupB.
 */
export function differential(m: CountMatrix, groups: string[], p: DeParams): DeResult {
  const G = m.genes.length, S = m.samples.length;
  const ia = groups.map((g, i) => (g === p.groupA ? i : -1)).filter((i) => i >= 0);
  const ib = groups.map((g, i) => (g === p.groupB ? i : -1)).filter((i) => i >= 0);
  if (p.groupA === p.groupB) throw new Error('Choose two different groups.');
  if (ia.length < 2 || ib.length < 2) throw new Error('Each group needs at least 2 replicates.');
  const lib = new Array(S).fill(0);
  for (let g = 0; g < G; g++) for (let j = 0; j < S; j++) lib[j] += m.counts[g * S + j];
  const sf = sizeFactors(m);
  const eff = lib.map((l, j) => (l * sf[j]) / (lib.reduce((a, b) => a + b, 0) / S)); // TMM-like scaling via DESeq factors
  const keep: number[] = [];
  for (let g = 0; g < G; g++) {
    let n = 0;
    for (const j of [...ia, ...ib]) if ((m.counts[g * S + j] / eff[j]) * 1e6 >= p.minCpm) n++;
    if (n >= p.minSamples) keep.push(g);
  }
  if (keep.length < 20) throw new Error(`Only ${keep.length} genes pass the expression filter; lower the minimum CPM.`);
  const na = ia.length, nb = ib.length, df = na + nb - 2;
  const lfc: number[] = [], s2: number[] = [], avg: number[] = [];
  const unscaled = Math.sqrt(1 / na + 1 / nb);
  for (const g of keep) {
    const val = (j: number) => Math.log2((m.counts[g * S + j] + 0.5) / (eff[j] + 1) * 1e6);
    const va = ia.map(val), vb = ib.map(val);
    const ma = va.reduce((a, b) => a + b, 0) / na, mb = vb.reduce((a, b) => a + b, 0) / nb;
    const ss = va.reduce((a, b) => a + (b - ma) ** 2, 0) + vb.reduce((a, b) => a + (b - mb) ** 2, 0);
    lfc.push(mb - ma); s2.push(ss / df); avg.push((ma * na + mb * nb) / (na + nb));
  }
  const { d0, post } = squeezeVar(s2, df);
  const dfTot = Number.isFinite(d0) ? d0 + df : Infinity;
  const t = lfc.map((b, i) => b / (Math.sqrt(post[i]) * unscaled));
  const pv = t.map((x) => tTwoSided(x, dfTot));
  const fdr = bh(pv);
  const rows: DeRow[] = keep.map((g, i) => ({
    gene: m.genes[g], log2FC: lfc[i], avgExpr: avg[i], t: t[i], p: pv[i], fdr: fdr[i],
    sig: fdr[i] <= p.fdr && Math.abs(lfc[i]) >= p.lfcThreshold ? (lfc[i] > 0 ? 'up' : 'down') : 'ns',
  }));
  rows.sort((a, b) => a.p - b.p);
  return { rows, tested: keep.length, filteredOut: G - keep.length, priorDf: d0, priorVar: Math.sqrt(post.length ? Math.exp(Math.log(s2.reduce((a, b) => a + b, 0) / s2.length)) : 0), nUp: rows.filter((r) => r.sig === 'up').length, nDown: rows.filter((r) => r.sig === 'down').length, params: p };
}

// ---------- hierarchical clustering for heatmaps ----------
export function clusterOrder(rows: Float64Array[]): number[] {
  const n = rows.length;
  if (n <= 2) return rows.map((_, i) => i);
  const corr = (a: Float64Array, b: Float64Array) => {
    const k = a.length; let ma = 0, mb = 0; for (let i = 0; i < k; i++) { ma += a[i]; mb += b[i]; } ma /= k; mb /= k;
    let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < k; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  };
  const d: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d[i][j] = d[j][i] = 1 - corr(rows[i], rows[j]);
  type Node = { items: number[]; id: number };
  let nodes: Node[] = rows.map((_, i) => ({ items: [i], id: i }));
  const dist = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) dist.set(key(i, j), d[i][j]);
  let nextId = n;
  while (nodes.length > 1) {
    let best = Infinity, bi = 0, bj = 1;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) { const v = dist.get(key(nodes[i].id, nodes[j].id))!; if (v < best) { best = v; bi = i; bj = j; } }
    const A = nodes[bi], B = nodes[bj], merged: Node = { items: [...A.items, ...B.items], id: nextId++ };
    for (const o of nodes) if (o !== A && o !== B) dist.set(key(merged.id, o.id), (dist.get(key(A.id, o.id))! * A.items.length + dist.get(key(B.id, o.id))! * B.items.length) / merged.items.length); // UPGMA
    nodes = nodes.filter((x) => x !== A && x !== B); nodes.push(merged);
  }
  return nodes[0].items;
}

// ---------- synthetic demo data (clearly labelled in the UI) ----------
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function syntheticExperiment(seed = 7, nGenes = 4000, perGroup = 4, opts: { names?: string[]; up?: Set<string>; down?: Set<string> } = {}) {
  const rnd = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const gamma = (shape: number): number => { // Marsaglia–Tsang
    if (shape < 1) return gamma(shape + 1) * rnd() ** (1 / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) { let x: number, v: number; do { x = gauss(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rnd(); if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v; }
  };
  const poisson = (l: number): number => { if (l > 50) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss())); const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
  const S = perGroup * 2, disp = 0.08;
  const depth = Array.from({ length: S }, () => 0.8 + rnd() * 0.5);
  const samples = [...Array.from({ length: perGroup }, (_, i) => `ctrl_${i + 1}`), ...Array.from({ length: perGroup }, (_, i) => `treat_${i + 1}`)];
  const genes: string[] = [], counts = new Float64Array(nGenes * S), effects: number[] = [];
  for (let g = 0; g < nGenes; g++) {
    const nm = opts.names ? opts.names[g] : `GENE${String(g + 1).padStart(4, '0')}`; genes.push(nm);
    const base = Math.exp(2 + 3.2 * rnd() + 1.5 * gauss() * 0.3);
    const mag = 0.9 + rnd() * 1.1, coin = rnd(), noise = rnd() < 0.02 ? (coin < 0.5 ? -1 : 1) * (0.8 + rnd() * 1.2) : 0;
    const effect = opts.names ? (opts.up?.has(nm) ? mag : opts.down?.has(nm) ? -mag : noise) : g < 300 ? (rnd() < 0.5 ? -1 : 1) * (0.8 + rnd() * 1.6) : 0;
    effects.push(effect);
    for (let j = 0; j < S; j++) {
      const mu = base * depth[j] * 2 ** (j >= perGroup ? effect : 0);
      counts[g * S + j] = poisson(mu * gamma(1 / disp) * disp);
    }
  }
  const truth = opts.names ? new Set(genes.filter((_, i) => Math.abs(effects[i]) > 0)) : new Set(genes.slice(0, 300));
  const csv = ['gene,' + samples.join(','), ...genes.map((n, g) => n + ',' + Array.from({ length: S }, (_, j) => counts[g * S + j]).join(','))].join('\n');
  const sheet = 'sample,group\n' + samples.map((s) => `${s},${s.startsWith('ctrl') ? 'control' : 'treated'}`).join('\n');
  return { csv, sheet, truth };
}

/** Demo with a strong per-gene batch effect (balanced design: every group appears in both batches). Sheet carries a third `batch` column. */
export function syntheticBatchExperiment(seed = 9, nGenes = 3000, perGroup = 6) {
  const e = syntheticExperiment(seed, nGenes, perGroup), m = parseMatrix(e.csv), S = m.samples.length, rnd = mulberry32(seed + 100);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const batch = m.samples.map((_, j) => (j % 2 ? 'B' : 'A')), f = Array.from({ length: m.genes.length }, () => Math.exp(0.9 * gauss()));
  const csv = ['gene,' + m.samples.join(','), ...m.genes.map((n, g) => n + ',' + Array.from({ length: S }, (_, j) => Math.round(m.counts[g * S + j] * (batch[j] === 'B' ? f[g] : 1))).join(','))].join('\n');
  const sheet = 'sample,group,batch\n' + m.samples.map((s, j) => `${s},${s.startsWith('ctrl') ? 'control' : 'treated'},${batch[j]}`).join('\n');
  return { csv, sheet, truth: e.truth };
}
