/**
 * Scale-up kernels for the single-cell pipeline, clean-room from the papers (the reference implementations of
 * Harmony and Scrublet are GPL or have no compatible licence for copying):
 *   - approximate k-nearest neighbours by NN-descent (Dong, Moses & Li 2011);
 *   - Harmony-style batch integration by soft clustering with a diversity penalty and ridge correction (Korsunsky et al. 2019);
 *   - doublet scoring by simulating doublets and counting simulated neighbours (Wolock, Lopez & Klein 2019, Scrublet).
 */
const rngf = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const sq = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let c = 0; c < a.length; c++) { const t = a[c] - b[c]; s += t * t; } return s; };

// ---------------------------------------------------------------- NN-descent
export interface Knn { idx: Int32Array; dist: Float64Array }
/** Approximate k nearest neighbours (Euclidean, excluding self). Same layout as the exact kNN in umap.ts: neighbours of i at [i·k, (i+1)·k), nearest first. */
export function knnApprox(X: ArrayLike<number>[], k: number, seed = 1, maxIter = 20, delta = 0.001, rho = 1): Knn {
  const n = X.length; k = Math.min(k, n - 1); const R = rngf(seed);
  const nbr = new Int32Array(n * k).fill(-1), nd = new Float64Array(n * k).fill(Infinity), isNew = new Uint8Array(n * k);
  const insert = (i: number, j: number, d: number): number => {
    if (i === j) return 0; const o = i * k; if (d >= nd[o + k - 1]) return 0;
    for (let t = 0; t < k; t++) if (nbr[o + t] === j) return 0;
    let p = k - 1; while (p > 0 && nd[o + p - 1] > d) { nbr[o + p] = nbr[o + p - 1]; nd[o + p] = nd[o + p - 1]; isNew[o + p] = isNew[o + p - 1]; p--; }
    nbr[o + p] = j; nd[o + p] = d; isNew[o + p] = 1; return 1;
  };
  for (let i = 0; i < n; i++) { let c = 0; while (c < k) { const j = Math.floor(R() * n); if (insert(i, j, sq(X[i], X[j]))) c++; } }
  const cap = Math.max(1, Math.ceil(rho * k));
  for (let iter = 0; iter < maxIter; iter++) {
    const newL: number[][] = Array.from({ length: n }, () => []), oldL: number[][] = Array.from({ length: n }, () => []), revN: number[][] = Array.from({ length: n }, () => []), revO: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) for (let t = 0; t < k; t++) {
      const j = nbr[i * k + t]; if (j < 0) continue;
      if (isNew[i * k + t]) { if (newL[i].length < cap) { newL[i].push(j); isNew[i * k + t] = 0; if (revN[j].length < cap) revN[j].push(i); else if (R() < cap / (revN[j].length + 1)) revN[j][Math.floor(R() * cap)] = i; } }
      else { oldL[i].push(j); if (revO[j].length < cap) revO[j].push(i); else if (R() < cap / (revO[j].length + 1)) revO[j][Math.floor(R() * cap)] = i; }
    }
    let updates = 0;
    for (let i = 0; i < n; i++) {
      const N = [...newL[i], ...revN[i]], O = [...oldL[i], ...revO[i]];
      for (let a = 0; a < N.length; a++) {
        const u = N[a];
        for (let b = a + 1; b < N.length; b++) { const v = N[b]; if (u === v) continue; const d = sq(X[u], X[v]); updates += insert(u, v, d) + insert(v, u, d); }
        for (const v of O) { if (u === v) continue; const d = sq(X[u], X[v]); updates += insert(u, v, d) + insert(v, u, d); }
      }
    }
    if (updates < delta * n * k) break;
  }
  const dist = new Float64Array(n * k); for (let i = 0; i < n * k; i++) dist[i] = Math.sqrt(nd[i]);
  return { idx: nbr, dist };
}
/** Fraction of true nearest neighbours recovered (for tests and the UI's quality note). */
export const knnRecall = (approx: Knn, exact: Knn, k: number) => { let hit = 0; const n = approx.idx.length / k; for (let i = 0; i < n; i++) { const s = new Set(exact.idx.subarray(i * k, (i + 1) * k)); for (let t = 0; t < k; t++) if (s.has(approx.idx[i * k + t])) hit++; } return hit / (n * k); };

// ---------------------------------------------------------------- batch integration (Harmony-style)
export interface HarmonyOpts { theta?: number; lambda?: number; sigma?: number; maxIter?: number; nClust?: number; seed?: number; blockSize?: number }
export interface HarmonyResult { Z: number[][]; iterations: number; converged: boolean }

