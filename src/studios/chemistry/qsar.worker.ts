import { exposeKernels, type Kernel } from '@/compute/rpc';
import * as q from './qsar';

export interface QsarArgs { task: q.Task; kind: q.ModelKind; nTrees: number; k: number; kFold: number; cv: 'random' | 'cluster'; yRand: boolean; y: number[]; X: Float32Array[]; fp: Uint32Array[]; featNames: string[]; adCut: number }
export interface QsarResult { metrics: Record<string, number>; pred: number[]; oob: Record<string, number> | null; roc: { fpr: number; tpr: number }[]; importance: { name: string; value: number }[]; yRand: number[]; errByAd: { lo: number; hi: number; n: number; err: number }[]; nTrain: number; nFeat: number; clusters: number }
let cache: { forest?: q.Forest; ridge?: q.Ridge; spec: q.ModelSpec; fp: Uint32Array[]; y: number[]; adCut: number; featNames: string[] } | null = null;

const run: Kernel<QsarArgs, QsarResult> = (a, ctx) => {
  if (a.y.length < 20) throw new Error('Need at least 20 labelled compounds for a meaningful QSAR model.');
  const spec: q.ModelSpec = { kind: a.kind, task: a.task, nTrees: a.nTrees, k: a.k }, d: q.Data = { X: a.X, fp: a.fp, y: a.y };
  if (a.task === 'classification' && new Set(a.y).size < 2) throw new Error('Only one class present after thresholding. Adjust the activity threshold.');
  ctx.progress(0.02, 'Cross-validation');
  const pred = q.crossValidate(spec, d, a.kFold, a.cv, 1, (f) => ctx.progress(0.02 + 0.5 * f, `fold ${Math.round(f * a.kFold)}/${a.kFold}`));
  const ok = pred.map((p, i) => (Number.isFinite(p) ? i : -1)).filter((i) => i >= 0), yy = ok.map((i) => a.y[i]), pp = ok.map((i) => pred[i]);
  const metrics = a.task === 'regression' ? q.regressionMetrics(yy, pp) : q.classificationMetrics(yy, pp);
  ctx.progress(0.55, 'Final model');
  let importance: QsarResult['importance'] = [], oob: QsarResult['oob'] = null; let forest: q.Forest | undefined, ridge: q.Ridge | undefined;
  if (a.kind === 'rf') { forest = q.trainForest(a.X, a.y, a.task, { nTrees: a.nTrees, seed: 3 }); const idx = Array.from(forest.importance).map((v, i) => [v, i] as const).sort((x, y) => y[0] - x[0]).slice(0, 20); importance = idx.map(([v, i]) => ({ name: a.featNames[i] ?? `f${i}`, value: v })); const o = Array.from(forest.oob!), good = o.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0); oob = (a.task === 'regression' ? q.regressionMetrics(good.map((i) => a.y[i]), good.map((i) => o[i])) : q.classificationMetrics(good.map((i) => a.y[i]), good.map((i) => o[i]))) as unknown as Record<string, number>; }
  else if (a.kind === 'ridge') { ridge = q.trainRidge(a.X, a.y, 1); const w = Array.from(ridge.w).map((v, i) => [Math.abs(v), i] as const).sort((x, y) => y[0] - x[0]).slice(0, 20), tot = w.reduce((s, x) => s + x[0], 0) || 1; importance = w.map(([v, i]) => ({ name: a.featNames[i] ?? `f${i}`, value: v / tot })); }
  let yr: number[] = []; if (a.yRand) { ctx.progress(0.7, 'Y-randomisation'); yr = q.yRandomization({ ...spec, nTrees: Math.min(spec.nTrees, 40) }, d, Math.min(5, a.kFold), 5); }
  ctx.progress(0.92, 'Applicability domain');
  const nn = a.fp.map((f, i) => { let best = 0; for (let j = 0; j < a.fp.length; j++) if (j !== i) { const s = q.tanimoto(f, a.fp[j]); if (s > best) best = s; } return best; });
  const bins = [[0, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 1.01]], errByAd = bins.map(([lo, hi]) => { const ix = ok.filter((i) => nn[i] >= lo && nn[i] < hi); const err = ix.length ? Math.sqrt(ix.reduce((s, i) => s + (a.y[i] - pred[i]) ** 2, 0) / ix.length) : NaN; return { lo, hi, n: ix.length, err }; });
  cache = { forest, ridge, spec, fp: a.fp, y: a.y, adCut: a.adCut, featNames: a.featNames };
  return { metrics: metrics as unknown as Record<string, number>, pred, oob, roc: a.task === 'classification' ? q.rocCurve(yy, pp) : [], importance, yRand: yr, errByAd, nTrain: a.y.length, nFeat: a.X[0].length, clusters: q.butina(a.fp, 0.6).sizes.length };
};
const predict: Kernel<{ X: Float32Array[]; fp: Uint32Array[] }, { pred: number[]; maxSim: number[]; meanTop3: number[] }> = (a) => {
  if (!cache) throw new Error('No trained model in memory (the worker was restarted). Run the model again.');
  const pred = cache.spec.kind === 'rf' ? q.predictForest(cache.forest!, a.X) : cache.spec.kind === 'ridge' ? q.predictRidge(cache.ridge!, a.X) : q.knnPredict(cache.fp, cache.y, a.fp, cache.spec.k);
  const ad = q.applicabilityDomain(cache.fp, a.fp, 3); return { pred, maxSim: ad.map((x) => x.maxSim), meanTop3: ad.map((x) => x.meanTopK) };
};
const space: Kernel<{ fp: Uint32Array[]; cutoff: number }, { cluster: number[]; centroids: number[]; sizes: number[]; xy: { x: number; y: number }[] }> = (a, ctx) => { ctx.progress(0.1, 'Butina clustering'); const b = q.butina(a.fp, a.cutoff); ctx.progress(0.6, 'PCA'); return { ...b, xy: q.pca2(a.fp) }; };
export type QsarKernels = { run: typeof run; predict: typeof predict; space: typeof space };
exposeKernels({ run, predict, space } as Record<string, Kernel>);
