// Linear-model differential expression for any experimental design: TMM normalisation (Robinson & Oshlack 2010),
// voom precision weights (Law et al. 2014), weighted least squares per gene, contrasts, and empirical-Bayes moderated
// t and F statistics (Smyth 2004). Clean-room implementation from the papers; results are compared with
// edgeR/limma in benchmarks/ and in linear.test.ts.
import { bh, squeezeVar, tTwoSided, incBeta, type CountMatrix } from './kernels';

/* ---------------- design ---------------- */

export interface Term { name: string; kind: 'factor' | 'numeric'; values: string[]; reference?: string }
export interface Design { X: number[][]; columns: string[]; terms: { name: string; columns: number[]; levels?: string[]; reference?: string }[] }

/** Builds a full-rank design with an intercept: treatment coding for factors (first level, or `reference`, is the baseline). */
export function buildDesign(terms: Term[], n: number): Design {
  const X: number[][] = Array.from({ length: n }, () => [1]);
  const columns = ['(Intercept)'];
  const out: Design['terms'] = [];
  for (const t of terms) {
    if (t.values.length !== n) throw new Error(`Column “${t.name}” has ${t.values.length} values for ${n} samples.`);
    if (t.kind === 'numeric') {
      const v = t.values.map(Number);
      if (v.some((x) => !Number.isFinite(x))) throw new Error(`Column “${t.name}” must be numeric.`);
      const mean = v.reduce((a, b) => a + b, 0) / n;
      v.forEach((x, i) => X[i].push(x - mean));
      out.push({ name: t.name, columns: [columns.length] }); columns.push(t.name);
    } else {
      const levels = [...new Set(t.values)];
      const ref = t.reference && levels.includes(t.reference) ? t.reference : levels[0];
      const others = levels.filter((l) => l !== ref);
      if (!others.length) throw new Error(`Factor “${t.name}” has only one level.`);
      const cols: number[] = [];
      for (const l of others) { t.values.forEach((x, i) => X[i].push(x === l ? 1 : 0)); cols.push(columns.length); columns.push(`${t.name}${l}`); }
      out.push({ name: t.name, columns: cols, levels: [ref, ...others], reference: ref });
    }
  }
  const p = columns.length;
  if (n - p < 1) throw new Error(`The design has ${p} coefficients for ${n} samples: there are no residual degrees of freedom.`);
  if (!invertSym(gram(X, null)).ok) throw new Error('The design is not of full rank: two columns carry the same information (for example a covariate confounded with a group).');
  return { X, columns, terms: out };
}

/* ---------------- small dense linear algebra ---------------- */

function gram(X: number[][], w: ArrayLike<number> | null): number[][] {
  const p = X[0].length, G = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < X.length; i++) { const wi = w ? w[i] : 1, r = X[i]; for (let a = 0; a < p; a++) { const ra = r[a] * wi; for (let b = a; b < p; b++) G[a][b] += ra * r[b]; } }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) G[a][b] = G[b][a];
  return G;
}
/** Inverse of a symmetric positive-definite matrix by Cholesky; ok=false when it is (numerically) singular. */
export function invertSym(A: number[][]): { ok: boolean; inv: number[][] } {
  const p = A.length, L = Array.from({ length: p }, () => new Array(p).fill(0));
  const scale = Math.max(...A.map((r, i) => Math.abs(r[i])), 1e-300);
  for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) { if (s <= 1e-10 * scale) return { ok: false, inv: [] }; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
  }
  const Li = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) { Li[i][i] = 1 / L[i][i]; for (let j = 0; j < i; j++) { let s = 0; for (let k = j; k < i; k++) s -= L[i][k] * Li[k][j]; Li[i][j] = s / L[i][i]; } }
  const inv = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let k = i; k < p; k++) s += Li[k][i] * Li[k][j]; inv[i][j] = s; inv[j][i] = s; }
  return { ok: true, inv };
}

/* ---------------- normalisation ---------------- */

