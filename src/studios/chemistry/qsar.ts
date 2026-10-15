/** QSAR engine: histogram random forest, kNN (Tanimoto), ridge; metrics, cross-validation, y-randomisation,
 *  applicability domain, Butina clustering. Clean-room implementations (Breiman 2001; Butina 1999). */

export type Task = 'regression' | 'classification';
const rngf = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const pop = (x: number) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
export const tanimoto = (a: Uint32Array, b: Uint32Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += pop(a[k] & b[k]); u += pop(a[k] | b[k]); } return u ? i / u : 0; };

// ---------------- metrics ----------------
const mean = (v: ArrayLike<number>) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; return s / v.length; };
export function rank(v: number[]): number[] { const o = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]), r = new Array(v.length); for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; }
export function pearson(a: number[], b: number[]) { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? n / Math.sqrt(da * db) : 0; }
export const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));
export function regressionMetrics(y: number[], p: number[]) { const m = mean(y); let ssr = 0, sst = 0, ae = 0; for (let i = 0; i < y.length; i++) { ssr += (y[i] - p[i]) ** 2; sst += (y[i] - m) ** 2; ae += Math.abs(y[i] - p[i]); } return { r2: sst ? 1 - ssr / sst : 0, rmse: Math.sqrt(ssr / y.length), mae: ae / y.length, spearman: spearman(y, p), pearson: pearson(y, p), n: y.length }; }
export function auc(y: number[], score: number[]): number { const r = rank(score); let n1 = 0, s = 0; y.forEach((v, i) => { if (v === 1) { n1++; s += r[i]; } }); const n0 = y.length - n1; return n1 && n0 ? (s - (n1 * (n1 + 1)) / 2) / (n1 * n0) : NaN; }
export function classificationMetrics(y: number[], prob: number[], thr = 0.5) {
  let tp = 0, tn = 0, fp = 0, fn = 0; y.forEach((v, i) => { const p = prob[i] >= thr ? 1 : 0; if (v === 1 && p === 1) tp++; else if (v === 0 && p === 0) tn++; else if (v === 0 && p === 1) fp++; else fn++; });
  const sens = tp + fn ? tp / (tp + fn) : 0, spec = tn + fp ? tn / (tn + fp) : 0, d = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  return { auc: auc(y, prob), accuracy: (tp + tn) / y.length, balancedAccuracy: (sens + spec) / 2, mcc: d ? (tp * tn - fp * fn) / d : 0, sensitivity: sens, specificity: spec, n: y.length };
}
export function rocCurve(y: number[], score: number[]): { fpr: number; tpr: number }[] { const o = y.map((v, i) => [score[i], v] as const).sort((a, b) => b[0] - a[0]), P = y.filter((v) => v === 1).length, N = y.length - P; let tp = 0, fp = 0; const out = [{ fpr: 0, tpr: 0 }]; for (const [, v] of o) { if (v === 1) tp++; else fp++; out.push({ fpr: N ? fp / N : 0, tpr: P ? tp / P : 0 }); } return out; }

// ---------------- binning ----------------
export interface Binner { edges: Float32Array[]; nBins: number }
export function fitBinner(X: Float32Array[], p: number, nBins = 32): Binner {
  const edges: Float32Array[] = [];
  for (let j = 0; j < p; j++) {
    const col = Float32Array.from(X, (r) => r[j]).sort(); const uniq: number[] = []; for (let i = 0; i < col.length; i++) if (i === 0 || col[i] !== col[i - 1]) uniq.push(col[i]);
    if (uniq.length <= nBins) edges.push(Float32Array.from(uniq.slice(0, -1).map((v, i) => (v + uniq[i + 1]) / 2)));
    else { const e: number[] = []; for (let b = 1; b < nBins; b++) { const v = col[Math.floor((b * col.length) / nBins)]; if (!e.length || v > e[e.length - 1]) e.push(v); } edges.push(Float32Array.from(e)); }
  }
  return { edges, nBins };
}
export function binRow(row: Float32Array, b: Binner, out: Uint8Array, off: number) { for (let j = 0; j < row.length; j++) { const e = b.edges[j], v = row[j]; let lo = 0, hi = e.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (v > e[mid]) lo = mid + 1; else hi = mid; } out[off + j] = lo; } }

