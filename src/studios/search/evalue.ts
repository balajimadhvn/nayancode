/**
 * NCBI Karlin-Altschul statistics for gapped BLOSUM62 with gap costs 11/1.
 * Published parameters: lambda = 0.267, K = 0.041 (Altschul et al. 1990/1997).
 * Edge-length corrections are deliberately NOT applied; see searchSpaceNote.
 */
export const LAMBDA = 0.267;
export const K = 0.041;

/** Bit score from a raw Smith-Waterman score. */
export function bitScore(raw: number): number {
  return (LAMBDA * raw - Math.log(K)) / Math.LN2;
}

/** E-value for a raw score against a search space of m query x n database residues. */
export function eValue(raw: number, m: number, n: number): number {
  return m * n * Math.pow(2, -bitScore(raw));
}

export const searchSpaceNote =
  'E-values use the published gapped BLOSUM62 (11/1) lambda and K without edge-effect correction, so very short queries or very short database sequences can look more significant than they are.';