const colSums = (m: CountMatrix) => { const S = m.samples.length, out = new Array(S).fill(0); for (let g = 0; g < m.genes.length; g++) for (let j = 0; j < S; j++) out[j] += m.counts[g * S + j]; return out; };
function rankAvg(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]), r = new Array(v.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}

/** edgeR TMM normalisation factors (logratioTrim 0.3, sumTrim 0.05, precision-weighted), scaled to a geometric mean of 1. */
export function tmmFactors(m: CountMatrix): number[] {
  const S = m.samples.length, G = m.genes.length, lib = colSums(m);
  const col = (j: number) => Array.from({ length: G }, (_, g) => m.counts[g * S + j]);
  // Reference sample as in edgeR 4: upper quartile (of counts / library size) closest to the mean upper quartile;
  // if most upper quartiles are zero, the sample with the largest sum of square-root counts.
  const q75 = Array.from({ length: S }, (_, j) => { const v = col(j).sort((x, y) => x - y), h = (v.length - 1) * 0.75, lo = Math.floor(h); return (v[lo] + (h - lo) * ((v[Math.min(lo + 1, v.length - 1)]) - v[lo])) / lib[j]; });
  const sq = [...q75].sort((x, y) => x - y), med = S % 2 ? sq[(S - 1) / 2] : (sq[S / 2 - 1] + sq[S / 2]) / 2;
  let ref = 0;
  if (med < 1e-20) { let best = -1; for (let j = 0; j < S; j++) { let s = 0; for (let g = 0; g < G; g++) s += Math.sqrt(m.counts[g * S + j]); if (s > best) { best = s; ref = j; } } }
  else { const mean = q75.reduce((x, y) => x + y, 0) / S; let best = Infinity; q75.forEach((v, j) => { if (Math.abs(v - mean) < best) { best = Math.abs(v - mean); ref = j; } }); }
  const rc = col(ref), nR = lib[ref];
  const f = new Array(S).fill(1);
  for (let j = 0; j < S; j++) {
    if (j === ref) continue;
    const oc = col(j), nO = lib[j];
    const logR: number[] = [], absE: number[] = [], v: number[] = [];
    for (let g = 0; g < G; g++) {
      const o = oc[g], r = rc[g];
      if (o <= 0 || r <= 0) continue;
      const lr = Math.log2(o / nO / (r / nR)), ae = (Math.log2(o / nO) + Math.log2(r / nR)) / 2;
      if (!Number.isFinite(lr) || !Number.isFinite(ae)) continue;
      logR.push(lr); absE.push(ae); v.push((nO - o) / nO / o + (nR - r) / nR / r);
    }
    const n = logR.length;
    if (n === 0) continue;
    if (Math.max(...logR.map(Math.abs)) < 1e-6) continue;
    const loL = Math.floor(n * 0.3) + 1, hiL = n + 1 - loL, loS = Math.floor(n * 0.05) + 1, hiS = n + 1 - loS;
    const rL = rankAvg(logR), rS = rankAvg(absE);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) if (rL[i] >= loL && rL[i] <= hiL && rS[i] >= loS && rS[i] <= hiS) { num += logR[i] / v[i]; den += 1 / v[i]; }
    f[j] = den > 0 ? 2 ** (num / den) : 1;
  }
  const gm = Math.exp(f.reduce((a, x) => a + Math.log(x), 0) / S);
  return f.map((x) => x / gm);
}

/* ---------------- lowess (Cleveland 1979; port of R's clowess) ---------------- */

