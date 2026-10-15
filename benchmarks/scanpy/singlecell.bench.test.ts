// Single-Cell Studio vs Scanpy on 10x PBMC3k (see make-reference.py). Needs `bash benchmarks/fetch.sh` first.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMtx, runSingleCell, SC_DEFAULTS } from '@/studios/singlecell/kernels';
import { ari, nmi, overlap, pearson, readGz, round, writeJson } from '../lib/metrics';

const dir = 'benchmarks/.cache/pbmc3k/filtered_gene_bc_matrices/hg19/';
const have = existsSync(dir + 'matrix.mtx');

if (!have) it.skip('Single-Cell Studio against Scanpy on PBMC3k (run bash benchmarks/fetch.sh first)', () => {});
else describe('Single-Cell Studio against Scanpy on PBMC3k', () => {
  const ref = JSON.parse(readGz('benchmarks/scanpy/reference.json.gz'));
  const features = readFileSync(dir + 'genes.tsv', 'utf8');
  const ids = features.split('\n').filter(Boolean).map((l) => l.split('\t')[0]);
  const m = parseMtx(readFileSync(dir + 'matrix.mtx', 'utf8'), features, readFileSync(dir + 'barcodes.tsv', 'utf8'));
  const t0 = performance.now();
  const r = runSingleCell(m, { ...SC_DEFAULTS, maxPctMito: ref.settings.maxPctMito, embedCap: 200 } /* the embedding is not compared; keep it small */, () => {});
  const ms = performance.now() - t0;

  // Cells, HVGs (compared by Ensembl ID: symbols are not unique in this dataset).
  const symIdx = new Map<string, number[]>(); m.genes.forEach((g, i) => symIdx.set(g, [...(symIdx.get(g) ?? []), i]));
  const hvgIds = new Set(r.hvg.map((g) => ids[symIdx.get(g)![0]]));
  const refCells: string[] = ref.cells, ourRow = new Map(r.cells.map((c, i) => [c, i]));
  const common = refCells.filter((c) => ourRow.has(c));
  const hvg = overlap(hvgIds, new Set<string>(ref.hvg));
  // PCs: sign is arbitrary, so compare |r| of scores PC-by-PC over common cells.
  const pcR = (a: number, b: number) => Math.abs(pearson(common.map((c) => r.pcs[ourRow.get(c)!][a]), common.map((c) => ref.pcs[refCells.indexOf(c)][b])));
  const pcCorr = Array.from({ length: 10 }, (_, k) => round(pcR(k, k), 3));
  // Components with near-equal variance can swap order between solvers; also report each PC's best match among Scanpy's 10.
  const pcBest = Array.from({ length: 10 }, (_, k) => round(Math.max(...Array.from({ length: 10 }, (_, j) => pcR(k, j))), 3));
  // Clusters vs Scanpy Leiden and vs the published annotation.
  const ours = common.map((c) => r.clusters[ourRow.get(c)!]), theirs = common.map((c) => ref.leiden[refCells.indexOf(c)]);
  const annCells = common.filter((c) => ref.annotation[c]);
  const ann = annCells.map((c) => ref.annotation[c]);
  const oursA = annCells.map((c) => r.clusters[ourRow.get(c)!]), theirsA = annCells.map((c) => ref.leiden[refCells.indexOf(c)]);
  // Markers: match each Scanpy cluster to the Workbench cluster sharing most cells; compare top-10 marker genes.
  const markerOverlap = Object.entries(ref.markers as Record<string, string[]>).map(([lc, genes]) => {
    const counts = new Map<number, number>(); theirs.forEach((t, i) => { if (t === lc) counts.set(ours[i], (counts.get(ours[i]) ?? 0) + 1); });
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const mine = new Set(r.markers.filter((x) => x.cluster === best).map((x) => x.gene));
    return { scanpyCluster: lc, workbenchCluster: best, shared: genes.filter((g) => mine.has(g)).length };
  });
  const results = {
    versions: ref.versions, settings: ref.settings, runtimeMs: Math.round(ms),
    cells: { workbench: r.nCellsKept, scanpy: refCells.length, common: common.length },
    hvg: { workbench: hvg.a, scanpy: hvg.b, shared: hvg.both, jaccard: round(hvg.jaccard) },
    pcAbsCorrelation: pcCorr, pcBestMatchAbsCorrelation: pcBest,
    clusters: {
      workbench: r.nClusters, scanpy: new Set(theirs).size,
      ariWorkbenchVsScanpy: round(ari(ours, theirs)), nmiWorkbenchVsScanpy: round(nmi(ours, theirs)),
      annotatedCells: annCells.length, cellTypes: new Set(ann).size,
      ariVsAnnotation: { workbench: round(ari(oursA, ann)), scanpy: round(ari(theirsA, ann)) },
      nmiVsAnnotation: { workbench: round(nmi(oursA, ann)), scanpy: round(nmi(theirsA, ann)) },
    },
    markers: { meanSharedTop10: round(markerOverlap.reduce((s, x) => s + x.shared, 0) / markerOverlap.length, 2), perCluster: markerOverlap },
  };
  writeJson('benchmarks/results/singlecell.json', results);

  // Thresholds sit just below the measured values (benchmarks/RESULTS.md) so that a regression fails.
  it('keeps the same cells', () => { expect(results.cells.common).toBe(results.cells.scanpy); expect(results.cells.workbench).toBe(results.cells.scanpy); });
  it('selects the same highly variable genes (Seurat flavour)', () => { expect(results.hvg.jaccard).toBeGreaterThan(0.99); });
  it('reproduces the principal components', () => { pcCorr.slice(0, 7).forEach((x) => expect(x).toBeGreaterThan(0.99)); pcBest.forEach((x) => expect(x).toBeGreaterThan(0.85)); });
  it('finds similar clusters and markers', () => {
    expect(results.clusters.ariWorkbenchVsScanpy).toBeGreaterThan(0.7);
    expect(results.clusters.ariVsAnnotation.workbench).toBeGreaterThan(0.55);
    expect(results.markers.meanSharedTop10).toBeGreaterThan(8);
  });
});
