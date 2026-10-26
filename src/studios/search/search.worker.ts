/** Search worker: CPU Smith-Waterman scoring and traceback for the top hits. */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { align } from '@/studios/sequence/kernels';
import { swTopHits } from './sw';

const topHits: Kernel<{ query: string; seqs: string[]; n: number }, { scores: number[]; hits: { index: number; score: number }[]; cells: number }> = (a, ctx) => {
  const r = swTopHits(a.query, a.seqs, a.n, (p) => ctx.progress(p));
  return { scores: Array.from(r.scores), hits: r.hits, cells: r.cells };
};

const trace: Kernel<{ query: string; seqs: string[]; indices: number[] }, ReturnType<typeof align>[]> = (a, ctx) => a.indices.map((i, k) => {
  ctx.progress(k / Math.max(1, a.indices.length));
  return align(a.query, a.seqs[i], { mode: 'local', kind: 'protein' });
});

const kernels = { topHits, trace };
export type SearchKernels = typeof kernels;
exposeKernels(kernels);