export function lowess(x: number[], y: number[], f = 2 / 3, iter = 3, delta?: number): number[] {
  const n = x.length, order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = order.map((i) => x[i]), ys = order.map((i) => y[i]);
  const d = delta ?? 0.01 * (xs[n - 1] - xs[0]);
  const ns = Math.max(2, Math.min(n, Math.floor(f * n + 1e-7)));
  const ysm = new Array(n).fill(0), rw = new Array(n).fill(1), res = new Array(n).fill(0);
  const lowest = (xi: number, nleft: number, nright: number, userw: boolean): number | null => {
    const range = xs[n - 1] - xs[0], h = Math.max(xi - xs[nleft], xs[nright] - xi), h9 = 0.999 * h, h1 = 0.001 * h;
    const w = new Array(n).fill(0); let a = 0, j = nleft;
    while (j < n) {
      const r = Math.abs(xs[j] - xi);
      if (r <= h9) { w[j] = r <= h1 ? 1 : (1 - (r / h) ** 3) ** 3; if (userw) w[j] *= rw[j]; a += w[j]; }
      else if (xs[j] > xi) break;
      j++;
    }
    const nrt = j - 1;
    if (a <= 0) return null;
    for (j = nleft; j <= nrt; j++) w[j] /= a;
    if (h > 0) {
      a = 0; for (j = nleft; j <= nrt; j++) a += w[j] * xs[j];
      let b = xi - a, c = 0; for (j = nleft; j <= nrt; j++) c += w[j] * (xs[j] - a) ** 2;
      if (Math.sqrt(c) > 0.001 * range) { b /= c; for (j = nleft; j <= nrt; j++) w[j] *= b * (xs[j] - a) + 1; }
    }
    let ys0 = 0; for (j = nleft; j <= nrt; j++) ys0 += w[j] * ys[j];
    return ys0;
  };
  for (let it = 1; it <= iter + 1; it++) {
    let nleft = 0, nright = ns - 1, last = -1, i = 0;
    for (;;) {
      if (nright < n - 1) { const d1 = xs[i] - xs[nleft], d2 = xs[nright + 1] - xs[i]; if (d1 > d2) { nleft++; nright++; continue; } }
      const v = lowest(xs[i], nleft, nright, it > 1);
      ysm[i] = v === null ? ys[i] : v;
      if (last < i - 1) { const denom = xs[i] - xs[last]; for (let j = last + 1; j < i; j++) { const alpha = (xs[j] - xs[last]) / denom; ysm[j] = alpha * ysm[i] + (1 - alpha) * ysm[last]; } }
      last = i;
      const cut = xs[last] + d;
      for (i = last + 1; i < n; i++) { if (xs[i] > cut) break; if (xs[i] === xs[last]) { ysm[i] = ysm[last]; last = i; } }
      i = Math.max(last + 1, i - 1);
      if (last >= n - 1) break;
    }
    for (let k = 0; k < n; k++) res[k] = ys[k] - ysm[k];
    if (it > iter) break;
    const sc = res.reduce((a, r) => a + Math.abs(r), 0) / n;
    const ar = res.map(Math.abs).sort((a, b) => a - b), m1 = Math.floor(n / 2);
    const cmad = n % 2 === 0 ? 3 * (ar[m1 - 1] + ar[m1]) : 6 * ar[m1];
    if (cmad < 1e-7 * sc) break;
    const c9 = 0.999 * cmad, c1 = 0.001 * cmad;
    for (let k = 0; k < n; k++) { const r = Math.abs(res[k]); rw[k] = r <= c1 ? 1 : r <= c9 ? (1 - (r / cmad) ** 2) ** 2 : 0; }
  }
  const out = new Array(n); order.forEach((i, k) => { out[i] = ysm[k]; });
  return out;
}

/** Linear interpolation through (x, y) points sorted by x, constant beyond the ends (R approxfun(rule = 2)). */
function interpolator(x: number[], y: number[]) {
  const idx = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs: number[] = [], ys: number[] = [];
  for (const i of idx) { if (xs.length && x[i] === xs[xs.length - 1]) { ys[ys.length - 1] = (ys[ys.length - 1] + y[i]) / 2; continue; } xs.push(x[i]); ys.push(y[i]); }
  return (v: number) => {
    if (v <= xs[0]) return ys[0]; if (v >= xs[xs.length - 1]) return ys[ys.length - 1];
    let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= v) lo = mid; else hi = mid; }
    return ys[lo] + ((v - xs[lo]) / (xs[hi] - xs[lo])) * (ys[hi] - ys[lo]);
  };
}

