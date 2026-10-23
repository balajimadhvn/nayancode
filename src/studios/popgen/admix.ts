/**
 * ADMIXTURE-style ancestry estimation (Tang, Peng, Wang & Risch 2005; Alexander, Novembre & Lange 2009):
 * maximum likelihood by EM for P(g_ij alt alleles | q_i, P) = Binomial(2, Σ_k q_ik p_kj), with missing
 * genotypes skipped. Several seeded random starts are compared by log-likelihood; BIC is reported to help
 * choose K. This is an exploratory implementation, not a replacement for ADMIXTURE/STRUCTURE.
 */
import { mulberry32 } from './stats';

export interface AdmixOptions { starts?: number; maxIter?: number; tol?: number; seed?: number }
export interface AdmixFit {
  K: number;
  Q: number[][];
  P: number[][];
  logLik: number;
  iterations: number;
  trace: number[];
  bic: number;
  params: number;
  nObs: number;
}

const mean = (v: number[]) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0);

/** Sort ancestry columns by their mean so runs with different label assignments are comparable. */
function sortColumns(fit: AdmixFit): AdmixFit {
  const means = Array.from({ length: fit.K }, (_, k) => mean(fit.Q.map((r) => r[k])));
  const order = fit.P.map((_, k) => k).sort((a, b) => means[b] - means[a]);
  return { ...fit, Q: fit.Q.map((r) => order.map((k) => r[k])), P: order.map((k) => fit.P[k]) };
}

/** One EM run from a random start. */
function runOne(G: Int8Array[], K: number, rnd: () => number, maxIter: number, tol: number): AdmixFit {
  const m = G.length, n = m ? G[0].length : 0;
  const Q: number[][] = Array.from({ length: n }, () => {
    const row = Array.from({ length: K }, () => rnd() + 0.01), s = mean(row) * K;
    return row.map((v) => v / s);
  });
  const P: number[][] = Array.from({ length: K }, () => Array.from({ length: m }, () => 0.05 + 0.9 * rnd()));
  const trace: number[] = [];
  let prev = -Infinity, iterations = 0, nObs = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const pNum = Array.from({ length: K }, () => new Float64Array(m));
    const pDen = Array.from({ length: K }, () => new Float64Array(m));
    const qNum = Array.from({ length: n }, () => new Float64Array(K));
    const jCount = new Int32Array(n);
    const f = new Float64Array(n);

    for (let j = 0; j < m; j++) {
      const g = G[j];
      for (let i = 0; i < n; i++) {
        if (g[i] < 0) continue;
        let s = 0;
        for (let k = 0; k < K; k++) s += Q[i][k] * P[k][j];
        f[i] = s;
      }
      for (let i = 0; i < n; i++) {
        const v = g[i];
        if (v < 0) continue;
        const alt = f[i], ref = 1 - alt;
        jCount[i]++;
        for (let k = 0; k < K; k++) {
          const a1 = (Q[i][k] * P[k][j]) / alt;
          const a0 = (Q[i][k] * (1 - P[k][j])) / ref;
          const w = v * a1 + (2 - v) * a0;
          pNum[k][j] += v * a1;
          pDen[k][j] += w;
          qNum[i][k] += w;
        }
      }
    }

    for (let k = 0; k < K; k++) for (let j = 0; j < m; j++) {
      const p = pDen[k][j] > 0 ? pNum[k][j] / pDen[k][j] : P[k][j];
      P[k][j] = Math.min(1 - 1e-6, Math.max(1e-6, p));
    }
    for (let i = 0; i < n; i++) {
      const den = 2 * Math.max(1, jCount[i]);
      let s = 0;
      for (let k = 0; k < K; k++) { Q[i][k] = qNum[i][k] / den; s += Q[i][k]; }
      if (s > 0) for (let k = 0; k < K; k++) Q[i][k] /= s;
    }

    let logLik = 0;
    nObs = 0;
    for (let j = 0; j < m; j++) {
      const g = G[j];
      for (let i = 0; i < n; i++) {
        const v = g[i];
        if (v < 0) continue;
        nObs++;
        let s = 0;
        for (let k = 0; k < K; k++) s += Q[i][k] * P[k][j];
        const ff = Math.min(1 - 1e-9, Math.max(1e-9, s));
        logLik += (v ? v * Math.log(ff) : 0) + (v < 2 ? (2 - v) * Math.log(1 - ff) : 0);
      }
    }
    trace.push(logLik);
    if (iter > 0 && Math.abs(logLik - prev) / Math.max(1, Math.abs(prev)) < tol) break;
    prev = logLik;
  }

  const params = K * (n + m);
  return { K, Q, P, logLik: trace[trace.length - 1] ?? -Infinity, iterations, trace, bic: 0, params, nObs };
}

/** Fit K ancestry components. Five random starts by default; the best log-likelihood is kept. */
export function admix(G: Int8Array[], K: number, opts: AdmixOptions = {}): AdmixFit {
  const n = G.length ? G[0].length : 0, m = G.length;
  if (!n || !m) throw new Error('The genotype matrix is empty.');
  if (!Number.isInteger(K) || K < 1 || K > Math.min(6, n, m)) throw new Error(`Choose K between 1 and ${Math.min(6, n, m)}.`);
  const starts = opts.starts ?? 5, maxIter = opts.maxIter ?? 300, tol = opts.tol ?? 1e-6;
  let best: AdmixFit | null = null;
  for (let s = 0; s < starts; s++) {
    const rnd = mulberry32((opts.seed ?? 1) + s * 7919 + K * 104729);
    const fit = runOne(G, K, rnd, maxIter, tol);
    if (!best || fit.logLik > best.logLik) best = fit;
  }
  const sortable = sortColumns(best!);
  const nObs = sortable.nObs;
  return { ...sortable, bic: -2 * sortable.logLik + sortable.params * Math.log(Math.max(1, nObs)), nObs };
}

/** Run K = 1 … maxK and return the fits, for the model-selection table. */
export function chooseK(G: Int8Array[], maxK = 6, opts: AdmixOptions = {}): AdmixFit[] {
  const base = opts.seed ?? 1, out: AdmixFit[] = [];
  for (let K = 1; K <= maxK; K++) out.push(admix(G, K, { ...opts, seed: base + K * 100003 }));
  return out;
}
