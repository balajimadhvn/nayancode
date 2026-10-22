/**
 * GWAS-lite: single-variant association on small cohorts (PLINK-style). Genotype table or VCF plus a phenotype table
 * give per-variant tests with covariates and principal components:
 *   - quantitative trait: linear regression, t-test on the additive dosage;
 *   - case/control: logistic regression (Wald), or the Cochran–Armitage trend test without covariates.
 * Also: call-rate, MAF and exact Hardy–Weinberg filters (Wigginton 2005), LD pruning, genetic PCs and genomic-control λ.
 * Pure TypeScript; for large biobank-scale data use PLINK 2, REGENIE or SAIGE.
 */
import { pchisq, pnorm, pt } from '../lab/dist';

export interface Snp { id: string; chrom: string; pos: number }
export interface Genotypes { samples: string[]; snps: Snp[]; /** one Int8Array per SNP: alt-allele dosage 0/1/2, −1 = missing */ G: Int8Array[] }

const num = (s: string | undefined) => { const v = Number(s); return s !== undefined && s.trim() !== '' && Number.isFinite(v) ? v : NaN; };
const delim = (l: string) => (l.includes('\t') ? '\t' : l.includes(',') ? ',' : /\s+/);
const unq = (s: string) => s.trim().replace(/^"|"$/g, '');

/** Genotype table: first column sample ID, then one column per variant holding 0/1/2 (blank, NA or −9 = missing). Variant names of
 *  the form chr:pos (optionally :ref:alt), chr_pos or rsID are accepted; unplaced variants get consecutive positions on chromosome 0. */
export function parseGenotypeTable(text: string): Genotypes {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()); if (lines.length < 3) throw new Error('Need a header row and at least two samples.');
  const d = delim(lines[0]), head = lines[0].split(d).map(unq);
  const snps: Snp[] = head.slice(1).map((h, i) => { const m = h.match(/^(?:chr)?([0-9XYM]+)[:_](\d+)/i); return m ? { id: h, chrom: m[1].toUpperCase(), pos: Number(m[2]) } : { id: h, chrom: '0', pos: i + 1 }; });
  const samples: string[] = [], G = snps.map(() => new Int8Array(lines.length - 1));
  lines.slice(1).forEach((l, r) => {
    const f = l.split(d).map(unq); samples.push(f[0]);
    for (let j = 0; j < snps.length; j++) { const v = num(f[j + 1]); G[j][r] = v === 0 || v === 1 || v === 2 ? v : -1; }
  });
  return { samples, snps, G };
}
/** VCF with GT fields: dosage = number of alternate alleles; multi-allelic and non-GT records are skipped. */
export function parseGenotypeVcf(text: string): Genotypes & { skipped: number } {
  const snps: Snp[] = [], rows: Int8Array[] = []; let samples: string[] = [], skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('##')) continue;
    const f = line.split('\t');
    if (line.startsWith('#CHROM')) { samples = f.slice(9); continue; }
    if (f.length < 10 || f[4].includes(',') || f[4] === '.') { skipped++; continue; }
    const gi = f[8].split(':').indexOf('GT'); if (gi < 0) { skipped++; continue; }
    const row = new Int8Array(samples.length);
    for (let s = 0; s < samples.length; s++) { const gt = (f[9 + s] ?? '').split(':')[gi] ?? './.'; const a = gt.split(/[/|]/); row[s] = a.some((x) => x === '.' || x === '') ? -1 : a.reduce((t, x) => t + (x === '0' ? 0 : 1), 0); if (row[s] > 2) row[s] = -1; }
    snps.push({ id: f[2] && f[2] !== '.' ? f[2] : `${f[0]}:${f[1]}`, chrom: f[0].replace(/^chr/i, ''), pos: Number(f[1]) }); rows.push(row);
  }
  if (!samples.length) throw new Error('This does not look like a VCF with samples (no #CHROM header).');
  return { samples, snps, G: rows, skipped };
}

