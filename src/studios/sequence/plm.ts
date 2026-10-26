/** Pure math functions for ESM-2 protein language model.
 *
 * These functions take a logits provider so they can be tested without the model.
 * When the model is loaded, the same functions can operate on the model's logits.
 */

/** Log-softmax of a row (returns log probabilities that sum to 1 in prob space). */
export function logSoftmax(row: Float32Array): Float32Array {
  const max = Math.max(...row);
  const sum = row.reduce((acc, v) => acc + Math.exp(v - max), 0);
  return row.map((v) => v - max - Math.log(sum));
}

/** maskedMarginalLlr(logits, wtIndex, mutIndex).
 *  Log p(mut) - log p(wt) after log-softmax. The normaliser cancels, but the
 *  implementation deliberately runs log-softmax so it matches the hand formula.
 */
export function maskedMarginalLlr(logits: ArrayLike<number>, wtIndex: number, mutIndex: number): number {
  const lp = logSoftmax(Float32Array.from(logits));
  return (lp[mutIndex] ?? NaN) - (lp[wtIndex] ?? NaN);
}

/** maskedMarginal(wt, mut, logitsAtMasked, vocab).
 *  Returns log p(mut) - log p(wt) at the masked position.
 *  Positive means the mutant is favoured over the wild type.
 */
export function maskedMarginal(
  wt: string,
  mut: string,
  logitsAtMasked: Float32Array,
  vocab: Record<string, number>,
): number {
  const logwt = logitsAtMasked[vocab[wt] ?? -1] ?? -Infinity;
  const logmut = logitsAtMasked[vocab[mut] ?? -1] ?? -Infinity;
  if (logwt === -Infinity || logmut === -Infinity) return NaN;
  return logmut - logwt;
}

/** pseudoPerplexity(logProbsOfTruth).
 *  exp(−mean(logProbs)): a measure of how surprising the truth is under the model.
 */
export function pseudoPerplexity(logProbsOfTruth: number[]): number {
  if (!logProbsOfTruth.length) return 1;
  const mean = logProbsOfTruth.reduce((a, b) => a + b, 0) / logProbsOfTruth.length;
  return Math.exp(-mean);
}

/** meanPool(hidden, mask).
 *  If mask is provided, only average the hidden states at masked positions.
 *  Otherwise average all positions.
 */
export function meanPool(hidden: Float32Array[], mask?: boolean[]): Float32Array | undefined {
  if (!hidden.length) return undefined;
  const n = hidden[0].length;
  if (mask) {
    const active = mask.filter((m) => m).length;
    if (!active) return new Float32Array(n);
    const sum = new Float32Array(n);
    for (let i = 0; i < hidden.length; i++) {
      if (!mask[i]) continue;
      for (let j = 0; j < n; j++) sum[j] += hidden[i][j];
    }
    return sum.map((s) => s / active);
  } else {
    const sum = new Float32Array(n);
    for (const h of hidden) for (let j = 0; j < n; j++) sum[j] += h[j];
    return sum.map((s) => s / hidden.length);
  }
}

/** parseMutation('A123G', seq) → validates the wild-type residue matches seq[pos]; throws a clear error otherwise. */
export function parseMutation(mutation: string, seq: string): { pos: number; wt: string; mut: string } {
  const m = mutation.match(/^([A-Z])(\d+)([A-Z])$/);
  if (!m) throw new Error(`Invalid mutation format: "${mutation}". Expected format: ResidueNumberResidue, e.g. "A123G".`);
  const [, wt, numStr, mut] = m;
  const pos = Number(numStr) - 1; // 1-indexed to 0-indexed
  if (pos < 0 || pos >= seq.length) throw new Error(`Position ${pos + 1} is out of range for sequence of length ${seq.length}.`);
  if (seq[pos] !== wt) throw new Error(`Wild-type mismatch: position ${pos + 1} expects "${wt}" but sequence has "${seq[pos]}".`);
  return { pos, wt, mut };
}
// ---------------------------------------------------------------- full-sequence scans
export const AMINO_ACIDS = 'ACDEFGHIKLMNPQRSTVWY';
export interface ScanResult {
  /** logP[pos][a]: log-probability of amino acid AMINO_ACIDS[a] at residue pos when that position is masked */
  logP: Float32Array[];
  wtLogP: number[];
  /** exp(−mean log p(wild type)) over all positions (pseudo-perplexity, Salazar et al. 2020) */
  pseudoPerplexity: number;
}
/** Masks every residue in turn. `logitsAt(pos)` must return the model's logits for the masked position; `vocab` maps a residue letter to its logit index. */
export async function scanProfile(seq: string, logitsAt: (pos: number) => Promise<Float32Array> | Float32Array, vocab: Record<string, number>, onProgress?: (f: number) => void): Promise<ScanResult> {
  return scanProfileBatched(seq, async (positions) => [await logitsAt(positions[0])], vocab, 1, onProgress);
}

