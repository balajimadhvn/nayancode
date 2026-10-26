/**
 * Smith-Waterman local-alignment SCORE with affine gaps (Gotoh), integers.
 * Gap of length k costs GAP_OPEN + GAP_EXTEND*k (BLASTP 'open 11, extend 1'
 * means a single-residue gap costs 12). Pure maths: no DOM, no React.
 */
import { blosum62 } from '@/studios/sequence/kernels';

export const GAP_OPEN = 11;
export const GAP_EXTEND = 1;

/** BLOSUM62 order, as in src/studios/sequence/kernels.ts (B62_ORDER). */
export const RESIDUES = 'ARNDCQEGHILKMFPSTWYVBZX*';
const INDEX = new Map<string, number>([...RESIDUES].map((c, i) => [c, i]));
/** Code 24 is a sentinel for letters that do not occur in BLOSUM62 (e.g. J, O, U). */
export const UNKNOWN = 24;

/** Letters outside BLOSUM62 get the sentinel code and score -1 against everything. */
export function residueCode(ch: string): number {
  return INDEX.get(ch.toUpperCase()) ?? UNKNOWN;
}

export const BLOSUM62_MATRIX: Int8Array = (() => {
  const m = new Int8Array(24 * 24);
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) m[i * 24 + j] = blosum62(RESIDUES[i], RESIDUES[j]);
  }
  return m;
})();

export function encodeResidues(seq: string): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) out[i] = residueCode(seq[i]);
  return out;
}

const NEG = -1_000_000_000;

/**
 * Score-only Gotoh. Subject is the outer loop and the query is the inner loop,
 * so the per-thread working set is two arrays of m+1 integers (m <= 1024 on the
 * GPU path): H[j] (best score) and E[j] (gap opened in an earlier subject row).
 */
export function swCodes(qc: Uint8Array, s: string): number {
  const m = qc.length, n = s.length;
  if (m === 0 || n === 0) return 0;
  const H = new Int32Array(m + 1);
  const E = new Int32Array(m + 1).fill(NEG);
  const mat = BLOSUM62_MATRIX;
  let best = 0;
  for (let i = 1; i <= n; i++) {
    const sc = residueCode(s[i - 1]);
    let hDiag = 0;   // H[i-1][j-1]
    let hLeft = 0;   // H[i][j-1]
    let eLeft = NEG; // gap along the query, current row
    for (let j = 1; j <= m; j++) {
      const hPrev = H[j];
      const vOpen = hPrev - (GAP_OPEN + GAP_EXTEND);
      const vExt = E[j] - GAP_EXTEND;
      const v = vOpen > vExt ? vOpen : vExt;
      E[j] = v;
      const hOpen = hLeft - (GAP_OPEN + GAP_EXTEND);
      const hExt = eLeft - GAP_EXTEND;
      eLeft = hOpen > hExt ? hOpen : hExt;
      const d = hDiag + (qc[j - 1] >= 24 || sc >= 24 ? -1 : mat[qc[j - 1] * 24 + sc]);
      let h = d;
      if (v > h) h = v;
      if (eLeft > h) h = eLeft;
      if (h < 0) h = 0;
      H[j] = h;
      hDiag = hPrev;
      hLeft = h;
      if (h > best) best = h;
    }
  }
  return best;
}

export function swScore(q: string, s: string): number {
  return swCodes(encodeResidues(q), s);
}

export interface SwHit { index: number; score: number }
export interface SwRun { scores: Int32Array; hits: SwHit[]; cells: number }

/** Score every database sequence (CPU, chunked) and keep the best `n`. */
export function swTopHits(q: string, db: readonly string[], n: number, onProgress?: (fraction: number) => void): SwRun {
  const qc = encodeResidues(q);
  const scores = new Int32Array(db.length);
  const hits: SwHit[] = [];
  let cells = 0;
  for (let i = 0; i < db.length; i++) {
    const s = db[i];
    const score = swCodes(qc, s);
    scores[i] = score;
    cells += qc.length * s.length;
    if (hits.length < n || (hits.length > 0 && score > hits[hits.length - 1].score)) {
      let k = hits.length;
      while (k > 0 && hits[k - 1].score < score) k--;
      hits.splice(k, 0, { index: i, score });
      if (hits.length > n) hits.pop();
    }
    if (onProgress && (i & 31) === 0) onProgress(i / Math.max(1, db.length));
  }
  onProgress?.(1);
  return { scores, hits, cells };
}
