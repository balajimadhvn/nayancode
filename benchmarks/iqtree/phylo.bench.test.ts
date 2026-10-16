// Alignment & Phylogenetics (maximum likelihood) vs IQ-TREE on four public alignments (see make-reference.sh).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { distanceMatrix, leaves, nj, parseNewick, supportFromTrees, toNewick, type TreeNode } from '@/studios/phylo/kernels';
import { inferMl, logLikelihood, type MlModel } from '@/studios/phylo/ml';
import { parseFasta } from '@/studios/sequence/kernels';
import { pearson, readGz, round, spearman, writeJson } from '../lib/metrics';
import { parallelReplicates } from '../lib/parallel';

const W = 'benchmarks/.cache/iqtree/'; mkdirSync(W, { recursive: true });
const DATA = [
  { ds: 'woodmouse', model: 'HKY85' as MlModel, boot: 100 },
  { ds: 'Laurasiatherian', model: 'HKY85' as MlModel, boot: 100 },
  { ds: 'chloroplast', model: 'Poisson' as MlModel, boot: 0 },
  { ds: 'yeast', model: 'HKY85' as MlModel, boot: 0 },
];

/** Non-trivial bipartitions of an unrooted tree, each as the sorted side not containing names[0]. */
function splits(t: TreeNode, names: string[]): Map<string, number | undefined> {
  const n = names.length, idx = new Map(names.map((x, i) => [x, i])), out = new Map<string, number | undefined>();
  const rec = (x: TreeNode): number[] => { if (!x.children.length) return [idx.get(x.name!)!]; const s = x.children.flatMap(rec); if (s.length > 1 && s.length < n - 1) { const set = new Set(s), side = set.has(0) ? [...Array(n).keys()].filter((k) => !set.has(k)) : s; const key = side.sort((a, b) => a - b).join(','); if (side.length > 1 && side.length < n - 1) out.set(key, x.support); } return s; };
  rec(t); return out;
}
const nrf = (a: TreeNode, b: TreeNode, names: string[]) => { const A = splits(a, names), B = splits(b, names); let d = 0; for (const k of A.keys()) if (!B.has(k)) d++; for (const k of B.keys()) if (!A.has(k)) d++; return d / (2 * (names.length - 3)); };
const IQ_NAME: Record<string, string> = { JC69: 'JC', K80: 'K2P', HKY85: 'HKY', Poisson: 'Poisson' };