// ---------------- random forest ----------------
interface Tree { feat: Int16Array; thr: Uint8Array; left: Int32Array; right: Int32Array; val: Float32Array }
export interface Forest { trees: Tree[]; binner: Binner; p: number; task: Task; importance: Float64Array; oob: Float64Array | null }
export interface RfOpts { nTrees?: number; maxDepth?: number; minLeaf?: number; mtry?: number; seed?: number }
export function trainForest(X: Float32Array[], y: number[], task: Task, o: RfOpts = {}, progress?: (f: number) => void): Forest {
  const n = X.length, p = X[0].length, { nTrees = 150, maxDepth = 24, minLeaf = 2, seed = 1 } = o, // sqrt(p) (classification default) and ~2*sqrt(p) for regression: far cheaper than p/3 on 2048-bit fingerprints with the same accuracy in practice
  mtry = o.mtry ?? Math.max(1, task === 'classification' ? Math.round(Math.sqrt(p)) : Math.min(Math.round(p / 3), Math.round(2 * Math.sqrt(p))));
  const binner = fitBinner(X, p), B = new Uint8Array(n * p); X.forEach((r, i) => binRow(r, binner, B, i * p)); const rnd = rngf(seed), importance = new Float64Array(p), trees: Tree[] = [];
  const oobSum = new Float64Array(n), oobCnt = new Uint32Array(n), nb = binner.nBins + 1;
  for (let t = 0; t < nTrees; t++) {
    const idx = new Int32Array(n), inBag = new Uint8Array(n); for (let i = 0; i < n; i++) { const k = Math.floor(rnd() * n); idx[i] = k; inBag[k] = 1; }
    const feat: number[] = [], thr: number[] = [], left: number[] = [], right: number[] = [], val: number[] = [];
    const stack: { lo: number; hi: number; depth: number; node: number }[] = []; const arr = Int32Array.from(idx);
    const newNode = () => { feat.push(-1); thr.push(0); left.push(-1); right.push(-1); val.push(0); return feat.length - 1; };
    stack.push({ lo: 0, hi: n, depth: 0, node: newNode() });
    const cnt = new Float64Array(nb), sy = new Float64Array(nb);
    while (stack.length) {
      const { lo, hi, depth, node } = stack.pop()!, m = hi - lo; let sum = 0, sumsq = 0; for (let i = lo; i < hi; i++) { const v = y[arr[i]]; sum += v; sumsq += v * v; } val[node] = sum / m;
      const parentImp = sumsq - (sum * sum) / m; if (m < 2 * minLeaf || depth >= maxDepth || parentImp < 1e-12) continue;
      let bestGain = 1e-12, bf = -1, bt = 0;
      for (let k = 0; k < mtry; k++) {
        const f = Math.floor(rnd() * p); cnt.fill(0); sy.fill(0); for (let i = lo; i < hi; i++) { const b = B[arr[i] * p + f]; cnt[b]++; sy[b] += y[arr[i]]; }
        let cl = 0, sl = 0; for (let b = 0; b < nb - 1; b++) { cl += cnt[b]; sl += sy[b]; const cr = m - cl; if (cl < minLeaf || cr < minLeaf) continue; const sr = sum - sl, gain = (sl * sl) / cl + (sr * sr) / cr - (sum * sum) / m; if (gain > bestGain) { bestGain = gain; bf = f; bt = b; } }
      }
      if (bf < 0) continue;
      let i = lo, j = hi - 1; while (i <= j) { if (B[arr[i] * p + bf] <= bt) i++; else { const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; j--; } }
      if (i === lo || i === hi) continue;
      feat[node] = bf; thr[node] = bt; importance[bf] += bestGain; const l = newNode(), r = newNode(); left[node] = l; right[node] = r; stack.push({ lo, hi: i, depth: depth + 1, node: l }, { lo: i, hi, depth: depth + 1, node: r });
    }
    const tree: Tree = { feat: Int16Array.from(feat), thr: Uint8Array.from(thr), left: Int32Array.from(left), right: Int32Array.from(right), val: Float32Array.from(val) }; trees.push(tree);
    for (let i = 0; i < n; i++) if (!inBag[i]) { oobSum[i] += predictTree(tree, B, i * p); oobCnt[i]++; }
    if (progress && t % 10 === 0) progress(t / nTrees);
  }
  const oob = new Float64Array(n).fill(NaN); for (let i = 0; i < n; i++) if (oobCnt[i]) oob[i] = oobSum[i] / oobCnt[i];
  const tot = importance.reduce((a, b) => a + b, 0) || 1; for (let j = 0; j < p; j++) importance[j] /= tot;
  return { trees, binner, p, task, importance, oob };
}
function predictTree(t: Tree, B: Uint8Array, off: number): number { let node = 0; while (t.feat[node] >= 0) node = B[off + t.feat[node]] <= t.thr[node] ? t.left[node] : t.right[node]; return t.val[node]; }
export function predictForest(f: Forest, X: Float32Array[]): number[] { const B = new Uint8Array(f.p); return X.map((row) => { binRow(row, f.binner, B, 0); let s = 0; for (const t of f.trees) s += predictTree(t, B, 0); return s / f.trees.length; }); }