/* ---------------- fitting ---------------- */

export interface Fit { genes: string[]; coef: number[][]; s2: number[]; df: number; cov: number[][][]; cov0: number[][]; amean: number[]; columns: string[] }

/** Weighted least squares for every gene. `y` is genes × samples; `w` (optional) has the same shape. */
export function lmFit(y: Float64Array, w: Float64Array | null, genes: string[], design: Design): Fit {
  const n = design.X.length, p = design.columns.length, G = genes.length, df = n - p;
  const coef: number[][] = [], s2: number[] = [], cov: number[][][] = [], amean: number[] = [];
  const cov0 = invertSym(gram(design.X, null)).inv;
  for (let g = 0; g < G; g++) {
    const wi = w ? w.subarray(g * n, g * n + n) : null;
    const V = wi ? invertSym(gram(design.X, wi)).inv : cov0;
    const xty = new Array(p).fill(0);
    let mean = 0;
    for (let i = 0; i < n; i++) { const v = y[g * n + i] * (wi ? wi[i] : 1); mean += y[g * n + i]; for (let a = 0; a < p; a++) xty[a] += design.X[i][a] * v; }
    const b = V.map((row) => row.reduce((s, x, a) => s + x * xty[a], 0));
    let rss = 0;
    for (let i = 0; i < n; i++) { let fit = 0; for (let a = 0; a < p; a++) fit += design.X[i][a] * b[a]; rss += (wi ? wi[i] : 1) * (y[g * n + i] - fit) ** 2; }
    coef.push(b); s2.push(rss / df); cov.push(V); amean.push(mean / n);
  }
  return { genes, coef, s2, df, cov, cov0, amean, columns: design.columns };
}

export interface Voom { y: Float64Array; w: Float64Array; libSize: number[]; trend: { x: number[]; y: number[] } }
/** voom: log-CPM with observation-level precision weights from the fitted mean–variance trend (span 0.5). */
export function voom(m: CountMatrix, design: Design, normFactors: number[]): Voom {
  const S = m.samples.length, G = m.genes.length;
  const lib = colSums(m).map((l, j) => l * normFactors[j]);
  const y = new Float64Array(G * S);
  for (let g = 0; g < G; g++) for (let j = 0; j < S; j++) y[g * S + j] = Math.log2(((m.counts[g * S + j] + 0.5) / (lib[j] + 1)) * 1e6);
  const fit = lmFit(y, null, m.genes, design);
  const meanLogLib = lib.reduce((a, l) => a + Math.log2(l + 1), 0) / S;
  const sx = fit.amean.map((a) => a + meanLogLib - Math.log2(1e6));
  const sy = fit.s2.map((v) => Math.sqrt(Math.sqrt(v)));
  const ly = lowess(sx, sy, 0.5);
  const f = interpolator(sx, ly);
  const w = new Float64Array(G * S);
  for (let g = 0; g < G; g++) for (let j = 0; j < S; j++) {
    let fitted = 0; for (let a = 0; a < design.columns.length; a++) fitted += design.X[j][a] * fit.coef[g][a];
    const logCount = Math.log2(2 ** fitted * (lib[j] + 1) * 1e-6);
    w[g * S + j] = 1 / f(logCount) ** 4;
  }
  return { y, w, libSize: lib, trend: { x: sx, y: ly } };
}

/* ---------------- contrasts and moderated statistics ---------------- */

export interface TestRow { gene: string; logFC: number; avgExpr: number; t: number; p: number; fdr: number; sig: 'up' | 'down' | 'ns' }
export interface FRow { gene: string; F: number; p: number; fdr: number; logFC: number[]; avgExpr: number; sig: boolean }
export interface Moderated { d0: number; s02: number; post: number[]; dfTotal: number }

export function moderate(fit: Fit): Moderated {
  const { d0, s02, post } = squeezeVar(fit.s2, fit.df);
  return { d0, s02, post, dfTotal: Number.isFinite(d0) ? d0 + fit.df : Infinity };
}