describe('Alignment & Phylogenetics against IQ-TREE', async () => {
  const results: Record<string, unknown> = {};
  for (const { ds, model, boot } of DATA) {
    const ref = JSON.parse(readFileSync(`benchmarks/iqtree/ref/${ds}.json`, 'utf8'));
    const recs = parseFasta(readGz(`benchmarks/iqtree/data/${ds}.fa.gz`)), aln = recs.map((r) => r.seq), names = recs.map((r) => r.id);
    const start = nj(distanceMatrix(aln, model === 'Poisson' ? 'poisson' : 'jc'), names);
    const t0 = performance.now(); const ml = inferMl(aln, names, start, { model, gamma: true }); const secs = (performance.now() - t0) / 1000;
    writeFileSync(`${W}${ds}.workbench.nwk`, toNewick(ml.tree) + '\n');
    const iqTree = parseNewick(ref.tree);
    // The Workbench likelihood on IQ-TREE's topology (branch lengths, κ and α re-optimised, no topology search).
    const onIq = inferMl(aln, names, iqTree, { model, gamma: true, maxRounds: 0 });
    // Model selection by BIC on a fixed topology, as ModelFinder does.
    const cands: MlModel[] = model === 'Poisson' ? ['Poisson'] : ['JC69', 'K80', 'HKY85'];
    const mf = cands.flatMap((m) => [false, true].map((g) => { const r = inferMl(aln, names, ml.tree, { model: m, gamma: g, maxRounds: 0 }); return { name: `${IQ_NAME[m]}${m === 'HKY85' ? '+F' : ''}${g ? '+G4' : ''}`, bic: r.bic }; /* IQ-TREE names HKY with empirical frequencies HKY+F */ })).sort((a, b) => a.bic - b.bic);
    const evalPath = `benchmarks/iqtree/ref/${ds}.eval.json`, iqOnWorkbench = existsSync(evalPath) ? JSON.parse(readFileSync(evalPath, 'utf8')).logL as number : null;
    let bootstrap: Record<string, number> | null = null;
    if (boot && ref.bootstrapTree) {
      const b0 = performance.now(), reps = await parallelReplicates(aln, names, { model, gamma: true, alpha: ml.alpha ?? 1, kappa: ml.kappa ?? 2 }, boot), bsecs = (performance.now() - b0) / 1000;
      // Support for the same splits: Workbench bootstrap on IQ-TREE's ML topology vs IQ-TREE's standard bootstrap.
      const ours = splits(supportFromTrees(parseNewick(ref.bootstrapTree), names, reps.map((r) => parseNewick(r))), names), theirs = splits(parseNewick(ref.bootstrapTree), names);
      const keys = [...theirs.keys()].filter((k) => theirs.get(k) !== undefined && ours.get(k) !== undefined), a = keys.map((k) => ours.get(k)!), b = keys.map((k) => theirs.get(k)!);
      bootstrap = { replicates: boot, splits: keys.length, pearson: round(pearson(a, b), 3), spearman: round(spearman(a, b), 3), meanAbsDiff: round(a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / a.length, 1), workbenchSeconds: round(bsecs, 1), iqtreeSeconds: ref.bootstrapRuntimeSeconds, threads: Math.min(boot, 15) };
    }
    results[ds] = {
      taxa: names.length, sites: aln[0].length, model: ref.model,
      nRF: round(nrf(ml.tree, iqTree, names), 3),
      logL: { workbench: round(ml.logL, 2), iqtree: ref.logL, workbenchOnIqtreeTree: round(onIq.logL, 2), iqtreeOnWorkbenchTree: iqOnWorkbench },
      parameters: { workbench: { alpha: ml.alpha && round(ml.alpha, 3), kappa: ml.kappa && round(ml.kappa, 3) }, iqtree: { alpha: ref.alpha, kappa: ref.kappa } },
      modelSelection: { workbench: mf[0].name, iqtree: ref.modelSelectionBIC, ranking: mf.map((x) => x.name) },
      bootstrap, runtimeSeconds: { workbench: round(secs, 1), iqtree: ref.runtimeSeconds },
    };
    void leaves; void logLikelihood;
  }
  writeJson('benchmarks/results/phylogenetics.json', results);
  it('measures', () => { expect(Object.keys(results)).toHaveLength(4); });
  // Thresholds, set from the measured results (RESULTS.md): a regression beyond these fails the bench.
  it('agrees with IQ-TREE within thresholds', () => {
    for (const [ds, r] of Object.entries(results) as [string, any][]) {
      const ref = JSON.parse(readFileSync(`benchmarks/iqtree/ref/${ds}.json`, 'utf8'));
      expect(r.nRF, ds).toBeLessThanOrEqual(0.25); // normalised Robinson–Foulds distance to IQ-TREE's topology
      // Likelihood on IQ-TREE's tree within 2e-4 relative (yeast ~1e-4; the topology gap is measured separately)
      expect(Math.abs(r.logL.workbenchOnIqtreeTree - ref.logL) / Math.abs(ref.logL), ds).toBeLessThanOrEqual(2e-4);
      const norm = (m: string) => m.toUpperCase().replace('+F', '');
      expect(norm(r.modelSelection.workbench), ds).toBe(norm(r.modelSelection.iqtree));
      if (r.bootstrap) expect(r.bootstrap.pearson, ds).toBeGreaterThanOrEqual(0.8);
    }
  });
});