export interface Phenotypes { binary: boolean; y: number[]; cov: number[][]; covNames: string[]; samples: string[]; dropped: number }
/** Phenotype table: sample ID, a trait column (pheno / phenotype / trait / y / status) and any numeric covariates (age, sex, …).
 *  A trait with only 0/1 or 1/2 (PLINK) values is treated as case/control. Samples are matched to the genotypes by ID. */
export function parsePhenotypes(text: string, genoSamples: string[]): Phenotypes {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()); if (lines.length < 3) throw new Error('Need a header row and at least two samples.');
  const d = delim(lines[0]), head = lines[0].split(d).map(unq), low = head.map((h) => h.toLowerCase());
  const ti = low.findIndex((h) => ['pheno', 'phenotype', 'trait', 'y', 'status', 'case', 'outcome'].includes(h)); if (ti < 0) throw new Error(`Could not find the trait column. Name it "pheno", "phenotype", "trait", "y" or "status". Header: ${head.join(', ')}`);
  const idIdx = low.findIndex((h) => ['sample', 'iid', 'id', 'sample_id', 'fid'].includes(h)), id = idIdx >= 0 ? idIdx : 0;
  const covIdx = head.map((_, i) => i).filter((i) => i !== ti && i !== id);
  const rows = new Map<string, string[]>(); for (const l of lines.slice(1)) { const f = l.split(d).map(unq); rows.set(f[id], f); }
  const keep = covIdx.filter((i) => [...rows.values()].every((f) => Number.isFinite(num(f[i]))));
  const y: number[] = [], cov: number[][] = keep.map(() => []); let dropped = 0; const samples: string[] = [];
  for (const s of genoSamples) { const f = rows.get(s); const yy = f ? num(f[ti]) : NaN; if (!f || !Number.isFinite(yy) || keep.some((i) => !Number.isFinite(num(f[i])))) { dropped++; continue; } samples.push(s); y.push(yy); keep.forEach((i, k) => cov[k].push(num(f[i]))); }
  if (samples.length < 10) throw new Error(`Only ${samples.length} samples have both genotypes and a phenotype. Check that the sample IDs match.`);
  const vals = new Set(y); const plink = [...vals].every((v) => v === 1 || v === 2) && vals.size === 2, bin01 = [...vals].every((v) => v === 0 || v === 1) && vals.size === 2;
  return { binary: plink || bin01, y: plink ? y.map((v) => v - 1) : y, cov, covNames: keep.map((i) => head[i]), samples, dropped };
}

// ---------------------------------------------------------------- QC
export interface SnpQc { callRate: number; maf: number; alt: number; hwe: number }
/** Exact Hardy–Weinberg test (Wigginton, Cutler & Abecasis 2005): probability of a heterozygote count at least as unlikely as observed. */
export function hweExact(nAA: number, nAB: number, nBB: number): number {
  const hets = nAB, homr = Math.min(nAA, nBB), homc = Math.max(nAA, nBB), n = hets + homr + homc;
  if (n === 0) return 1;
  const rare = 2 * homr + hets, probs = new Array<number>(rare + 1).fill(0);
  let mid = Math.floor((rare * (2 * n - rare)) / (2 * n)); if ((mid & 1) !== (rare & 1)) mid++;
  let cr = (rare - mid) / 2, cc = n - mid - cr; probs[mid] = 1; let sum = 1;
  for (let h = mid; h > 1; h -= 2) { probs[h - 2] = (probs[h] * h * (h - 1)) / (4 * (cr + 1) * (cc + 1)); sum += probs[h - 2]; cr++; cc++; }
  cr = (rare - mid) / 2; cc = n - mid - cr;
  for (let h = mid; h <= rare - 2; h += 2) { probs[h + 2] = (probs[h] * 4 * cr * cc) / ((h + 2) * (h + 1)); sum += probs[h + 2]; cr--; cc--; }
  let p = 0; for (const v of probs) if (v / sum <= probs[hets] / sum) p += v / sum;
  return Math.min(1, p);
}
export function snpQc(g: Int8Array, subset?: boolean[]): SnpQc {
  let n = 0, a = 0, c0 = 0, c1 = 0, c2 = 0, tot = 0;
  for (let i = 0; i < g.length; i++) { if (subset && !subset[i]) continue; tot++; const v = g[i]; if (v < 0) continue; n++; a += v; if (v === 0) c0++; else if (v === 1) c1++; else c2++; }
  const f = n ? a / (2 * n) : 0; return { callRate: tot ? n / tot : 0, maf: Math.min(f, 1 - f), alt: f, hwe: n ? hweExact(c0, c1, c2) : 1 };
}