// ---------------- kNN (Tanimoto) and ridge ----------------
export function knnPredict(trainFp: Uint32Array[], y: number[], queryFp: Uint32Array[], k = 5): number[] {
  return queryFp.map((q) => { const sims = trainFp.map((t, i) => [tanimoto(q, t), i] as const).sort((a, b) => b[0] - a[0]).slice(0, k); let ws = 0, s = 0; for (const [sim, i] of sims) { const w = sim + 1e-6; ws += w; s += w * y[i]; } return s / ws; });
}
export interface Ridge { w: Float64Array; b: number; mu: Float64Array; sd: Float64Array }
export function trainRidge(X: Float32Array[], y: number[], lambda = 1): Ridge {
  const n = X.length, p = X[0].length, mu = new Float64Array(p), sd = new Float64Array(p); for (let j = 0; j < p; j++) { let s = 0; for (const r of X) s += r[j]; mu[j] = s / n; let v = 0; for (const r of X) v += (r[j] - mu[j]) ** 2; sd[j] = Math.sqrt(v / n) || 1; }
  const my = mean(y), A = Array.from({ length: p }, () => new Float64Array(p)), rhs = new Float64Array(p);
  const Z = X.map((r) => Float64Array.from(r, (v, j) => (v - mu[j]) / sd[j]));
  for (let a = 0; a < p; a++) { for (let b = a; b < p; b++) { let s = 0; for (let i = 0; i < n; i++) s += Z[i][a] * Z[i][b]; A[a][b] = A[b][a] = s; } A[a][a] += lambda * n * 0.01 + 1e-9; let r = 0; for (let i = 0; i < n; i++) r += Z[i][a] * (y[i] - my); rhs[a] = r; }
  for (let c = 0; c < p; c++) { let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r; [A[c], A[piv]] = [A[piv], A[c]]; [rhs[c], rhs[piv]] = [rhs[piv], rhs[c]]; for (let r = c + 1; r < p; r++) { const f = A[r][c] / A[c][c]; if (!f) continue; for (let q = c; q < p; q++) A[r][q] -= f * A[c][q]; rhs[r] -= f * rhs[c]; } }
  const w = new Float64Array(p); for (let r = p - 1; r >= 0; r--) { let s = rhs[r]; for (let q = r + 1; q < p; q++) s -= A[r][q] * w[q]; w[r] = s / A[r][r]; }
  return { w, b: my, mu, sd };
}
export const predictRidge = (m: Ridge, X: Float32Array[]) => X.map((r) => { let s = m.b; for (let j = 0; j < r.length; j++) s += m.w[j] * ((r[j] - m.mu[j]) / m.sd[j]); return s; });

// ---------------- Butina clustering, applicability domain, PCA ----------------
export function butina(fps: Uint32Array[], cutoff = 0.6): { cluster: number[]; centroids: number[]; sizes: number[] } {
  const n = fps.length, nb: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (tanimoto(fps[i], fps[j]) >= cutoff) { nb[i].push(j); nb[j].push(i); }
  const cluster = new Array(n).fill(-1), order = Array.from({ length: n }, (_, i) => i).sort((a, b) => nb[b].length - nb[a].length), centroids: number[] = [], sizes: number[] = [];
  for (const i of order) { if (cluster[i] >= 0) continue; const c = centroids.length; centroids.push(i); let sz = 1; cluster[i] = c; for (const j of nb[i]) if (cluster[j] < 0) { cluster[j] = c; sz++; } sizes.push(sz); }
  return { cluster, centroids, sizes };
}
export function applicabilityDomain(trainFp: Uint32Array[], queryFp: Uint32Array[], k = 3): { maxSim: number; meanTopK: number }[] {
  return queryFp.map((q) => { const s = trainFp.map((t) => tanimoto(q, t)).sort((a, b) => b - a).slice(0, k); return { maxSim: s[0] ?? 0, meanTopK: s.reduce((a, b) => a + b, 0) / (s.length || 1) }; });
}
export function pca2(fps: Uint32Array[], seed = 1): { x: number; y: number }[] {
  const n = fps.length, words = fps[0].length, p = words * 32; const get = (i: number, j: number) => (fps[i][j >> 5] >>> (j & 31)) & 1;
  const mu = new Float64Array(p); for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) mu[j] += get(i, j); for (let j = 0; j < p; j++) mu[j] /= n;
  const rnd = rngf(seed), comps: Float64Array[] = [], scores: number[][] = [[], []];
  for (let c = 0; c < 2; c++) {
    let v = Float64Array.from({ length: p }, () => rnd() - 0.5);
    for (let it = 0; it < 40; it++) { const u = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < p; j++) s += (get(i, j) - mu[j]) * v[j]; u[i] = s; } const nv = new Float64Array(p); for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) nv[j] += (get(i, j) - mu[j]) * u[i]; for (const prev of comps) { let d = 0; for (let j = 0; j < p; j++) d += nv[j] * prev[j]; for (let j = 0; j < p; j++) nv[j] -= d * prev[j]; } let nr = 0; for (let j = 0; j < p; j++) nr += nv[j] * nv[j]; nr = Math.sqrt(nr) || 1; for (let j = 0; j < p; j++) nv[j] /= nr; v = nv; }
    comps.push(v); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < p; j++) s += (get(i, j) - mu[j]) * v[j]; scores[c].push(s); }
  }
  return Array.from({ length: n }, (_, i) => ({ x: scores[0][i], y: scores[1][i] }));
}

