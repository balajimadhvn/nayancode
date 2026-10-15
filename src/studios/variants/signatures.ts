/** Mutational signatures without any restricted reference data.
 *  - SBS-96 trinucleotide contexts from a user-supplied reference FASTA
 *  - de novo extraction by NMF (Lee & Seung multiplicative updates, KL divergence) with restart stability for choosing k
 *  - NNLS refitting (Lawson–Hanson) against ANY reference matrix you upload (COSMIC requires a commercial licence, so none is bundled)
 *  - cosine matching. Clean-room implementation. */
import type { Variant } from './kernels';

export const SUBS = ['C>A', 'C>G', 'C>T', 'T>A', 'T>C', 'T>G'] as const;
export const CHANNELS: string[] = SUBS.flatMap((s) => 'ACGT'.split('').flatMap((l) => 'ACGT'.split('').map((r) => `${l}[${s}]${r}`)));
const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
export const channelIndex = new Map(CHANNELS.map((c, i) => [c, i]));

/** Channel for an SNV given its flanking bases; pyrimidine-referenced. Returns -1 if not a clean SNV context. */
export function sbs96Channel(left: string, ref: string, alt: string, right: string): number {
  [left, ref, alt, right] = [left, ref, alt, right].map((x) => x.toUpperCase());
  if (!COMP[ref] || !COMP[alt] || !COMP[left] || !COMP[right] || ref === alt) return -1;
  if (ref === 'A' || ref === 'G') { const l = COMP[right], r = COMP[left]; left = l; right = r; ref = COMP[ref]; alt = COMP[alt]; }
  return channelIndex.get(`${left}[${ref}>${alt}]${right}`) ?? -1;
}
export function parseFastaMap(text: string): Map<string, string> {
  const m = new Map<string, string>(); let name = '', parts: string[] = [];
  const flush = () => { if (name) m.set(name.replace(/^chr/i, ''), parts.join('').toUpperCase()); };
  for (const l of text.split(/\r?\n/)) { if (l.startsWith('>')) { flush(); name = l.slice(1).trim().split(/\s+/)[0]; parts = []; } else parts.push(l.trim()); }
  flush(); return m;
}
export function sbs96Counts(variants: Variant[], genome: Map<string, string>, sampleIdx = -1): { counts: Float64Array; used: number; skipped: number; missingContig: number } {
  const counts = new Float64Array(96); let used = 0, skipped = 0, missingContig = 0;
  for (const v of variants) {
    if (v.type !== 'SNV') continue;
    if (sampleIdx >= 0) { const c = v.calls[sampleIdx]; if (!c || c.gt === '0/0' || c.gt.includes('.')) continue; }
    const seq = genome.get(v.chrom.replace(/^chr/i, '')); if (!seq) { missingContig++; continue; }
    const p = v.pos - 1; if (p < 1 || p >= seq.length - 1) { skipped++; continue; }
    if (seq[p] !== v.ref) { skipped++; continue; } // reference mismatch: wrong assembly or contig
    const ch = sbs96Channel(seq[p - 1], v.ref, v.alt, seq[p + 1]); if (ch < 0) { skipped++; continue; } counts[ch]++; used++;
  }
  return { counts, used, skipped, missingContig };
}

// ---------------- linear algebra helpers ----------------
export const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; };

