/** Classical statistical tests for the Statistics Studio.
 *
 * Every function is a direct implementation of the textbook formula and is
 * checked against scipy.stats in `tests.test.ts` (see
 * `benchmarks/stats/make-reference.py`). Distributions come from the Lab
 * Studio's `dist.ts` so the whole workbench uses one implementation.
 */
import { lgamma, pchisq, pf, pnorm, pt, qnorm, qt } from '../lab/dist';

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const variance = (a: number[]) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1);
};
const sd = (a: number[]) => Math.sqrt(variance(a));
const twoSided = (t: number, df: number) => 2 * pt(-Math.abs(t), df);

/** Average ranks (ties share the mean rank); 1-based. */
export function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length).fill(0);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k].i] = r;
    i = j + 1;
  }
  return out;
}

/** Σ(t³ − t) over tie groups, the tie correction used by the rank tests. */
export function tieSum(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let s = 0;
  for (const c of counts.values()) if (c > 1) s += c ** 3 - c;
  return s;
}

export interface TTest {
  t: number;
  df: number;
  p: number;
  meanDiff: number;
  ci95: [number, number];
}

/** Welch (unequal-variance) two-sample t-test, two-sided. */
export function welchT(a: number[], b: number[]): TTest {
  if (a.length < 2 || b.length < 2) throw new Error('Each group needs at least 2 values.');
  const n1 = a.length, n2 = b.length, v1 = variance(a) / n1, v2 = variance(b) / n2;
  const se = Math.sqrt(v1 + v2), diff = mean(a) - mean(b);
  const df = (v1 + v2) ** 2 / (v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1));
  const t = diff / se, crit = qt(0.975, df);
  return { t, df, p: twoSided(t, df), meanDiff: diff, ci95: [diff - crit * se, diff + crit * se] };
}

/** Student two-sample t-test with a pooled variance. */
export function studentT(a: number[], b: number[]): TTest {
  if (a.length < 2 || b.length < 2) throw new Error('Each group needs at least 2 values.');
  const n1 = a.length, n2 = b.length, df = n1 + n2 - 2;
  const sp2 = ((n1 - 1) * variance(a) + (n2 - 1) * variance(b)) / df;
  const se = Math.sqrt(sp2 * (1 / n1 + 1 / n2)), diff = mean(a) - mean(b);
  const t = diff / se, crit = qt(0.975, df);
  return { t, df, p: twoSided(t, df), meanDiff: diff, ci95: [diff - crit * se, diff + crit * se] };
}

/** Paired t-test on the differences a − b, two-sided. */
export function pairedT(a: number[], b: number[]): TTest {
  if (a.length !== b.length) throw new Error('Paired values must have the same length.');
  if (a.length < 2) throw new Error('Need at least 2 pairs.');
  const d = a.map((v, i) => v - b[i]), n = d.length, m = mean(d), se = sd(d) / Math.sqrt(n), t = m / se, crit = qt(0.975, n - 1);
  return { t, df: n - 1, p: twoSided(t, n - 1), meanDiff: m, ci95: [m - crit * se, m + crit * se] };
}

/** One-sample t-test of H0: mean(a) = mu, two-sided. */
export function oneSampleT(a: number[], mu = 0): TTest {
  if (a.length < 2) throw new Error('Need at least 2 values.');
  const n = a.length, m = mean(a), se = sd(a) / Math.sqrt(n), t = (m - mu) / se, crit = qt(0.975, n - 1);
  return { t, df: n - 1, p: twoSided(t, n - 1), meanDiff: m - mu, ci95: [m - mu - crit * se, m - mu + crit * se] };
}

export interface AnovaResult { F: number; df1: number; df2: number; p: number; etaSquared: number; ssBetween: number; ssWithin: number }