// ---------------- cross-validation ----------------
export type ModelKind = 'rf' | 'knn' | 'ridge';
export interface Data { X: Float32Array[]; fp: Uint32Array[]; y: number[] }
export interface ModelSpec { kind: ModelKind; task: Task; nTrees: number; k: number }
export function fitPredict(spec: ModelSpec, tr: Data, te: { X: Float32Array[]; fp: Uint32Array[] }, seed = 1): number[] {
  if (spec.kind === 'rf') return predictForest(trainForest(tr.X, tr.y, spec.task, { nTrees: spec.nTrees, seed }), te.X);
  if (spec.kind === 'knn') return knnPredict(tr.fp, tr.y, te.fp, spec.k);
  const p = predictRidge(trainRidge(tr.X, tr.y, 1), te.X); return spec.task === 'classification' ? p.map((v) => Math.min(1, Math.max(0, v))) : p;
}
/** Fold assignment: random, or whole Butina clusters kept together (stricter, avoids near-duplicate leakage). */
export function makeFolds(n: number, kFold: number, mode: 'random' | 'cluster', fps?: Uint32Array[], seed = 1): number[] {
  const rnd = rngf(seed), fold = new Array(n).fill(0);
  if (mode === 'cluster' && fps) { const { cluster, sizes } = butina(fps, 0.6), ids = sizes.map((_, i) => i).sort(() => rnd() - 0.5), load = new Array(kFold).fill(0), where = new Map<number, number>(); for (const c of ids.sort((a, b) => sizes[b] - sizes[a])) { const f = load.indexOf(Math.min(...load)); where.set(c, f); load[f] += sizes[c]; } return cluster.map((c) => where.get(c)!); }
  const order = Array.from({ length: n }, (_, i) => i).sort(() => rnd() - 0.5); order.forEach((i, r) => { fold[i] = r % kFold; }); return fold;
}
export function crossValidate(spec: ModelSpec, d: Data, kFold: number, mode: 'random' | 'cluster', seed = 1, progress?: (f: number) => void): number[] {
  const n = d.y.length, folds = makeFolds(n, kFold, mode, d.fp, seed), pred = new Array(n).fill(NaN);
  for (let f = 0; f < kFold; f++) { const tr: number[] = [], te: number[] = []; for (let i = 0; i < n; i++) (folds[i] === f ? te : tr).push(i); if (!te.length || !tr.length) continue; const p = fitPredict(spec, { X: tr.map((i) => d.X[i]), fp: tr.map((i) => d.fp[i]), y: tr.map((i) => d.y[i]) }, { X: te.map((i) => d.X[i]), fp: te.map((i) => d.fp[i]) }, seed + f); te.forEach((i, j) => { pred[i] = p[j]; }); progress?.((f + 1) / kFold); }
  return pred;
}
export function yRandomization(spec: ModelSpec, d: Data, kFold: number, runs: number, seed = 7): number[] {
  const rnd = rngf(seed), out: number[] = [];
  for (let r = 0; r < runs; r++) { const y = [...d.y]; for (let i = y.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [y[i], y[j]] = [y[j], y[i]]; } const p = crossValidate(spec, { ...d, y }, kFold, 'random', seed + r); out.push(spec.task === 'regression' ? regressionMetrics(y, p).r2 : classificationMetrics(y, p).auc); }
  return out;
}
export function toPActivity(valueNm: number): number { return -Math.log10(valueNm * 1e-9); }