/** Lawson–Hanson NNLS: min ||A x − b||, x ≥ 0. A is m×n (array of m rows). */
export function nnls(A: number[][], b: number[], maxIter = 300): number[] {
  const m = A.length, n = A[0].length, x = new Array(n).fill(0), P = new Set<number>();
  const Ax = (v: number[]) => A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
  const grad = () => { const r = b.map((bi, i) => bi - Ax(x)[i]); return Array.from({ length: n }, (_, j) => A.reduce((s, row, i) => s + row[j] * r[i], 0)); };
  const solveLS = (idx: number[]) => { // normal equations on the passive set
    const k = idx.length, M = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => A.reduce((s, row) => s + row[idx[i]] * row[idx[j]], 0) + (i === j ? 1e-12 : 0))), y = idx.map((c) => A.reduce((s, row, i) => s + row[c] * b[i], 0));
    for (let c = 0; c < k; c++) { let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; [y[c], y[piv]] = [y[piv], y[c]]; for (let r = c + 1; r < k; r++) { const f = M[r][c] / M[c][c]; for (let q = c; q < k; q++) M[r][q] -= f * M[c][q]; y[r] -= f * y[c]; } }
    const z = new Array(k).fill(0); for (let r = k - 1; r >= 0; r--) { let s = y[r]; for (let q = r + 1; q < k; q++) s -= M[r][q] * z[q]; z[r] = s / M[r][r]; } return z;
  };
  void m;
  for (let it = 0; it < maxIter; it++) {
    const w = grad(); let best = -1, bw = 1e-10; for (let j = 0; j < n; j++) if (!P.has(j) && w[j] > bw) { bw = w[j]; best = j; } if (best < 0) break; P.add(best);
    for (let inner = 0; inner < 100; inner++) {
      const idx = [...P], z = solveLS(idx); if (z.every((v) => v > 0)) { idx.forEach((c, i) => { x[c] = z[i]; }); break; }
      let alpha = Infinity; idx.forEach((c, i) => { if (z[i] <= 0) alpha = Math.min(alpha, x[c] / (x[c] - z[i] || 1e-300)); });
      idx.forEach((c, i) => { x[c] += alpha * (z[i] - x[c]); }); for (const c of idx) if (x[c] < 1e-12) { x[c] = 0; P.delete(c); }
    }
  }
  return x;
}

// ---------------- NMF ----------------
export interface Nmf { W: number[][]; H: number[][]; error: number }
export function nmf(V: number[][], k: number, seed = 1, iters = 400): Nmf {
  const S = V.length, C = V[0].length; let s = seed >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const W = Array.from({ length: S }, () => Array.from({ length: k }, () => 0.1 + rnd())), H = Array.from({ length: k }, () => Array.from({ length: C }, () => 0.1 + rnd())), eps = 1e-10;
  const WH = () => W.map((w) => Array.from({ length: C }, (_, c) => { let t = 0; for (let a = 0; a < k; a++) t += w[a] * H[a][c]; return t + eps; }));
  for (let it = 0; it < iters; it++) {
    let R = WH();
    for (let a = 0; a < k; a++) { const colSum = W.reduce((t, w) => t + w[a], 0) + eps; for (let c = 0; c < C; c++) { let num = 0; for (let i = 0; i < S; i++) num += (W[i][a] * V[i][c]) / R[i][c]; H[a][c] *= num / colSum; } }
    R = WH();
    for (let a = 0; a < k; a++) { const rowSum = H[a].reduce((t, h) => t + h, 0) + eps; for (let i = 0; i < S; i++) { let num = 0; for (let c = 0; c < C; c++) num += (H[a][c] * V[i][c]) / R[i][c]; W[i][a] *= num / rowSum; } }
  }
  const R = WH(); let err = 0; for (let i = 0; i < S; i++) for (let c = 0; c < C; c++) { const v = V[i][c], r = R[i][c]; err += v > 0 ? v * Math.log(v / r) - v + r : r; }
  return { W, H, error: err };
}
export interface Extraction { k: number; signatures: number[][]; exposures: number[][]; error: number; stability: number; cosineToInput: number }
/** Extract k de novo signatures; stability = mean best-match cosine of signatures across independent restarts. */
export function extractSignatures(V: number[][], k: number, restarts = 8, progress?: (f: number) => void): Extraction {
  const runs: Nmf[] = []; for (let r = 0; r < restarts; r++) { runs.push(nmf(V, k, 11 + r * 97)); progress?.((r + 1) / restarts); }
  runs.sort((a, b) => a.error - b.error); const best = runs[0];
  const norm = (H: number[][]) => H.map((h) => { const t = h.reduce((a, b) => a + b, 0) || 1; return h.map((v) => v / t); });
  const sigBest = norm(best.H); let stab = 0, n = 0;
  for (const r of runs.slice(1)) { const sr = norm(r.H); for (const sb of sigBest) { stab += Math.max(...sr.map((x) => cosine(sb, x))); n++; } }
  const exposures = best.W.map((w) => w.map((x, a) => x * (best.H[a].reduce((p, q) => p + q, 0))));
  const recon = best.W.map((w) => best.H[0].map((_, c) => w.reduce((t, wa, a) => t + wa * best.H[a][c], 0)));
  const cos = V.reduce((t, row, i) => t + cosine(row, recon[i]), 0) / V.length;
  return { k, signatures: sigBest, exposures, error: best.error, stability: n ? stab / n : 1, cosineToInput: cos };
}
export function refit(sample: number[], signatures: number[][]): { exposures: number[]; cosine: number } {
  const A = Array.from({ length: sample.length }, (_, c) => signatures.map((s) => s[c])), x = nnls(A, sample), recon = A.map((row) => row.reduce((t, a, j) => t + a * x[j], 0));
  return { exposures: x, cosine: cosine(sample, recon) };
}

