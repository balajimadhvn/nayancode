import { exposeKernels, type Kernel } from '@/compute/rpc';
import * as k from './kernels';
import { unifrac } from './unifrac';

export type Metric = k.BetaMetric | 'unifrac-unweighted' | 'unifrac-weighted';
export interface MbArgs { table: string; meta: string; groupCol: string; tree: string; metric: Metric; rank: number; perms: number; groupA: string; groupB: string; minPrev: number }
const analyse: Kernel<MbArgs, { samples: string[]; groups: string[]; alpha: k.Alpha[]; alphaP: Record<string, number>; D: number[][]; pcoa: ReturnType<typeof k.pcoa>; permanova: ReturnType<typeof k.permanova> | null; taxa: ReturnType<typeof k.aggregateTaxa>; da: k.DaRow[] | null; daError: string | null; rare: { sample: string; pts: { depth: number; richness: number }[] }[]; nFeatures: number; treeNote: string }> = (a, ctx) => {
  ctx.progress(0.05, 'Parsing'); const t = k.parseFeatureTable(a.table), meta = k.parseMetadata(a.meta, t.samples), groups = meta.values[a.groupCol] ?? t.samples.map(() => 'all');
  ctx.progress(0.15, 'Alpha diversity'); const alpha = k.alphaDiversity(t);
  const alphaP: Record<string, number> = {}; if (new Set(groups).size > 1) for (const key of ['observed', 'shannon', 'simpson', 'chao1', 'pielou'] as const) alphaP[key] = k.compareGroups(alpha.map((x) => x[key]), groups);
  ctx.progress(0.3, `Beta diversity (${a.metric})`); let treeNote = ''; let D: number[][]; if (a.metric.startsWith('unifrac')) { if (!a.tree.trim()) throw new Error('UniFrac needs a phylogenetic tree (Newick) whose tip names equal the feature IDs. Build one in the Phylogenetics Studio, or load the demo.'); const u = unifrac(t, a.tree); D = a.metric === 'unifrac-weighted' ? u.weighted : u.unweighted; treeNote = `${u.usedFeatures} of ${t.features.length} features matched tree tips${u.droppedFeatures.length ? ` (${u.droppedFeatures.length} dropped)` : ''}`; } else D = k.betaDiversity(t, a.metric as k.BetaMetric); const pc = k.pcoa(D, 3);
  ctx.progress(0.5, 'PERMANOVA'); let pm: ReturnType<typeof k.permanova> | null = null; try { if (new Set(groups).size > 1) pm = k.permanova(D, groups, a.perms, 1); } catch { pm = null; }
  ctx.progress(0.75, 'Composition'); const taxa = k.aggregateTaxa(t, a.rank, 10);
  ctx.progress(0.85, 'Differential abundance'); let da: k.DaRow[] | null = null, daError: string | null = null; try { if (a.groupA && a.groupB) da = k.differentialAbundance(t, groups, a.groupA, a.groupB, a.minPrev); } catch (e) { daError = (e as Error).message; }
  ctx.progress(0.95, 'Rarefaction'); const rare = t.samples.map((s, j) => ({ sample: s, pts: k.rarefactionCurve(t, j, 12) }));
  return { treeNote, samples: t.samples, groups, alpha, alphaP, D, pcoa: pc, permanova: pm, taxa, da, daError, rare, nFeatures: t.features.length };
};
export type MbKernels = { analyse: typeof analyse };
exposeKernels({ analyse } as Record<string, Kernel>);