/**
 * Unscaled standard error of a contrast, as limma's contrasts.fit computes it: per-gene coefficient standard errors
 * (from the weighted fit) combined through the correlation of the unweighted design. Exact for a single coefficient;
 * for other contrasts under voom weights it is limma's approximation, kept so results match limma.
 */
function contrastSe(V: number[][], V0: number[][], c: number[]): number {
  const p = c.length, u = V.map((row, i) => Math.sqrt(row[i]));
  let s = 0;
  for (let a = 0; a < p; a++) if (c[a]) for (let b = 0; b < p; b++) if (c[b]) s += c[a] * c[b] * u[a] * u[b] * (V0[a][b] / Math.sqrt(V0[a][a] * V0[b][b]));
  return Math.sqrt(s);
}

/** Moderated t-test for one contrast vector over the design columns. */
export function contrastTest(fit: Fit, eb: Moderated, c: number[], opts: { fdr?: number; lfc?: number } = {}): TestRow[] {
  const fdrCut = opts.fdr ?? 0.05, lfcCut = opts.lfc ?? 0;
  const est = fit.coef.map((b) => b.reduce((s, x, a) => s + x * c[a], 0));
  const se = fit.cov.map((V) => contrastSe(V, fit.cov0, c));
  const t = est.map((e, g) => e / (se[g] * Math.sqrt(eb.post[g])));
  const p = t.map((x) => tTwoSided(x, eb.dfTotal));
  const q = bh(p);
  return fit.genes.map((gene, g) => ({ gene, logFC: est[g], avgExpr: fit.amean[g], t: t[g], p: p[g], fdr: q[g], sig: q[g] <= fdrCut && Math.abs(est[g]) >= lfcCut ? (est[g] > 0 ? 'up' : 'down') : 'ns' }));
}

/** Upper tail of the F distribution. */
export function fUpper(F: number, d1: number, d2: number): number {
  if (!(F > 0)) return 1;
  if (!Number.isFinite(d2)) { return chisqUpper(F * d1, d1); }
  return incBeta(d2 / (d2 + d1 * F), d2 / 2, d1 / 2);
}
function chisqUpper(x: number, k: number): number { return 1 - lowerGamma(k / 2, x / 2); }
function lowerGamma(a: number, x: number): number {
  if (x <= 0) return 0;
  const lg = lgammaLocal(a);
  if (x < a + 1) { let sum = 1 / a, term = sum; for (let n = 1; n < 500; n++) { term *= x / (a + n); sum += term; if (term < sum * 1e-14) break; } return sum * Math.exp(-x + a * Math.log(x) - lg); }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; }
  return 1 - Math.exp(-x + a * Math.log(x) - lg) * h;
}
function lgammaLocal(x: number): number { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x; const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5); let ser = 1.000000000190015; for (const ci of c) ser += ci / ++y; return -tmp + Math.log((2.5066282746310005 * ser) / x); }

/** Moderated F-test that any of several contrasts (rows of C) is non-zero, e.g. "any difference between groups". */
export function fTest(fit: Fit, eb: Moderated, C: number[][], opts: { fdr?: number } = {}): FRow[] {
  const r = C.length, fdrCut = opts.fdr ?? 0.05;
  // Correlation between the contrasts from the unweighted design (limma classifyTestsF), and moderated t per contrast.
  const cov = C.map((ci) => C.map((cj) => ci.reduce((s, x, a) => s + x * fit.cov0[a].reduce((t, v, k) => t + v * cj[k], 0), 0)));
  const cor = cov.map((row, i) => row.map((v, j) => v / Math.sqrt(cov[i][i] * cov[j][j])));
  const Rinv = invertSym(cor);
  if (!Rinv.ok) throw new Error('The contrasts are linearly dependent.');
  const tests = C.map((c) => contrastTest(fit, eb, c));
  const F = fit.genes.map((_, g) => { const t = tests.map((x) => x[g].t); return t.reduce((s, ti, i) => s + ti * Rinv.inv[i].reduce((u, v, j) => u + v * t[j], 0), 0) / r; });
  const p = F.map((f) => fUpper(f, r, eb.dfTotal));
  const q = bh(p);
  return fit.genes.map((gene, g) => ({ gene, F: F[g], p: p[g], fdr: q[g], logFC: tests.map((x) => x[g].logFC), avgExpr: fit.amean[g], sig: q[g] <= fdrCut }));
}

