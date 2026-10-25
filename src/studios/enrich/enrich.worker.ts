/** GSEA worker: permutations keep the interface responsive on large lists. */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { gsea, type GseaResult } from './gsea';
import type { GeneSet, RankedGene } from './gmt';

export interface GseaRequest {
  ranked: RankedGene[];
  sets: GeneSet[];
  opts: { perms: number; seed: number; minSize: number; maxSize: number; weight: number };
}

const runGsea: Kernel<GseaRequest, GseaResult> = async (a, ctx) => {
  ctx.progress(0.1, `${a.sets.length} gene sets`);
  const out = gsea(a.ranked, a.sets, a.opts);
  ctx.progress(1, 'done');
  return out;
};

export type EnrichKernels = { gsea: typeof runGsea };
exposeKernels({ gsea: runGsea } as Record<string, Kernel>);