/** One-way ANOVA with η² = SS_between / SS_total. */
export function oneWayAnova(groups: number[][]): AnovaResult {
  const k = groups.length, N = groups.reduce((s, g) => s + g.length, 0);
  if (k < 2) throw new Error('Need at least two groups.');
  if (N <= k) throw new Error('Need more observations than groups.');
  const grand = mean(groups.flat()), ssBetween = groups.reduce((s, g) => s + g.length * (mean(g) - grand) ** 2, 0);
  const ssWithin = groups.reduce((s, g) => s + g.reduce((q, v) => q + (v - mean(g)) ** 2, 0), 0);
  const df1 = k - 1, df2 = N - k, F = (ssBetween / df1) / (ssWithin / df2);
  return { F, df1, df2, p: pf(F, df1, df2) > 0 ? 1 - pf(F, df1, df2) : 1, etaSquared: ssBetween / (ssBetween + ssWithin), ssBetween, ssWithin };
}

/** Brown–Forsythe / Levene test: ANOVA on |y − group median|. */
export function leveneMedian(groups: number[][]): { W: number; df1: number; df2: number; p: number } {
  const z = groups.map((g) => {
    const s = [...g].sort((a, b) => a - b), n = s.length;
    const med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    return g.map((v) => Math.abs(v - med));
  });
  const a = oneWayAnova(z);
  return { W: a.F, df1: a.df1, df2: a.df2, p: a.p };
}

export interface RankTest { statistic: number; z: number; p: number }

/** Mann–Whitney U (for the first sample) with tie and continuity correction. */
export function mannWhitney(a: number[], b: number[]): RankTest & { U: number } {
  const n1 = a.length, n2 = b.length, N = n1 + n2;
  if (!n1 || !n2) throw new Error('Both samples need values.');
  const all = [...a, ...b], r = ranks(all), R1 = a.reduce((s, _v, i) => s + r[i], 0);
  const U = R1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt((n1 * n2 / 12) * ((N + 1) - tieSum(all) / (N * (N - 1))));
  const z = (U - mu + 0.5 * Math.sign(mu - U)) / sigma;
  return { U, statistic: U, z, p: 2 * (1 - pnorm(Math.abs(z))) };
}

/** Wilcoxon signed-rank test on a − b (zeros dropped, average ranks, continuity correction). */
export function wilcoxonSignedRank(a: number[], b: number[]): RankTest & { W: number; n: number } {
  if (a.length !== b.length) throw new Error('Paired values must have the same length.');
  const d = a.map((v, i) => v - b[i]).filter((v) => v !== 0), n = d.length;
  if (!n) throw new Error('All differences are zero.');
  const r = ranks(d.map(Math.abs)), Wp = d.reduce((s, v, i) => s + (v > 0 ? r[i] : 0), 0);
  const Wm = (n * (n + 1)) / 2 - Wp, W = Math.min(Wp, Wm);
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tieSum(d.map(Math.abs)) / 48);
  const z = (W - mu + 0.5 * Math.sign(mu - W)) / sigma;
  return { W, statistic: W, z, p: 2 * (1 - pnorm(Math.abs(z))), n };
}

/** Kruskal–Wallis H with the tie correction and a χ² p-value. */
export function kruskalWallis(groups: number[][]): { H: number; df: number; p: number } {
  const k = groups.length, N = groups.reduce((s, g) => s + g.length, 0);
  if (k < 2) throw new Error('Need at least two groups.');
  const all = groups.flat(), r = ranks(all);
  let pos = 0, sum = 0;
  for (const g of groups) {
    const R = g.reduce((s, _v, i) => s + r[pos + i], 0);
    sum += R * R / g.length;
    pos += g.length;
  }
  const H = (12 / (N * (N + 1))) * sum - 3 * (N + 1);
  const corr = 1 - tieSum(all) / (N ** 3 - N);
  const Hc = corr > 0 ? H / corr : H;
  return { H: Hc, df: k - 1, p: 1 - pchisq(Hc, k - 1) };
}

