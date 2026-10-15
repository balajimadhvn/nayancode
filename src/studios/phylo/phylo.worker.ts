import { exposeKernels, type Kernel } from '@/compute/rpc';
import * as k from './kernels';
import { inferMl, type MlModel } from './ml';

export interface TreeJob { names: string[]; aligned: string[]; model: k.DistModel; method: 'nj' | 'upgma' | 'ml'; reps: number; root: 'midpoint' | 'none'; ml?: { model: MlModel; gamma: boolean } }
export interface MlStats { logL: number; aic: number; bic: number; k: number; alpha: number | null; model: string; rounds: number }
const msa: Kernel<{ names: string[]; seqs: string[]; kind: k.SeqKind }, k.MsaResult & { cons: k.Conservation; identity: number[][] }> = (a, ctx) => {
  const r = k.progressiveMsa(a.names, a.seqs, a.kind, ctx.progress);
  return { ...r, cons: k.conservation(r.aligned, a.kind), identity: k.identityMatrix(r.aligned) };
};
const tree: Kernel<TreeJob, { newick: string; supported: boolean; distMax: number; D: number[][]; ml?: MlStats }> = (a, ctx) => {
  const L = a.aligned[0]?.length ?? 0; if (!L || new Set(a.aligned.map((r) => r.length)).size !== 1) throw new Error('Sequences must be aligned (equal length). Run the aligner first.');
  ctx.progress(0.05, 'Distances'); const D = k.distanceMatrix(a.aligned, a.model);
  if (a.method === 'ml') {
    ctx.progress(0.1, 'Starting tree (NJ)'); const start = k.nj(D, a.names), r = inferMl(a.aligned, a.names, start, { model: a.ml!.model, gamma: a.ml!.gamma }, (f, n) => ctx.progress(0.1 + 0.88 * f, n)); const rooted = a.root === 'midpoint' ? k.midpointRoot(r.tree) : r.tree;
    return { newick: k.toNewick(rooted), supported: false, distMax: Math.max(...D.flat()), D, ml: { logL: r.logL, aic: r.aic, bic: r.bic, k: r.k, alpha: r.alpha, model: r.model, rounds: r.rounds } };
  }
  ctx.progress(0.15, a.method === 'nj' ? 'Neighbour joining' : 'UPGMA'); let t = a.method === 'nj' ? k.nj(D, a.names) : k.upgma(D, a.names);
  if (a.root === 'midpoint' && a.method === 'nj') t = k.midpointRoot(t);
  if (a.reps > 0) t = k.bootstrapSupport(a.aligned, a.names, t, a.model, a.method, a.reps, (p) => ctx.progress(0.2 + 0.78 * p, `Bootstrap ${Math.round(p * a.reps)}/${a.reps}`));
  return { newick: k.toNewick(t), supported: a.reps > 0, distMax: Math.max(...D.flat()), D };
};
export type PhyloKernels = { msa: typeof msa; tree: typeof tree };
exposeKernels({ msa, tree } as Record<string, Kernel>);