// ---------------------------------------------------------------- linear algebra helpers
function solveSym(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; } }
  return M.map((r, i) => r[n] / r[i]);
}
function invSym(A: number[][]): number[][] | null { const n = A.length; const cols = Array.from({ length: n }, (_, j) => solveSym(A, A.map((_, i) => (i === j ? 1 : 0)))); return cols.some((c) => !c) ? null : A.map((_, i) => cols.map((c) => c![i])); }

export interface TestResult { beta: number; se: number; p: number; n: number }
/** Linear regression of y on [1, dosage, covariates]; two-sided t-test for the dosage coefficient. */
export function linearTest(y: number[], g: number[], cov: number[][]): TestResult | null {
  const n = y.length, p = 2 + cov.length; if (n <= p + 1) return null;
  const X = (i: number) => [1, g[i], ...cov.map((c) => c[i])];
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0)), Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) { const x = X(i); for (let a = 0; a < p; a++) { Xty[a] += x[a] * y[i]; for (let b = 0; b < p; b++) XtX[a][b] += x[a] * x[b]; } }
  const inv = invSym(XtX), beta = solveSym(XtX, Xty); if (!inv || !beta) return null;
  let rss = 0; for (let i = 0; i < n; i++) { const x = X(i); const r = y[i] - x.reduce((a, v, j) => a + v * beta[j], 0); rss += r * r; }
  const df = n - p, se = Math.sqrt((rss / df) * inv[1][1]); if (!(se > 0)) return null;
  const t = beta[1] / se; return { beta: beta[1], se, p: 2 * pt(-Math.abs(t), df), n };
}
/** Logistic regression (Newton–Raphson / IRLS) of a 0/1 outcome on [1, dosage, covariates]; Wald test for the dosage. */
export function logisticTest(y: number[], g: number[], cov: number[][]): TestResult | null {
  const n = y.length, p = 2 + cov.length; if (n <= p + 1) return null;
  const rows = Array.from({ length: n }, (_, i) => [1, g[i], ...cov.map((c) => c[i])]);
  let b = new Array(p).fill(0); let I: number[][] | null = null;
  for (let it = 0; it < 30; it++) {
    const grad = new Array(p).fill(0), H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) { const x = rows[i], eta = x.reduce((a, v, j) => a + v * b[j], 0), mu = 1 / (1 + Math.exp(-eta)), w = Math.max(mu * (1 - mu), 1e-10); for (let a = 0; a < p; a++) { grad[a] += x[a] * (y[i] - mu); for (let c = 0; c < p; c++) H[a][c] += w * x[a] * x[c]; } }
    const step = solveSym(H, grad); if (!step) return null; I = H; let mx = 0; for (let j = 0; j < p; j++) { b[j] += step[j]; mx = Math.max(mx, Math.abs(step[j])); }
    if (mx < 1e-8) break; if (!b.every(Number.isFinite) || Math.abs(b[1]) > 30) return null;
  }
  const cov2 = I && invSym(I); if (!cov2 || !(cov2[1][1] > 0)) return null;
  const se = Math.sqrt(cov2[1][1]), z = b[1] / se; return { beta: b[1], se, p: 2 * (1 - pnorm(Math.abs(z))), n };
}
/** Cochran–Armitage trend test for case/control with additive scores 0, 1, 2 (χ², 1 df). beta is the log allelic odds ratio. */
export function trendTest(y: number[], g: number[]): TestResult | null {
  const r = [0, 0, 0], s = [0, 0, 0]; for (let i = 0; i < y.length; i++) { if (y[i] === 1) r[g[i]]++; else s[g[i]]++; }
  const R = r[0] + r[1] + r[2], S = s[0] + s[1] + s[2], N = R + S, nk = [0, 1, 2].map((k) => r[k] + s[k]); if (!R || !S) return null;
  const sT = nk[1] + 2 * nk[2], sT2 = nk[1] + 4 * nk[2], num = N * (r[1] + 2 * r[2]) - R * sT, den = R * S * (N * sT2 - sT * sT); if (!(den > 0)) return null;
  const chi = (N * num * num) / den, a1 = r[1] + 2 * r[2], a0 = 2 * r[0] + r[1], c1 = s[1] + 2 * s[2], c0 = 2 * s[0] + s[1];
  const beta = Math.log(((a1 + 0.5) * (c0 + 0.5)) / ((a0 + 0.5) * (c1 + 0.5))), se = Math.sqrt(1 / (a1 + 0.5) + 1 / (a0 + 0.5) + 1 / (c1 + 0.5) + 1 / (c0 + 0.5));
  return { beta, se, p: 1 - pchisq(chi, 1), n: N };
}