/** Reference matrix TSV: first column = channel (e.g. A[C>A]A), remaining columns = signatures (header = names). */
export function parseSignatureMatrix(text: string): { names: string[]; sigs: number[][] } {
  const lines = text.split(/\r?\n/).filter(Boolean), d = lines[0].includes('\t') ? '\t' : ',', head = lines[0].split(d).map((x) => x.trim()), names = head.slice(1);
  const sigs = names.map(() => new Array(96).fill(NaN)); let n = 0;
  for (const l of lines.slice(1)) { const f = l.split(d).map((x) => x.trim()); const ch = f[0].replace(/\s/g, ''); const i = channelIndex.get(ch); if (i === undefined) continue; n++; f.slice(1).forEach((v, j) => { sigs[j][i] = Number(v); }); }
  if (n < 96) throw new Error(`Found ${n} of 96 SBS channels. Rows must be named like A[C>A]A (5′ base, [ref>alt], 3′ base).`);
  return { names, sigs: sigs.map((s) => { const t = s.reduce((a, b) => a + b, 0) || 1; return s.map((v) => v / t); }) };
}

/** Two synthetic, clearly-labelled signature shapes for demos and tests (NOT COSMIC signatures). */
export function demoSignatures(): { names: string[]; sigs: number[][] } {
  const a = CHANNELS.map((c) => (c.includes('[C>T]') ? (c.endsWith(']G') ? 6 : 3) : 0.15)), b = CHANNELS.map((c) => (c.includes('[T>C]') ? 2.5 : c.includes('[C>A]') && c.startsWith('C') ? 2 : 0.2));
  const n = (v: number[]) => { const t = v.reduce((x, y) => x + y, 0); return v.map((x) => x / t); }; return { names: ['Demo-A (C>T at CpG)', 'Demo-B (T>C / CC>CA)'], sigs: [n(a), n(b)] };
}
export function demoCohort(samples = 30, seed = 4): { V: number[][]; truthExposure: number[][]; names: string[] } {
  const { sigs } = demoSignatures(); let s = seed >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pois = (l: number): number => { if (l > 30) return Math.max(0, Math.round(l + Math.sqrt(l) * Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()))); const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
  const truth = Array.from({ length: samples }, (_, i) => (i % 3 === 0 ? [800 + rnd() * 600, 50 + rnd() * 60] : i % 3 === 1 ? [60 + rnd() * 80, 700 + rnd() * 500] : [300 + rnd() * 300, 300 + rnd() * 300]));
  return { V: truth.map((e) => Array.from({ length: 96 }, (_, c) => pois(e[0] * sigs[0][c] + e[1] * sigs[1][c]))), truthExposure: truth, names: truth.map((_, i) => `S${i + 1}`) };
}

/** Smallest k after which the reconstruction error stops improving materially (elbow) and restarts are reproducible. */
export function suggestK(curve: { k: number; error: number; stability: number }[], elbow = 0.04, minStability = 0.9): number {
  if (curve.length < 2) return curve[0]?.k ?? 1;
  const total = curve[0].error - curve[curve.length - 1].error || 1;
  for (let i = 0; i < curve.length - 1; i++) if ((curve[i].error - curve[i + 1].error) / total < elbow && curve[i].stability >= minStability) return curve[i].k;
  return curve[curve.length - 1].k;
}