/** Same scan, but the model may score several masked positions in one batched forward pass.
 *  `logitsBatch(positions)` must return one full-vocabulary logits row per requested position.
 *  The result is identical to calling `scanProfile` position by position. */
export async function scanProfileBatched(seq: string, logitsBatch: (positions: number[]) => Promise<Float32Array[]>, vocab: Record<string, number>, batchSize = 8, onProgress?: (f: number) => void): Promise<ScanResult> {
  const logP: Float32Array[] = [], wt: number[] = [];
  for (let start = 0; start < seq.length; start += batchSize) {
    const positions: number[] = [];
    for (let i = start; i < Math.min(seq.length, start + batchSize); i++) positions.push(i);
    const rows = await logitsBatch(positions);
    if (rows.length !== positions.length) throw new Error(`The model returned ${rows.length} rows for ${positions.length} masked positions.`);
    positions.forEach((i, b) => {
      const lp = logSoftmax(rows[b]);
      logP.push(Float32Array.from(AMINO_ACIDS, (a) => lp[vocab[a]])); wt.push(lp[vocab[seq[i]]] ?? NaN);
      onProgress?.((i + 1) / seq.length);
    });
  }
  return { logP, wtLogP: wt, pseudoPerplexity: pseudoPerplexity(wt.filter(Number.isFinite)) };
}
/** log p(mutant) − log p(wild type) at one position of a scan. */
export const effectFromScan = (s: ScanResult, seq: string, pos: number, mut: string) => s.logP[pos][AMINO_ACIDS.indexOf(mut)] - s.logP[pos][AMINO_ACIDS.indexOf(seq[pos])];
/** Mean masked-marginal effect of all 19 substitutions at each position (more negative = the model finds the position constrained). */
export const positionConstraint = (s: ScanResult, seq: string) => s.logP.map((_, i) => { let t = 0, n = 0; for (const a of AMINO_ACIDS) if (a !== seq[i]) { t += effectFromScan(s, seq, i, a); n++; } return n ? t / n : NaN; });

/** 20 x L matrix of log p(mutant) - log p(wild type); the wild-type cell in every column is exactly 0. */
export function heatmapMatrix(s: ScanResult, seq: string): number[][] {
  return [...AMINO_ACIDS].map((a) => s.logP.map((row, i) => row[AMINO_ACIDS.indexOf(a)] - row[AMINO_ACIDS.indexOf(seq[i])]));
}

/** Cosine similarity between two vectors. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i],
      vb = b[i];
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (na === 0 || nb === 0) return NaN;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Simple 2D PCA via power iteration on covariance (for small N,D). */
export function pca2(vectors: Float32Array[] | number[][]): { points: [number, number][]; explained: [number, number] } {
  if (!vectors.length) return { points: [], explained: [0, 0] };
  const n = vectors.length;
  const d = vectors[0].length;
  // mean center
  const mean = new Float32Array(d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) mean[j] += vectors[i][j] / n;
  const X = vectors.map((v) => {
    const r = new Float32Array(d);
    for (let j = 0; j < d; j++) r[j] = v[j] - mean[j];
    return r;
  });
  // top component via power iteration on X^T X approx? easier: covariance C = (1/(n-1)) X^T X
  const C = Array(d).fill(0).map(() => Array(d).fill(0));
  for (let i = 0; i < n; i++) {
    const x = X[i];
    for (let p = 0; p < d; p++) {
      for (let q = p; q < d; q++) {
        const val = (x[p] * x[q]) / (n - 1);
        C[p][q] += val;
        if (q !== p) C[q][p] += val;
      }
    }
  }
  function topEigen(m: number[][], dim: number): { vec: Float32Array; val: number } {
    let v = new Float32Array(dim).fill(1 / Math.sqrt(dim));
    for (let iter = 0; iter < 50; iter++) {
      const mv = new Float32Array(dim);
      for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) mv[i] += m[i][j] * v[j];
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += mv[i] * mv[i];
      norm = Math.sqrt(norm);
      if (norm < 1e-18) break;
      for (let i = 0; i < dim; i++) v[i] = mv[i] / norm;
    }
    let val = 0;
    const mv2 = new Float32Array(dim);
    for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) mv2[i] += m[i][j] * v[j];
    for (let i = 0; i < dim; i++) val += mv2[i] * v[i];
    return { vec: v, val };
  }
  const e1 = topEigen(C, d);
  // deflate
  const C2 = C.map((row, i) => row.map((c, j) => c - e1.val * e1.vec[i] * e1.vec[j]));
  const e2 = topEigen(C2, d);
  const points: [number, number][] = X.map((x) => {
    let p1 = 0,
      p2 = 0;
    for (let j = 0; j < d; j++) {
      p1 += x[j] * e1.vec[j];
      p2 += x[j] * e2.vec[j];
    }
    return [p1, p2];
  });
  const total = e1.val + e2.val + 1e-18;
  return { points, explained: [e1.val / total, e2.val / total] };
}

/** Verify SHA-256 hex digest of a string/bytes (browser). */
export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