// ---------------------------------------------------------------- PCA and LD pruning
export const r2 = (a: Int8Array, b: Int8Array) => {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0; for (let i = 0; i < a.length; i++) { if (a[i] < 0 || b[i] < 0) continue; n++; sa += a[i]; sb += b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; sab += a[i] * b[i]; }
  const ca = saa - (sa * sa) / n, cb = sbb - (sb * sb) / n, cab = sab - (sa * sb) / n; return n > 2 && ca > 0 && cb > 0 ? (cab * cab) / (ca * cb) : 0;
};
/** Greedy LD pruning in a sliding window of SNPs on the same chromosome (PLINK --indep-pairwise style). */
export function ldPrune(snps: Snp[], G: Int8Array[], idx: number[], window = 50, threshold = 0.5): number[] {
  const keep: number[] = [];
  for (const i of idx) { let ok = true; for (let k = keep.length - 1, c = 0; k >= 0 && c < window; k--, c++) { if (snps[keep[k]].chrom !== snps[i].chrom) break; if (r2(G[keep[k]], G[i]) > threshold) { ok = false; break; } } if (ok) keep.push(i); }
  return keep;
}
/** Top principal components of the standardised genotype matrix, via the sample × sample Gram matrix and power iteration. */
export function genotypePcs(G: Int8Array[], idx: number[], nPc: number): { pcs: number[][]; var: number[] } {
  const n = G[0].length, m = idx.length; if (m < 5 || n < 5) return { pcs: [], var: [] };
  const Z = idx.map((j) => { const g = G[j]; let s = 0, c = 0; for (const v of g) if (v >= 0) { s += v; c++; } const mu = c ? s / c : 0, f = mu / 2, sd = Math.sqrt(2 * f * (1 - f)) || 1; return Float64Array.from(g, (v) => (v < 0 ? 0 : (v - mu) / sd)); });
  const K = Array.from({ length: n }, () => new Float64Array(n)); for (const z of Z) for (let a = 0; a < n; a++) { const za = z[a]; if (za === 0) continue; for (let b = a; b < n; b++) K[a][b] += za * z[b]; }
  for (let a = 0; a < n; a++) for (let b = a; b < n; b++) { K[a][b] /= m; K[b][a] = K[a][b]; }
  const pcs: number[][] = [], vars: number[] = []; let tr = 0; for (let a = 0; a < n; a++) tr += K[a][a];
  for (let k = 0; k < nPc; k++) {
    let v = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898 + k * 78.233) + 0.5); let lam = 0;
    for (let it = 0; it < 300; it++) { const w = new Float64Array(n); for (let a = 0; a < n; a++) { let s = 0; for (let b = 0; b < n; b++) s += K[a][b] * v[b]; w[a] = s; } const nrm = Math.sqrt(w.reduce((a, x) => a + x * x, 0)) || 1; const nl = nrm; for (let a = 0; a < n; a++) w[a] /= nrm; const diff = w.reduce((a, x, i) => a + Math.abs(x - v[i]), 0); v = w; lam = nl; if (diff < 1e-9) break; }
    pcs.push(Array.from(v).map((x) => x * Math.sqrt(n))); vars.push(lam / tr);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) K[a][b] -= lam * v[a] * v[b];
  }
  return { pcs, var: vars };
}