export interface ChiSquareResult { chi2: number; df: number; p: number; minExpected: number; yates?: { chi2: number; p: number } }

/** Pearson χ² for an r×c table; for 2×2 also returns the Yates-corrected value. */
export function chiSquare(table: number[][], opts: { yates?: boolean } = {}): ChiSquareResult {
  const rows = table.length, cols = table[0]?.length ?? 0;
  if (rows < 2 || cols < 2) throw new Error('A contingency table needs at least 2 rows and 2 columns.');
  if (table.some((r) => r.length !== cols)) throw new Error('Every row of the table must have the same number of columns.');
  const rowSum = table.map((r) => r.reduce((a, b) => a + b, 0)), colSum = Array.from({ length: cols }, (_, j) => table.reduce((s, r) => s + r[j], 0));
  const n = rowSum.reduce((a, b) => a + b, 0);
  if (!n) throw new Error('The table is empty.');
  let chi2 = 0, minExpected = Infinity;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const e = (rowSum[i] * colSum[j]) / n;
    minExpected = Math.min(minExpected, e);
    if (e > 0) chi2 += (table[i][j] - e) ** 2 / e;
  }
  const df = (rows - 1) * (cols - 1);
  const out: ChiSquareResult = { chi2, df, p: 1 - pchisq(chi2, df), minExpected };
  if (rows === 2 && cols === 2) {
    let y = 0;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const e = (rowSum[i] * colSum[j]) / n;
      y += (Math.abs(table[i][j] - e) - 0.5) ** 2 / e;
    }
    out.yates = { chi2: Math.max(0, y), p: 1 - pchisq(Math.max(0, y), 1) };
  }
  if (opts.yates && out.yates) return { ...out, chi2: out.yates.chi2, p: out.yates.p, df: 1 };
  return out;
}

/** Two-sided Fisher exact test for a 2×2 table (a b / c d), summed in log space. */
export function fisherExact(a: number, b: number, c: number, d: number): { oddsRatio: number; p: number } {
  for (const v of [a, b, c, d]) if (!Number.isInteger(v) || v < 0) throw new Error('Fisher exact needs non-negative integer counts.');
  const r1 = a + b, r2 = c + d, c1 = a + c, n = a + b + c + d;
  const lchoose = (nn: number, k: number) => lgamma(nn + 1) - lgamma(k + 1) - lgamma(nn - k + 1);
  const logP = (x: number) => lchoose(r1, x) + lchoose(r2, c1 - x) - lchoose(n, c1);
  const lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1);
  const obs = logP(a);
  let p = 0;
  for (let x = lo; x <= hi; x++) { const lp = logP(x); if (lp <= obs + 1e-9) p += Math.exp(lp); }
  return { oddsRatio: b * c === 0 ? Infinity : (a * d) / (b * c), p: Math.min(1, p) };
}

/** Odds ratio of a 2×2 table with a log-scale Wald 95 % CI. */
export function oddsRatio2x2(a: number, b: number, c: number, d: number): { or: number; lo: number; hi: number } {
  if ([a, b, c, d].some((v) => v <= 0)) throw new Error('The odds ratio needs non-zero cells (add a continuity correction).');
  const or = (a * d) / (b * c), se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d), z = qnorm(0.975);
  return { or, lo: Math.exp(Math.log(or) - z * se), hi: Math.exp(Math.log(or) + z * se) };
}

export interface ParsedTable { header: string[]; rows: string[][] }

/** Splits CSV/TSV text into a header and rows (tab or comma, quotes stripped). */
export function parseDelimited(text: string): ParsedTable {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new Error('No data pasted.');
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const cells = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const header = cells(lines[0]);
  if (header.length < 2) throw new Error('Need at least two columns.');
  return { header, rows: lines.slice(1).map(cells) };
}