/** Corrects batch effects in a PCA embedding Z (cells × PCs). `batch[i]` is the integer batch of cell i. */
export function harmony(Z0: number[][], batch: number[], o: HarmonyOpts = {}, progress?: (f: number) => void): HarmonyResult {
  const n = Z0.length, d = Z0[0].length, B = Math.max(...batch) + 1; if (B < 2) return { Z: Z0.map((r) => [...r]), iterations: 0, converged: true };
  const theta = o.theta ?? 2, lambda = o.lambda ?? 1, sigma = o.sigma ?? 0.1, rnd = rngf(o.seed ?? 1), K = Math.max(2, Math.min(o.nClust ?? Math.min(Math.round(n / 30), 100), n));
  const prop = new Float64Array(B); batch.forEach((b) => prop[b]++); for (let b = 0; b < B; b++) prop[b] /= n;
  const cos = (Z: number[][]) => Z.map((z) => { const nr = Math.sqrt(z.reduce((a, v) => a + v * v, 0)) || 1; return z.map((v) => v / nr); });
  let Z = Z0.map((r) => [...r]), Zc = cos(Z);
  // k-means initialisation of cluster centres in cosine space
  let Y = Array.from({ length: K }, () => [...Zc[Math.floor(rnd() * n)]]);
  for (let it = 0; it < 10; it++) {
    const sum = Array.from({ length: K }, () => new Float64Array(d)), cnt = new Float64Array(K);
    for (let i = 0; i < n; i++) { let bk = 0, bd = -Infinity; for (let k = 0; k < K; k++) { let s = 0; for (let c = 0; c < d; c++) s += Y[k][c] * Zc[i][c]; if (s > bd) { bd = s; bk = k; } } cnt[bk]++; for (let c = 0; c < d; c++) sum[bk][c] += Zc[i][c]; }
    Y = Y.map((y, k) => { if (!cnt[k]) return y; const nr = Math.sqrt(sum[k].reduce((a, v) => a + v * v, 0)) || 1; return Array.from(sum[k], (v) => v / nr); });
  }
  const R = Array.from({ length: K }, () => new Float64Array(n)), O = Array.from({ length: K }, () => new Float64Array(B)), E = Array.from({ length: K }, () => new Float64Array(B));
  const dist = (k: number, i: number) => { let s = 0; for (let c = 0; c < d; c++) s += Y[k][c] * Zc[i][c]; return 2 * (1 - s); };
  const softAssign = (i: number, penalty: boolean) => {
    const w = new Float64Array(K); let tot = 0; const b = batch[i];
    for (let k = 0; k < K; k++) { let v = Math.exp(-dist(k, i) / sigma); if (penalty) v *= ((E[k][b] + 1) / (O[k][b] + 1)) ** theta; w[k] = v; tot += v; }
    for (let k = 0; k < K; k++) w[k] /= tot || 1; return w;
  };
  const rebuildOE = () => { for (let k = 0; k < K; k++) { O[k].fill(0); let rs = 0; for (let i = 0; i < n; i++) { O[k][batch[i]] += R[k][i]; rs += R[k][i]; } for (let b = 0; b < B; b++) E[k][b] = prop[b] * rs; } };
  for (let i = 0; i < n; i++) { const w = softAssign(i, false); for (let k = 0; k < K; k++) R[k][i] = w[k]; }
  rebuildOE();
  const objective = () => { let obj = 0; for (let k = 0; k < K; k++) for (let i = 0; i < n; i++) obj += R[k][i] * dist(k, i); return obj; };
  const order = Array.from({ length: n }, (_, i) => i); const shuffle = () => { for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } };
  let converged = false, iter = 0; const history: number[] = [];
  const maxIter = o.maxIter ?? 10, block = Math.max(1, Math.floor(n * (o.blockSize ?? 0.05)));
  for (; iter < maxIter; iter++) {
    progress?.(iter / maxIter);
    // clustering: alternate centroid update and blockwise soft assignment with the diversity penalty
    let last = Infinity;
    for (let round = 0; round < 20; round++) {
      for (let k = 0; k < K; k++) { const y = new Float64Array(d); for (let i = 0; i < n; i++) { const r = R[k][i]; if (r > 1e-9) for (let c = 0; c < d; c++) y[c] += r * Zc[i][c]; } const nr = Math.sqrt(y.reduce((a, v) => a + v * v, 0)) || 1; Y[k] = Array.from(y, (v) => v / nr); }
      shuffle();
      for (let s = 0; s < n; s += block) {
        const ids = order.slice(s, s + block);
        for (const i of ids) for (let k = 0; k < K; k++) { O[k][batch[i]] -= R[k][i]; }
        const rsAll = R.map((r) => r.reduce((a, v) => a + v, 0)); // E uses current totals without the block
        for (let k = 0; k < K; k++) { let rs = rsAll[k]; for (const i of ids) rs -= R[k][i]; for (let b = 0; b < B; b++) E[k][b] = prop[b] * rs; }
        for (const i of ids) { const w = softAssign(i, true); for (let k = 0; k < K; k++) { R[k][i] = w[k]; O[k][batch[i]] += w[k]; } }
      }
      rebuildOE(); const obj = objective(); if (Math.abs(last - obj) / Math.abs(obj) < 1e-3) break; last = obj;
    }
    // correction: ridge regression of the original embedding on batch within each soft cluster
    const Zn = Z0.map((r) => [...r]);
    for (let k = 0; k < K; k++) {
      const p = B + 1, A = Array.from({ length: p }, () => new Float64Array(p)), rhs = Array.from({ length: p }, () => new Float64Array(d));
      for (let i = 0; i < n; i++) { const r = R[k][i]; if (r < 1e-9) continue; const phi = (j: number) => (j === 0 ? 1 : batch[i] === j - 1 ? 1 : 0); for (let a = 0; a < p; a++) { const pa = phi(a); if (!pa) continue; for (let b2 = 0; b2 < p; b2++) if (phi(b2)) A[a][b2] += r; for (let c = 0; c < d; c++) rhs[a][c] += r * Z0[i][c]; } }
      for (let a = 1; a < p; a++) A[a][a] += lambda;
      const W = solveMulti(A, rhs); if (!W) continue;
      for (let i = 0; i < n; i++) { const r = R[k][i]; if (r < 1e-9) continue; const j = batch[i] + 1; for (let c = 0; c < d; c++) Zn[i][c] -= r * W[j][c]; }
    }
    Z = Zn; Zc = cos(Z);
    const obj = objective(); history.push(obj);
    if (history.length >= 2 && Math.abs(history[history.length - 2] - obj) / Math.abs(history[history.length - 2]) < 1e-4) { converged = true; iter++; break; }
  }
  return { Z, iterations: iter, converged };
}
function solveMulti(A: Float64Array[], rhs: Float64Array[]): Float64Array[] | null {
  const n = A.length, d = rhs[0].length, M = A.map((r, i) => [...r, ...rhs[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; if (f) for (let j = c; j < n + d; j++) M[r][j] -= f * M[c][j]; } }
  return M.map((r, i) => Float64Array.from(r.slice(n), (v) => v / r[i]));
}
/** Mean inverse Simpson index of batch labels among the k nearest neighbours (iLISI, Korsunsky 2019 with uniform weights). 1 = unmixed, B = perfectly mixed. */
export function batchMixing(Z: number[][], batch: number[], k = 30, knn?: Knn): number {
  const n = Z.length, B = Math.max(...batch) + 1, kk = Math.min(k, n - 1), nb = knn && knn.idx.length === n * kk ? knn : knnApprox(Z, kk, 5); let tot = 0;
  for (let i = 0; i < n; i++) { const c = new Float64Array(B); for (let t = 0; t < kk; t++) c[batch[nb.idx[i * kk + t]]]++; let s = 0; for (let b = 0; b < B; b++) s += (c[b] / kk) ** 2; tot += 1 / s; }
  return tot / n;
}

// ---------------------------------------------------------------- doublet scoring
export interface DoubletResult { score: number[]; threshold: number; predicted: number; expectedRate: number }
/** Scrublet's doublet score. `obs` and `sim` are PCA coordinates of observed cells and simulated doublets (same space). */
export function doubletScores(obs: number[][], sim: number[][], expectedRate = 0.06, seed = 1): DoubletResult {
  const n = obs.length, nSim = sim.length, r = nSim / n, all = [...obs, ...sim], kAdj = Math.round(0.5 * Math.sqrt(n)) * (1 + r), k = Math.min(Math.max(5, Math.round(kAdj)), all.length - 1);
  const nb = knnApprox(all, k, seed); const rho = expectedRate; const score: number[] = [];
  for (let i = 0; i < n; i++) {
    let s = 0; for (let t = 0; t < k; t++) if (nb.idx[i * k + t] >= n) s++;
    const q = (s + 1) / (k + 2), denom = 1 - rho - q * (1 - rho / r); score.push(Math.max(0, Math.min(1, ((q * rho) / r) / (denom > 1e-9 ? denom : 1e-9))));
  }
  const threshold = valleyThreshold(score); return { score, threshold, predicted: score.filter((v) => v >= threshold).length, expectedRate };
}
/** Threshold at the lowest point between the two modes of the score histogram (Scrublet's automatic call); falls back to 0.25. */
export function valleyThreshold(score: number[], bins = 40): number {
  const h = new Float64Array(bins); for (const v of score) h[Math.min(bins - 1, Math.floor(v * bins))]++;
  const sm = Float64Array.from(h, (_, i) => (h[Math.max(0, i - 1)] + h[i] + h[Math.min(bins - 1, i + 1)]) / 3);
  let m1 = 0; for (let i = 1; i < bins; i++) if (sm[i] > sm[m1]) m1 = i;
  let m2 = -1; for (let i = m1 + 3; i < bins - 1; i++) if (sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > 0.02 * sm[m1] && (m2 < 0 || sm[i] > sm[m2])) m2 = i;
  if (m2 < 0) return 0.25;
  let v = m1 + 1; for (let i = m1 + 1; i < m2; i++) if (sm[i] < sm[v]) v = i;
  return Math.min(0.9, Math.max(0.05, (v + 0.5) / bins));
}