// ---------------------------------------------------------------- driver
export interface AssocOptions { test: 'auto' | 'linear' | 'logistic' | 'trend'; minMaf: number; minCallRate: number; hweP: number; nPc: number; useCovariates: boolean; gcCorrect: boolean }
export const DEFAULT_ASSOC: AssocOptions = { test: 'auto', minMaf: 0.01, minCallRate: 0.9, hweP: 1e-6, nPc: 0, useCovariates: true, gcCorrect: false };
export interface AssocRow { id: string; chrom: string; pos: number; maf: number; callRate: number; hwe: number; n: number; beta: number; se: number; p: number }
export interface AssocResult { rows: AssocRow[]; test: string; n: number; nCases?: number; covariates: string[]; filtered: { callRate: number; maf: number; hwe: number; failed: number }; lambda: number; pcVar: number[] }

export function lambdaGc(ps: number[]): number {
  const chi = ps.filter((p) => p > 0 && p <= 1).map((p) => { const z = qnormTail(p / 2); return z * z; }).sort((a, b) => a - b); if (!chi.length) return NaN;
  return chi[Math.floor(chi.length / 2)] / 0.4549364;
}
// inverse upper-tail normal quantile via bisection on pnorm (adequate for λ, which needs only the median)
function qnormTail(p: number): number { let lo = 0, hi = 40; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (1 - pnorm(mid) > p) lo = mid; else hi = mid; } return (lo + hi) / 2; }

export function runAssociation(geno: Genotypes, ph: Phenotypes, o: AssocOptions, progress?: (f: number) => void): AssocResult {
  const idx = new Map(geno.samples.map((s, i) => [s, i])); const cols = ph.samples.map((s) => idx.get(s)!);
  const G = geno.G.map((g) => Int8Array.from(cols, (c) => g[c])), n = ph.samples.length;
  const test = o.test === 'auto' ? (ph.binary ? 'logistic' : 'linear') : o.test;
  if (test === 'linear' && ph.binary && new Set(ph.y).size === 2) { /* allowed: linear probability model */ }
  if ((test === 'logistic' || test === 'trend') && !ph.binary) throw new Error('Logistic and trend tests need a case/control trait (0/1 or 1/2).');
  const controls = ph.binary ? ph.y.map((v) => v === 0) : undefined;
  const filtered = { callRate: 0, maf: 0, hwe: 0, failed: 0 };
  const qc = G.map((g) => snpQc(g, controls)), qcAll = G.map((g) => snpQc(g));
  const pass = G.map((_, j) => { if (qcAll[j].callRate < o.minCallRate) { filtered.callRate++; return false; } if (qcAll[j].maf < o.minMaf) { filtered.maf++; return false; } if (qc[j].hwe < o.hweP) { filtered.hwe++; return false; } return true; });
  const keepIdx = G.map((_, j) => j).filter((j) => pass[j]);
  let covs = o.useCovariates ? ph.cov.map((c) => [...c]) : []; const names = o.useCovariates ? [...ph.covNames] : []; let pcVar: number[] = [];
  if (o.nPc > 0) {
    const sample = keepIdx.length > 8000 ? keepIdx.filter((_, i) => i % Math.ceil(keepIdx.length / 8000) === 0) : keepIdx;
    const pr = ldPrune(geno.snps, G, sample), pc = genotypePcs(G, pr, o.nPc); covs = [...covs, ...pc.pcs]; pc.pcs.forEach((_, k) => names.push(`PC${k + 1}`)); pcVar = pc.var;
  }
  const rows: AssocRow[] = [];
  keepIdx.forEach((j, t) => {
    if (progress && t % 200 === 0) progress(t / keepIdx.length);
    const g = G[j], ok: number[] = []; for (let i = 0; i < n; i++) if (g[i] >= 0) ok.push(i);
    const yy = ok.map((i) => ph.y[i]), gg = ok.map((i) => g[i]), cc = covs.map((c) => ok.map((i) => c[i]));
    const r = test === 'linear' ? linearTest(yy, gg, cc) : test === 'logistic' ? logisticTest(yy, gg, cc) : trendTest(yy, gg);
    if (!r || !Number.isFinite(r.p)) { filtered.failed++; return; }
    rows.push({ id: geno.snps[j].id, chrom: geno.snps[j].chrom, pos: geno.snps[j].pos, maf: qcAll[j].maf, callRate: qcAll[j].callRate, hwe: qc[j].hwe, n: r.n, beta: r.beta, se: r.se, p: Math.max(r.p, 1e-300) });
  });
  const lambda = lambdaGc(rows.map((r) => r.p));
  if (o.gcCorrect && lambda > 1) for (const r of rows) { const z = qnormTail(r.p / 2); r.p = Math.max(2 * (1 - pnorm(Math.sqrt((z * z) / lambda))), 1e-300); }
  return { rows, test: test === 'trend' ? 'Cochran–Armitage trend' : test === 'logistic' ? 'logistic regression (Wald)' : 'linear regression (t)', n, nCases: ph.binary ? ph.y.filter((v) => v === 1).length : undefined, covariates: names, filtered, lambda: o.gcCorrect ? 1 : lambda, pcVar };
}

