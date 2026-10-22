/** UMAP (McInnes, Healy & Melville 2018), clean-room TypeScript: exact kNN, fuzzy simplicial set, a/b curve fit, SGD layout with negative sampling. */
import { knnApprox } from './scale';
export interface UmapOpts { nNeighbors?: number; minDist?: number; spread?: number; epochs?: number; negativeRate?: number; seed?: number }

const rngf = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };

/** Fit 1/(1 + a·x^(2b)) to the target membership curve (1 below minDist, exp(-(x-minDist)/spread) above) by coarse-to-fine grid search. */
export function fitAB(minDist: number, spread: number): { a: number; b: number } {
  const xs = Array.from({ length: 300 }, (_, i) => ((i + 1) / 300) * spread * 3);
  const ys = xs.map((x) => (x <= minDist ? 1 : Math.exp(-(x - minDist) / spread)));
  const sse = (a: number, b: number) => { let s = 0; for (let i = 0; i < xs.length; i++) { const d = 1 / (1 + a * Math.pow(xs[i], 2 * b)) - ys[i]; s += d * d; } return s; };
  let a0 = 1, b0 = 1, aw = 3, bw = 1, best = Infinity;
  for (let round = 0; round < 6; round++) {
    let ba = a0, bb = b0;
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
      const a = Math.max(1e-3, a0 + ((i - 10) / 10) * aw), b = Math.max(0.1, b0 + ((j - 10) / 10) * bw), e = sse(a, b);
      if (e < best) { best = e; ba = a; bb = b; }
    }
    a0 = ba; b0 = bb; aw /= 4; bw /= 4;
  }
  return { a: a0, b: b0 };
}

/** Exact k nearest neighbours (Euclidean), excluding self. */
export function knn(X: number[][], k: number): { idx: Int32Array; dist: Float64Array } {
  const n = X.length, d = X[0].length, idx = new Int32Array(n * k), dist = new Float64Array(n * k), best: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    best.length = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      let s = 0; for (let c = 0; c < d; c++) { const t = X[i][c] - X[j][c]; s += t * t; }
      if (best.length < k) { best.push([s, j]); if (best.length === k) best.sort((p, q) => p[0] - q[0]); }
      else if (s < best[k - 1][0]) { let p = k - 1; while (p > 0 && best[p - 1][0] > s) { best[p] = best[p - 1]; p--; } best[p] = [s, j]; }
    }
    best.sort((p, q) => p[0] - q[0]);
    for (let t = 0; t < k; t++) { idx[i * k + t] = best[t][1]; dist[i * k + t] = Math.sqrt(best[t][0]); }
  }
  return { idx, dist };
}

/** Fuzzy simplicial set: per-point sigma/rho by bisection so that Σ exp(-(d-rho)/sigma) = log2(k); symmetrised by probabilistic t-conorm. */
export function fuzzyGraph(idx: Int32Array, dist: Float64Array, n: number, k: number): { head: number[]; tail: number[]; w: number[] } {
  const target = Math.log2(k), rows: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (let i = 0; i < n; i++) {
    const d = dist.subarray(i * k, i * k + k); let rho = 0; for (const v of d) if (v > 0) { rho = v; break; }
    let lo = 0, hi = Infinity, sigma = 1;
    for (let it = 0; it < 64; it++) {
      let s = 0; for (const v of d) s += v - rho > 0 ? Math.exp(-(v - rho) / sigma) : 1;
      if (Math.abs(s - target) < 1e-5) break;
      if (s > target) { hi = sigma; sigma = (lo + hi) / 2; } else { lo = sigma; sigma = hi === Infinity ? sigma * 2 : (lo + hi) / 2; }
    }
    for (let t = 0; t < k; t++) rows[i].set(idx[i * k + t], d[t] - rho > 0 ? Math.exp(-(d[t] - rho) / sigma) : 1);
  }
  const head: number[] = [], tail: number[] = [], w: number[] = [];
  for (let i = 0; i < n; i++) for (const [j, a] of rows[i]) {
    const b = rows[j].get(i);
    if (b === undefined) { head.push(i); tail.push(j); w.push(a); }
    else if (i < j) { head.push(i); tail.push(j); w.push(a + b - a * b); }
  }
  return { head, tail, w };
}

export function umap(X: number[][], opts: UmapOpts = {}, progress?: (f: number) => void): [number, number][] {
  const n = X.length; if (n < 5) return X.map((_, i) => [i, 0]);
  const k = Math.min(opts.nNeighbors ?? 15, n - 1), minDist = opts.minDist ?? 0.1, spread = opts.spread ?? 1, neg = opts.negativeRate ?? 5;
  const epochs = opts.epochs ?? (n <= 10000 ? 500 : 200), rnd = rngf(opts.seed ?? 1);
  const { a, b } = fitAB(minDist, spread);
  const { idx, dist } = X.length > 4000 ? knnApprox(X, k, opts.seed ?? 1) : knn(X, k); progress?.(0.2);
  const g = fuzzyGraph(idx, dist, n, k), E = g.w.length;
  // init: first two input dimensions scaled to [0,10] with a little jitter (inputs are PCA scores)
  const Y = new Float64Array(n * 2);
  for (let c = 0; c < 2; c++) {
    let mn = Infinity, mx = -Infinity; for (let i = 0; i < n; i++) { const v = X[i][c] ?? 0; if (v < mn) mn = v; if (v > mx) mx = v; }
    const span = mx - mn || 1; for (let i = 0; i < n; i++) Y[2 * i + c] = (((X[i][c] ?? 0) - mn) / span) * 10 + (rnd() - 0.5) * 0.1;
  }
  const wmax = Math.max(...g.w), eps = g.w.map((w) => (w > 0 ? wmax / w : Infinity)), next = Float64Array.from(eps);
  const clip = (x: number) => (x > 4 ? 4 : x < -4 ? -4 : x);
  for (let ep = 0; ep < epochs; ep++) {
    const alpha = 1 - ep / epochs;
    for (let e = 0; e < E; e++) {
      if (next[e] > ep + 1) continue;
      const i = g.head[e], j = g.tail[e], dx = Y[2 * i] - Y[2 * j], dy = Y[2 * i + 1] - Y[2 * j + 1], d2 = dx * dx + dy * dy;
      if (d2 > 0) { const co = (-2 * a * b * Math.pow(d2, b - 1)) / (a * Math.pow(d2, b) + 1); Y[2 * i] += clip(co * dx) * alpha; Y[2 * i + 1] += clip(co * dy) * alpha; Y[2 * j] -= clip(co * dx) * alpha; Y[2 * j + 1] -= clip(co * dy) * alpha; }
      next[e] += eps[e];
      for (let s = 0; s < neg; s++) {
        const m = Math.floor(rnd() * n); if (m === i) continue;
        const rx = Y[2 * i] - Y[2 * m], ry = Y[2 * i + 1] - Y[2 * m + 1], r2 = rx * rx + ry * ry;
        const co = r2 > 0 ? (2 * b) / ((0.001 + r2) * (a * Math.pow(r2, b) + 1)) : 0;
        Y[2 * i] += (co > 0 ? clip(co * rx) : 4) * alpha; Y[2 * i + 1] += (co > 0 ? clip(co * ry) : 4) * alpha;
      }
    }
    if (progress && ep % 20 === 0) progress(0.2 + 0.8 * (ep / epochs));
  }
  return Array.from({ length: n }, (_, i) => [Y[2 * i], Y[2 * i + 1]] as [number, number]);
}
