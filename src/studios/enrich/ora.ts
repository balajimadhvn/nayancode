/** Over-representation analysis with the hypergeometric upper tail, Benjamini-Hochberg FDR. */
import { bh } from '@/studios/expression/kernels';
import { lgamma } from '@/studios/lab/dist';
import type { GeneSet } from './gmt';

export interface OraOptions { minSize?: number; maxSize?: number }
export interface OraRow {
  name: string;
  /** Set size inside the universe. */
  K: number;
  /** Overlap between the list and the set. */
  k: number;
  /** List size inside the universe. */
  n: number;
  /** Universe size. */
  N: number;
  p: number;
  fdr: number;
  fold: number;
  genes: string[];
}

const logChoose = (n: number, k: number) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
const upper = (g: string) => g.trim().toUpperCase();

/** P(X >= k) for X ~ Hypergeometric(N, K, n), summed in log space. */
export function hypergeomSf(k: number, N: number, K: number, n: number): number {
  const lo = Math.max(k, n - (N - K)), hi = Math.min(K, n);
  if (lo > hi) return 0;
  const lden = logChoose(N, n);
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += Math.exp(logChoose(K, i) + logChoose(N - K, n - i) - lden);
  return Math.min(1, Math.max(0, sum));
}

/**
 * Background defaults to the union of the sets' genes; list genes outside the universe are dropped.
 * Sets with K outside [minSize, maxSize] are skipped. Rows are sorted by p.
 */
export function ora(list: string[], sets: GeneSet[], background?: string[], opts: OraOptions = {}): OraRow[] {
  const { minSize = 5, maxSize = 500 } = opts;
  const universe = new Set((background?.length ? background : sets.flatMap((s) => s.genes)).map(upper).filter(Boolean));
  const N = universe.size;
  const inList = new Set(list.map(upper).filter((g) => g && universe.has(g)));
  const n = inList.size;
  if (!N || !n) return [];
  const rows: OraRow[] = [];
  for (const set of sets) {
    const genes = set.genes.map(upper).filter((g) => universe.has(g));
    const K = genes.length;
    if (K < minSize || K > maxSize) continue;
    const overlap = genes.filter((g) => inList.has(g));
    const k = overlap.length;
    rows.push({
      name: set.name, K, k, n, N,
      p: hypergeomSf(k, N, K, n),
      fdr: NaN,
      fold: k ? (k / n) / (K / N) : 0,
      genes: [...new Set(overlap)],
    });
  }
  rows.sort((a, b) => a.p - b.p || b.fold - a.fold || a.name.localeCompare(b.name));
  const q = bh(rows.map((r) => r.p));
  rows.forEach((r, i) => { r.fdr = q[i]; });
  return rows;
}
