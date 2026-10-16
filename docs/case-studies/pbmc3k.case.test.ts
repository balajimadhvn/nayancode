// Case study B: 10x PBMC3k (2,700 blood cells, CC BY 4.0) in Single-Cell Studio: QC → clusters → markers →
// marker-panel annotation, compared with the published annotation (Scanpy's processed PBMC3k). Writes results/pbmc3k.json.
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseMtx, runSingleCell, SC_DEFAULTS } from '@/studios/singlecell/kernels';
import { ari, readGz, round, writeJson } from '../../benchmarks/lib/metrics';

const dir = 'benchmarks/.cache/pbmc3k/filtered_gene_bc_matrices/hg19/';
// Published labels → the Workbench marker-panel labels they correspond to.
const MAP: Record<string, string> = { 'CD4 T cells': 'T cells', 'CD8 T cells': 'CD8 T cells', 'NK cells': 'NK cells', 'B cells': 'B cells', 'CD14+ Monocytes': 'CD14+ monocytes', 'FCGR3A+ Monocytes': 'FCGR3A+ monocytes', 'Dendritic cells': 'Dendritic cells', Megakaryocytes: 'Platelets' };

it.skipIf(!existsSync(dir + 'matrix.mtx'))('pbmc3k: clusters, markers and annotation', () => {
  const t0 = performance.now();
  const m = parseMtx(readFileSync(dir + 'matrix.mtx', 'utf8'), readFileSync(dir + 'genes.tsv', 'utf8'), readFileSync(dir + 'barcodes.tsv', 'utf8'));
  const r = runSingleCell(m, { ...SC_DEFAULTS, embedCap: 3000 }, () => {}), secs = (performance.now() - t0) / 1000;
  const published: Record<string, string> = JSON.parse(readGz('benchmarks/scanpy/reference.json.gz')).annotation;
  const label = (c: number) => r.annotation[c].label, cells = r.cells.map((c, i) => ({ c, cl: r.clusters[i] })).filter((x) => published[x.c]);
  const ok = cells.filter((x) => MAP[published[x.c]] === label(x.cl)).length;
  const perType = Object.entries(MAP).map(([pub, wb]) => { const xs = cells.filter((x) => published[x.c] === pub); return { published: pub, workbenchLabel: wb, cells: xs.length, correct: round(xs.filter((x) => label(x.cl) === wb).length / Math.max(1, xs.length), 3) }; });
  const clusters = r.annotation.map((a) => ({ cluster: a.cluster, cells: a.n, label: a.label, topMarkers: r.markers.filter((x) => x.cluster === a.cluster).slice(0, 5).map((x) => x.gene) }));
  const results = {
    data: { cellsIn: r.nCellsIn, cellsKept: r.nCellsKept, genesKept: r.nGenesKept, hvg: r.hvg.length },
    clusters, annotation: { cellsCompared: cells.length, accuracy: round(ok / cells.length, 3), ariClustersVsPublished: round(ari(cells.map((x) => x.cl), cells.map((x) => published[x.c])), 3), perType },
    runtimeSeconds: round(secs, 1),
  };
  writeJson('docs/case-studies/results/pbmc3k.json', results);
  expect(results.annotation.accuracy).toBeGreaterThan(0.5);
});
