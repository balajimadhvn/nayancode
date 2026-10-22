/** Shared nonlinear least squares for the Lab Studio additions.
 *
 * Levenberg–Marquardt with a numerical (central-difference) Jacobian, optional box
 * bounds on the parameters, and an asymptotic covariance estimate s²·(JᵀJ)⁻¹
 * (Marquardt 1963). `qt` comes from the local distribution module.
 */
import { qt } from './dist';

export interface NlsOptions {
  /** Lower box bounds per parameter (default: −Infinity). */
  lower?: number[];
  /** Upper box bounds per parameter (default: +Infinity). */
  upper?: number[];
  /** Which parameters are free (default: all). */
  free?: boolean[];
  maxIter?: number;
}

export interface NlsFit {
  /** Fitted parameters. */
  p: number[];
  /** Standard errors: sqrt of the covariance diagonal (0 when unavailable). */
  se: number[];
  /** 95 % Wald intervals p ± qt(0.975, n − p). */
  ci95: [number, number][];
  rss: number;
  r2: number;
  df: number;
  converged: boolean;
}

/**
 * Fit `model(xi, p)` to the rows of `x` with responses `y`.
 * `x[i]` is the feature vector of observation i, so a model with several
 * predictors is just `(xi, p) => …` reading `xi[0]`, `xi[1]`, …
 */
export function fitNls(
  model: (x: number[], p: number[]) => number,
  x: number[][],
  y: number[],
  p0: number[],
  opt: NlsOptions = {},
): NlsFit {
  const n = y.length;
  if (x.length !== n) throw new Error('x and y must have the same length');
  const m = p0.length;
  const free = opt.free ?? p0.map(() => true);
  const lower = opt.lower ?? p0.map(() => -Infinity);
  const upper = opt.upper ?? p0.map(() => Infinity);
  const maxIter = opt.maxIter ?? 200;
  const idx = p0.map((_, i) => i).filter((i) => free[i]);
  const k = idx.length;
  if (!n) throw new Error('no observations to fit');

  const clamp = (v: number, i: number) => Math.min(upper[i], Math.max(lower[i], v));
  let p = p0.map((v, i) => clamp(v, i));

  const residuals = (q: number[]) => {
    const r = new Array<number>(n);
    for (let i = 0; i < n; i++) r[i] = y[i] - model(x[i], q);
    return r;
  };
  const sse = (r: number[]) => r.reduce((a, b) => a + b * b, 0);

  let r = residuals(p);
  let rss = sse(r);
  const jacobian = (q: number[]) => {
    const J: number[][] = Array.from({ length: n }, () => new Array<number>(k).fill(0));
    for (let a = 0; a < k; a++) {
      const j = idx[a];
      const h = Math.max(1e-7, 1e-6 * Math.abs(q[j]));
      const up = [...q]; up[j] = clamp(q[j] + h, j);
      const dn = [...q]; dn[j] = clamp(q[j] - h, j);
      const dh = up[j] - dn[j] || h;
      for (let i = 0; i < n; i++) J[i][a] = (model(x[i], up) - model(x[i], dn)) / dh;
    }
    return J;
  };
  /** Solve (JᵀJ + λ·diag(JᵀJ)) δ = Jᵀr (Gauss–Jordan with partial pivoting). */
  const solve = (J: number[][], rr: number[], lambda: number): number[] | null => {
    const A: number[][] = [];
    for (let a = 0; a < k; a++) {
      const row = new Array<number>(k + 1).fill(0);
      for (let b = 0; b < k; b++) { let s = 0; for (let i = 0; i < n; i++) s += J[i][a] * J[i][b]; row[b] = s; }
      let s = 0; for (let i = 0; i < n; i++) s += J[i][a] * rr[i];
      row[k] = s;
      A.push(row);
    }
    for (let a = 0; a < k; a++) A[a][a] += lambda * (A[a][a] || 1);
    for (let col = 0; col < k; col++) {
      let piv = col;
      for (let rr2 = col + 1; rr2 < k; rr2++) if (Math.abs(A[rr2][col]) > Math.abs(A[piv][col])) piv = rr2;
      if (Math.abs(A[piv][col]) < 1e-14) return null;
      const t = A[col]; A[col] = A[piv]; A[piv] = t;
      const d = A[col][col];
      for (let c = col; c <= k; c++) A[col][c] /= d;
      for (let rr2 = 0; rr2 < k; rr2++) {
        if (rr2 === col) continue;
        const f = A[rr2][col];
        if (!f) continue;
        for (let c = col; c <= k; c++) A[rr2][c] -= f * A[col][c];
      }
    }
    return A.map((row) => row[k]);
  };

  let lambda = 1e-3;
  let converged = false;
  for (let it = 0; it < maxIter; it++) {
    const J = jacobian(p);
    let stepped = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const delta = solve(J, r, lambda);
      if (!delta || delta.some((v) => !Number.isFinite(v))) { lambda *= 10; continue; }
      const q = [...p];
      idx.forEach((j, a) => { q[j] = clamp(q[j] + delta[a], j); });
      const rq = residuals(q), rqss = sse(rq);
      if (Number.isFinite(rqss) && rqss < rss) {
        const rel = (rss - rqss) / Math.max(rss, 1e-300);
        p = q; r = rq; rss = rqss; lambda = Math.max(lambda / 10, 1e-15); stepped = true;
        if (rel < 1e-12 || delta.every((v) => Math.abs(v) < 1e-14)) converged = true;
        break;
      }
      lambda *= 10;
    }
    if (!stepped) { converged = true; break; }
    if (converged) break;
  }

  // Covariance s²·(JᵀJ)⁻¹ at the solution.
  const df = n - k;
  const se = new Array<number>(m).fill(0);
  const ci95: [number, number][] = p.map((v) => [v, v]);
  if (df > 0) {
    const J = jacobian(p);
    const JtJ: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) { let s = 0; for (let i = 0; i < n; i++) s += J[i][a] * J[i][b]; JtJ[a][b] = s; }
    const inv = invert(JtJ);
    if (inv) {
      const s2 = rss / df, tcrit = qt(0.975, df);
      for (let a = 0; a < k; a++) {
        const j = idx[a];
        const v = s2 * inv[a][a];
        se[j] = v > 0 ? Math.sqrt(v) : 0;
        ci95[j] = [Math.max(lower[j], p[j] - tcrit * se[j]), Math.min(upper[j], p[j] + tcrit * se[j])];
      }
    }
  }
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  const tss = y.reduce((a, b) => a + (b - ybar) ** 2, 0);
  return { p, se, ci95, rss, r2: tss > 0 ? 1 - rss / tss : NaN, df, converged };
}

/** Gauss–Jordan inverse of a square matrix, or null when singular. */
export function invert(A: number[][]): number[][] | null {
  const k = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    const t = M[col]; M[col] = M[piv]; M[piv] = t;
    const d = M[col][col];
    for (let c = 0; c < 2 * k; c++) M[col][c] /= d;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let c = 0; c < 2 * k; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row.slice(k));
}