/** Numeric values of a named column, dropping blanks and non-numbers. */
export function numericColumn(t: ParsedTable, name: string): number[] {
  const i = t.header.indexOf(name);
  if (i < 0) throw new Error(`Column "${name}" not found (have ${t.header.join(', ')}).`);
  return t.rows.map((r) => r[i]).map((v) => (v === undefined || v.trim() === '' ? NaN : Number(v))).filter(Number.isFinite);
}

export interface PearsonResult { r: number; t: number; df: number; p: number; lo: number; hi: number }

/** Pearson correlation with a t-test and a Fisher-z 95 % interval. */
export function pearson(x: number[], y: number[]): PearsonResult {
  if (x.length !== y.length || x.length < 3) throw new Error('Pearson correlation needs at least 3 paired values.');
  const n = x.length, mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  const r = sxy / Math.sqrt(sxx * syy), df = n - 2, t = r * Math.sqrt(df / (1 - r * r));
  const z = Math.atanh(r), se = 1 / Math.sqrt(n - 3), q = qnorm(0.975);
  return { r, t, df, p: twoSided(t, df), lo: Math.tanh(z - q * se), hi: Math.tanh(z + q * se) };
}

/** Spearman rank correlation (average ranks), with a t-based p-value. */
export function spearman(x: number[], y: number[]): { rho: number; t: number; df: number; p: number } {
  const p = pearson(ranks(x), ranks(y));
  return { rho: p.r, t: p.t, df: p.df, p: p.p };
}

export interface RegressionResult {
  slope: number; intercept: number; seSlope: number; seIntercept: number;
  t: number; p: number; r2: number; adjR2: number; F: number; df1: number; df2: number;
  ci95: [number, number];
}

/** Ordinary least squares of y on x, with the usual inference. */
export function linearRegression(x: number[], y: number[]): RegressionResult {
  if (x.length !== y.length || x.length < 3) throw new Error('Regression needs at least 3 paired values.');
  const n = x.length, mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  const slope = sxy / sxx, intercept = my - slope * mx;
  const sse = syy - slope * sxy, df2 = n - 2, s2 = sse / df2;
  const seSlope = Math.sqrt(s2 / sxx), seIntercept = Math.sqrt(s2 * (1 / n + mx * mx / sxx));
  const t = slope / seSlope, crit = qt(0.975, df2), r2 = sxy * sxy / (sxx * syy);
  return { slope, intercept, seSlope, seIntercept, t, p: twoSided(t, df2), r2, adjR2: 1 - (1 - r2) * (n - 1) / df2, F: (r2 / 1) / ((1 - r2) / df2), df1: 1, df2, ci95: [slope - crit * seSlope, slope + crit * seSlope] };
}

/** Bonferroni correction (clipped to 1). */
export const bonferroni = (p: number[]) => p.map((v) => Math.min(1, v * p.length));

/** Holm step-down adjustment, returned in the original order. */
export function holm(p: number[]): number[] {
  const order = p.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(p.length).fill(0);
  let running = 0;
  order.forEach((o, rank) => { running = Math.max(running, Math.min(1, o.v * (p.length - rank))); out[o.i] = running; });
  return out;
}

/** Benjamini–Hochberg FDR adjustment (monotone, returned in the original order). */
export function benjaminiHochberg(p: number[]): number[] {
  const order = p.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(p.length).fill(0);
  let running = 1;
  for (let rank = order.length - 1; rank >= 0; rank--) {
    const o = order[rank];
    running = Math.min(running, (o.v * order.length) / (rank + 1));
    out[o.i] = Math.min(1, running);
  }
  return out;
}

/** Cohen's d (pooled SD) for two independent samples. */
export function cohensD(a: number[], b: number[]): number {
  const n1 = a.length, n2 = b.length, sp = Math.sqrt(((n1 - 1) * variance(a) + (n2 - 1) * variance(b)) / (n1 + n2 - 2));
  return (mean(a) - mean(b)) / sp;
}