/* ---------------- one call for the studio ---------------- */

export interface DesignDeParams { terms: Term[]; minCpm: number; minSamples: number; useVoom: boolean; fdr: number; lfc: number }
export interface DesignDeResult { design: Design; fit: Fit; eb: Moderated; kept: number; filtered: number; normFactors: number[]; trend?: { x: number[]; y: number[] } }

/** Filter by expression, normalise (TMM), optionally voom-weight, and fit the design. Tests are run with contrastTest / fTest. */
export function fitDesign(m: CountMatrix, p: DesignDeParams): DesignDeResult {
  const S = m.samples.length, G = m.genes.length;
  const design = buildDesign(p.terms, S);
  const nf = tmmFactors(m);
  const lib = colSums(m).map((l, j) => l * nf[j]);
  const keepIdx: number[] = [];
  for (let g = 0; g < G; g++) { let k = 0; for (let j = 0; j < S; j++) if ((m.counts[g * S + j] / lib[j]) * 1e6 >= p.minCpm) k++; if (k >= p.minSamples) keepIdx.push(g); }
  if (keepIdx.length < 20) throw new Error(`Only ${keepIdx.length} genes pass the expression filter; lower the minimum CPM.`);
  const kept: CountMatrix = { genes: keepIdx.map((g) => m.genes[g]), samples: m.samples, counts: new Float64Array(keepIdx.length * S) };
  keepIdx.forEach((g, k) => { for (let j = 0; j < S; j++) kept.counts[k * S + j] = m.counts[g * S + j]; });
  const nf2 = tmmFactors(kept);
  let fit: Fit, trend: DesignDeResult['trend'];
  if (p.useVoom) { const v = voom(kept, design, nf2); fit = lmFit(v.y, v.w, kept.genes, design); trend = v.trend; }
  else {
    const lib2 = colSums(kept).map((l, j) => l * nf2[j]);
    const y = new Float64Array(keepIdx.length * S);
    for (let g = 0; g < keepIdx.length; g++) for (let j = 0; j < S; j++) y[g * S + j] = Math.log2(((kept.counts[g * S + j] + 0.5) / (lib2[j] + 1)) * 1e6);
    fit = lmFit(y, null, kept.genes, design);
  }
  return { design, fit, eb: moderate(fit), kept: keepIdx.length, filtered: G - keepIdx.length, normFactors: nf2, trend };
}

/** Contrast vector comparing level `b` with level `a` of a factor (b − a). */
export function levelContrast(design: Design, factor: string, a: string, b: string): number[] {
  const t = design.terms.find((x) => x.name === factor);
  if (!t?.levels) throw new Error(`“${factor}” is not a factor in the design.`);
  const c = new Array(design.columns.length).fill(0);
  const col = (lvl: string) => (lvl === t.reference ? -1 : t.columns[t.levels!.indexOf(lvl) - 1]);
  const ca = col(a), cb = col(b);
  if (cb >= 0) c[cb] += 1;
  if (ca >= 0) c[ca] -= 1;
  return c;
}
/** Rows of a contrast matrix testing all differences between the levels of a factor (one row per non-reference level). */
export function factorContrasts(design: Design, factor: string): number[][] {
  const t = design.terms.find((x) => x.name === factor);
  if (!t) throw new Error(`“${factor}” is not in the design.`);
  return t.columns.map((col) => { const c = new Array(design.columns.length).fill(0); c[col] = 1; return c; });
}