// ---------------------------------------------------------------- demo cohort
const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
/** Synthetic cohort with two sub-populations (so PCs matter) and three planted causal variants. Not real data. */
export function syntheticCohort(opts: { n?: number; m?: number; binary?: boolean; seed?: number } = {}): { genotypes: string; phenotypes: string; causal: string[] } {
  const n = opts.n ?? 400, m = opts.m ?? 1500, r = rng(opts.seed ?? 21), binary = opts.binary ?? true;
  const pop = Array.from({ length: n }, () => (r() < 0.5 ? 0 : 1)), chroms = [1, 2, 3, 4, 5];
  const snps = Array.from({ length: m }, (_, j) => { const c = chroms[j % chroms.length], pos = 100000 + Math.floor(j / chroms.length) * 20000; const f = 0.08 + r() * 0.4; return { name: `${c}:${pos}`, f0: f, f1: Math.min(0.95, Math.max(0.03, f + (r() - 0.5) * 0.12)) }; });
  const ci = [0.1, 0.45, 0.8].map((f) => Math.floor(f * m)), causal = ci.map((j) => snps[j].name), effect = [0.9, 0.7, 0.6];
  const G = snps.map((s) => pop.map((p) => { const f = p ? s.f1 : s.f0; return (r() < f ? 1 : 0) + (r() < f ? 1 : 0); }));
  const age = Array.from({ length: n }, () => Math.round(35 + r() * 40)), sex = Array.from({ length: n }, () => (r() < 0.5 ? 0 : 1));
  const lin = pop.map((p, i) => 0.6 * p + 0.02 * (age[i] - 55) + ci.reduce((a, j, k) => a + effect[k] * G[j][i], 0) + (r() + r() + r() - 1.5) * 1.4);
  const y = binary ? lin.map((v) => (v > [...lin].sort((a, b) => a - b)[Math.floor(n * 0.55)] ? 1 : 0)) : lin.map((v) => Number(v.toFixed(3)));
  const gl = [['sample', ...snps.map((s) => s.name)].join('\t'), ...Array.from({ length: n }, (_, i) => [`S${i + 1}`, ...G.map((g) => g[i])].join('\t'))].join('\n') + '\n';
  const pl = ['sample\tpheno\tage\tsex', ...Array.from({ length: n }, (_, i) => `S${i + 1}\t${y[i]}\t${age[i]}\t${sex[i]}`)].join('\n') + '\n';
  return { genotypes: gl, phenotypes: pl, causal };
}
