import { useEffect, useMemo, useState } from 'react';
import { clearHandoffSoon, useHandoff } from '@/core/handoff';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { Histogram, Scatter, type Pt } from '@/viz/charts';
import { catColors } from '@/viz/more';
import { SC_DEFAULTS, syntheticPbmcLike, type ScParams, type ScResult } from './kernels';
import type { ScKernels } from './singlecell.worker';

const remote = createRemote<ScKernels>(() => new Worker(new URL('./singlecell.worker.ts', import.meta.url), { type: 'module' }));
const ENGINE = 'TypeScript worker kernels (randomized PCA, SNN-Louvain, exact t-SNE)';
const TOOLS = {
  run: { id: 'singlecell.pipeline', name: 'Single-cell RNA-seq pipeline', version: '0.1.0', engine: ENGINE, citations: ['butler2015', 'blondel2008', 'vandermaaten2008', 'mcinnes2018', 'halko2011'], describe: (p) => `Cells were filtered (≥${p.minGenes} genes, ≤${p.maxPctMito}% mitochondrial counts), counts were log-normalised to 10,000 per cell, ${p.nHvg} highly variable genes were selected (Seurat-style binned dispersion) and scaled, PCA used a randomized SVD (${p.nPcs} components), a shared-nearest-neighbour graph (k = ${p.k}) was clustered with the Louvain algorithm (resolution ${p.resolution}), and cells were embedded by ${p.embedMethod === 'tsne' ? 't-SNE (perplexity 30)' : `UMAP (${p.k} neighbours, min_dist 0.1)`}; markers were ranked by Welch t-test (BH-adjusted)` } as ToolInfo,
  spatial: { id: 'singlecell.spatial', name: 'Spatial autocorrelation (Moran I)', version: '0.1.0', engine: ENGINE, citations: ['moran1950'], describe: () => "Spatially variable genes were ranked by Moran's I on a 6-nearest-neighbour spatial graph, with permutation p-values (199 permutations) for the top genes" } as ToolInfo,
};
type Tab = 'qc' | 'embed' | 'clusters' | 'spatial';
const RAMP = ['#3a4256', '#2a4c8f', '#2f6fb0', '#2aa198', '#7fbf4f', '#e5d44a', '#f29a3a', '#e5484d'];

export default function SingleCellStudio() {
  const [src, setSrc] = useState<{ dense?: string; mtx?: string; features?: string; barcodes?: string; label: string } | null>(null);
  const [coordsText, setCoordsText] = useState('');
  const [p, setP] = useState<ScParams>(SC_DEFAULTS); const [res, setRes] = useState<ScResult | null>(null); const [tab, setTab] = useState<Tab>('embed');
  const [truth, setTruth] = useState<string[] | null>(null);
  const { run, busy, progress, note, error, cancel } = useRunner();
  const hand = useHandoff((s) => s.sc);
  useEffect(() => { if (hand) { setSrc({ mtx: hand.mtx, features: hand.features, barcodes: hand.barcodes, label: hand.label }); setTruth(null); setRes(null); clearHandoffSoon('sc'); } }, [hand]);
  const go = (s = src) => s && void run({ label: `scRNA-seq · ${s.label}`, tool: TOOLS.run, params: { ...p }, inputs: [{ name: s.label, data: (s.dense ?? s.mtx ?? '').slice(0, 2_000_000) }], run: (h) => remote.run({ dense: s.dense, mtx: s.mtx, features: s.features, barcodes: s.barcodes, params: p }, h) }).then((r) => { if (r) { setRes(r); setTab('embed'); } });
  const demo = () => { const d = syntheticPbmcLike(12, 900, 1500); const s = { dense: d.counts, label: 'synthetic_pbmc_like', features: undefined, barcodes: undefined, mtx: undefined }; setSrc(s); setCoordsText(d.coords); setTruth(d.truth); const pp = { ...p, minGenes: 50, nHvg: 500 }; setP(pp); void run({ label: 'scRNA-seq · synthetic demo', tool: TOOLS.run, params: { ...pp }, inputs: [{ name: 'demo', data: d.counts.slice(0, 200000) }], run: (h) => remote.run({ dense: d.counts, params: pp }, h) }).then((r) => { if (r) { setRes(r); setTab('embed'); } }); };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return; const arr = [...files]; const byName = (re: RegExp) => arr.find((f) => re.test(f.name.toLowerCase()));
    const mtx = byName(/matrix\.mtx/), feat = byName(/(features|genes)\.tsv/), bc = byName(/barcodes\.tsv/);
    if (mtx || feat || bc) { if (!(mtx && feat && bc)) { alert('For 10x output select all three files together: matrix.mtx(.gz not supported), features.tsv (or genes.tsv) and barcodes.tsv.'); return; } setSrc({ mtx: await mtx.text(), features: await feat.text(), barcodes: await bc.text(), label: mtx.name }); setTruth(null); }
    else { const f = arr[0]; setSrc({ dense: await f.text(), label: f.name }); setTruth(null); }
  };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Single-Cell & Spatial</h1><p>scRNA-seq from a count matrix to annotated clusters, markers and spatial statistics. QC → HVG → PCA → SNN graph → Louvain → UMAP / t-SNE, all in a worker.</p></div></div>
      <div className="split"><div className="stack">
        <Card title="1 · Data">
          <div className="stack" style={{ gap: 10 }}>
            <label className="dropzone"><input type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} />{src ? `Loaded: ${src.label}` : 'Choose a genes × cells CSV/TSV, or the three 10x files'}<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>10x: select matrix.mtx + features.tsv + barcodes.tsv together (uncompressed). Never uploaded.</div></label>
            <FileDrop accept=".csv,.tsv,.txt" onText={(t) => setCoordsText(t)} label={coordsText ? 'Spatial coordinates loaded' : 'Optional: spatial coordinates (barcode,x,y)'} />
            <button className="btn" disabled={busy} onClick={demo}>Run synthetic PBMC-like demo (900 cells)</button>
          </div>
        </Card>
        <Card title="2 · Parameters">
          <div className="cols-2" style={{ gap: 8 }}>
            {([['minGenes', 'Min genes / cell'], ['maxPctMito', 'Max % mito'], ['nHvg', 'HVGs'], ['nPcs', 'PCs'], ['k', 'Neighbours k'], ['resolution', 'Louvain resolution']] as const).map(([key, label]) => <Field key={key} label={label}><input className="input" type="number" step={key === 'resolution' ? 0.1 : 1} value={p[key]} onChange={(e) => setP({ ...p, [key]: +e.target.value })} /></Field>)}
          <Field label="Embedding"><select className="select" value={p.embedMethod} onChange={(e) => setP({ ...p, embedMethod: e.target.value as ScParams['embedMethod'] })}><option value="umap">UMAP</option><option value="tsne">t-SNE</option></select></Field>
          </div>
          <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={!src || busy} onClick={() => go()}>Run pipeline</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
          {busy && <div style={{ marginTop: 10 }}><Busy progress={progress} note={note} /></div>}{error && <div style={{ marginTop: 10 }}><Callout kind="err">{error}</Callout></div>}
        </Card>
        <Callout>Browser budget: ~20k cells comfortably (memory-bound, sparse storage). The embedding covers up to {p.embedCap.toLocaleString()} cells (random subset above that; clustering uses all). Atlas-scale data belongs on a GPU backend.</Callout>
      </div>
      <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load a matrix or run the demo.</div></Card> : <>
        <div className="cols-4"><Stat label="Cells kept" value={`${res.nCellsKept.toLocaleString()} / ${res.nCellsIn.toLocaleString()}`} /><Stat label="Genes used" value={res.nGenesKept.toLocaleString()} /><Stat label="Clusters" value={res.nClusters} /><Stat label="PC1–PC2 var." value={`${fmt((res.varExplained[0] + (res.varExplained[1] ?? 0)) * 100, 1)}%`} /></div>
        <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'embed', label: 'Embedding' }, { id: 'clusters', label: 'Clusters & markers' }, { id: 'qc', label: 'QC' }, { id: 'spatial', label: 'Spatial' }]} />
        {tab === 'qc' && <div className="cols-3"><Card title="Counts per cell"><Histogram values={res.qc.nCounts.map((v) => Math.log10(v + 1))} label="log10 total counts" /></Card><Card title="Genes per cell"><Histogram values={res.qc.nGenes} label="genes detected" color="--chart-c" /></Card><Card title="% mitochondrial">{res.hasMito ? <Histogram values={res.qc.pctMito} label="% mito counts" color="--chart-b" /> : <div className="faint">No genes named MT-*. Mito filtering skipped.</div>}</Card></div>}
        {tab === 'embed' && <Embed res={res} truth={truth} />}
        {tab === 'clusters' && <Clusters res={res} />}
        {tab === 'spatial' && <Spatial res={res} coordsText={coordsText} />}
      </>}</div></div>
    </div>
  );
}

function Embed({ res, truth }: { res: ScResult; truth: string[] | null }) {
  const [by, setBy] = useState<'cluster' | 'annotation' | 'gene'>('cluster'), genes = [...res.expr.keys()].sort(), [gene, setGene] = useState(genes.find((g) => ['CD3D', 'MS4A1', 'NKG7', 'LYZ'].includes(g)) ?? genes[0] ?? '');
  const labels = res.annotation.map((a) => `${a.cluster} · ${a.label}`), colors = catColors(res.nClusters);
  const { pts, cols, names } = useMemo(() => {
    const idx = res.embedIdx;
    if (by === 'gene') { const e = res.expr.get(gene); const mx = e ? Math.max(...e) || 1 : 1; return { pts: idx.map((i, k): Pt => ({ x: res.embed[k][0], y: res.embed[k][1], cat: e && e[i] > 0 ? 1 + Math.min(6, Math.floor((e[i] / mx) * 6.999)) : 0, label: `${res.cells[i]} · ${gene} ${e ? e[i].toFixed(2) : 0}` })), cols: RAMP, names: undefined as string[] | undefined }; }
    return { pts: idx.map((i, k): Pt => ({ x: res.embed[k][0], y: res.embed[k][1], cat: res.clusters[i], label: `${res.cells[i]} · cluster ${res.clusters[i]}${by === 'annotation' ? ` (${res.annotation[res.clusters[i]].label})` : ''}` })), cols: colors, names: by === 'annotation' ? labels : Array.from({ length: res.nClusters }, (_, c) => `cluster ${c}`) };
  }, [res, by, gene, colors, labels]);
  const purity = truth ? (() => { const lab = new Map(res.annotation.map((a) => [a.cluster, a.label])); const ok = res.kept.filter((c, i) => lab.get(res.clusters[i]) === truth[c]).length; return ok / res.kept.length; })() : null;
  return (
    <Card title={`${res.embedMethod === 'tsne' ? 't-SNE' : 'UMAP'} embedding`} sub={res.embedIdx.length < res.nCellsKept ? `${res.embedIdx.length.toLocaleString()} of ${res.nCellsKept.toLocaleString()} cells shown` : `${res.nCellsKept.toLocaleString()} cells`} actions={<><select className="select" style={{ width: 130 }} value={by} onChange={(e) => setBy(e.target.value as typeof by)}><option value="cluster">colour: cluster</option><option value="annotation">colour: annotation</option><option value="gene">colour: gene</option></select>{by === 'gene' && <select className="select" style={{ width: 130 }} value={gene} onChange={(e) => setGene(e.target.value)}>{genes.map((g) => <option key={g}>{g}</option>)}</select>}</>}>
      <Scatter points={pts} colors={cols} names={names} xLabel={`${res.embedMethod === 'tsne' ? 't-SNE' : 'UMAP'} 1`} yLabel={`${res.embedMethod === 'tsne' ? 't-SNE' : 'UMAP'} 2`} height={470} radius={2.8} />
      {purity !== null && <Callout>Synthetic data: marker-panel annotation matches the planted cell type for <b style={{ color: 'var(--text)' }}>{fmt(purity * 100, 1)}%</b> of cells.</Callout>}
    </Card>
  );
}

function Clusters({ res }: { res: ScResult }) {
  const [c, setC] = useState(0), rows = res.markers.filter((m) => m.cluster === c);
  return (
    <>
      <Card title="Cluster annotation" sub="heuristic: built-in marker panel (HGNC symbols). Verify before use." pad={false}>
        <DataTable rows={res.annotation} rowKey={(r) => String(r.cluster)} onRow={(r) => setC(r.cluster)} cols={[{ key: 'cluster', label: 'Cluster', sort: (r) => r.cluster }, { key: 'n', label: 'Cells', num: true, sort: (r) => r.n }, { key: 'label', label: 'Proposed identity', sort: (r) => r.label, render: (r) => <b>{r.label}</b> }, { key: 'score', label: 'Panel score', num: true, render: (r) => fmt(r.score, 2) }, { key: 'margin', label: 'Margin', num: true, render: (r) => <span style={{ color: r.margin < 0.15 ? 'var(--warn)' : undefined }}>{fmt(r.margin, 2)}</span> }]} />
      </Card>
      <Card title={`Markers for cluster ${c}`} sub="Welch t vs all other cells, BH FDR" actions={<><select className="select" style={{ width: 110 }} value={c} onChange={(e) => setC(+e.target.value)}>{Array.from({ length: res.nClusters }, (_, i) => <option key={i} value={i}>cluster {i}</option>)}</select><button className="btn sm" onClick={() => downloadText('markers.csv', toCsv(res.markers), 'text/csv')}>All markers CSV</button></>} pad={false}>
        <DataTable rows={rows} rowKey={(r) => r.gene} cols={[{ key: 'gene', label: 'Gene' }, { key: 'log2fc', label: 'log2FC', num: true, render: (r) => fmt(r.log2fc, 2), sort: (r) => r.log2fc }, { key: 'in', label: '% in', num: true, render: (r) => fmt(r.pctIn * 100, 0) }, { key: 'out', label: '% out', num: true, render: (r) => fmt(r.pctOut * 100, 0) }, { key: 't', label: 't', num: true, render: (r) => fmt(r.t, 1) }, { key: 'fdr', label: 'FDR', num: true, render: (r) => sci(r.fdr) }]} />
      </Card>
    </>
  );
}

function Spatial({ res, coordsText }: { res: ScResult; coordsText: string }) {
  const { run, busy, error } = useRunner(); const [rows, setRows] = useState<{ gene: string; I: number; p: number }[]>([]); const [gene, setGene] = useState('');
  const coords = useMemo(() => { if (!coordsText) return null; const m = new Map(coordsText.split(/\r?\n/).slice(1).filter(Boolean).map((l) => { const f = l.split(/[,\t]/); return [f[0].trim(), [+f[1], +f[2]] as [number, number]]; })); const out = res.cells.map((c) => m.get(c)); return out.every(Boolean) ? (out as [number, number][]) : out.some(Boolean) ? 'partial' : 'none'; }, [coordsText, res]);
  if (!coordsText) return <Callout>Load a coordinates file (barcode,x,y) in the left panel, or run the demo, to enable spatial analysis.</Callout>;
  if (coords === 'none' || coords === 'partial' || !coords) return <Callout kind="err">{coords === 'partial' ? 'Some cell barcodes have no coordinates.' : 'No barcodes in the coordinates file match the cells in the matrix.'}</Callout>;
  const genes = [...res.expr.keys()].sort(), g = gene || rows[0]?.gene || '';
  const go = () => void run({ label: "Moran's I", tool: TOOLS.spatial, params: {}, inputs: [{ name: 'coords', data: coordsText.slice(0, 200000) }], run: () => remote.spatial({ coords, genes: [...res.expr.entries()].map(([name, v]) => ({ name, v })) }) }).then((r) => { if (r) { setRows(r); setGene(r[0]?.gene ?? ''); } });
  const e = g ? res.expr.get(g) : null, mx = e ? Math.max(...e) || 1 : 1;
  const byCluster: Pt[] = coords.map((c, i) => ({ x: c[0], y: -c[1], cat: res.clusters[i], label: `${res.cells[i]} · cluster ${res.clusters[i]}` }));
  const byGene: Pt[] = coords.map((c, i) => ({ x: c[0], y: -c[1], cat: e && e[i] > 0 ? 1 + Math.min(6, Math.floor((e[i] / mx) * 6.999)) : 0, label: `${res.cells[i]} · ${g} ${e ? e[i].toFixed(2) : 0}` }));
  return (
    <>
      <div className="cols-2">
        <Card title="Spatial map: clusters"><Scatter points={byCluster} colors={catColors(res.nClusters)} xLabel="x" yLabel="y" height={360} radius={3.2} equalAspect /></Card>
        <Card title={`Spatial map: ${g || 'select gene'}`} actions={<select className="select" style={{ width: 130 }} value={g} onChange={(e2) => setGene(e2.target.value)}>{genes.map((x) => <option key={x}>{x}</option>)}</select>}><Scatter points={byGene} colors={RAMP} xLabel="x" yLabel="y" height={360} radius={3.2} equalAspect /></Card>
      </div>
      <Card title="Spatially variable genes" sub="Moran's I on a 6-NN graph; permutation p for the top 15" actions={<button className="btn primary sm" disabled={busy} onClick={go}>Compute</button>} pad={false}>
        {error && <Callout kind="err">{error}</Callout>}
        {rows.length > 0 ? <DataTable rows={rows} rowKey={(r) => r.gene} onRow={(r) => setGene(r.gene)} cols={[{ key: 'gene', label: 'Gene' }, { key: 'I', label: "Moran's I", num: true, render: (r) => fmt(r.I, 3), sort: (r) => r.I }, { key: 'p', label: 'perm. p', num: true, render: (r) => (Number.isFinite(r.p) ? r.p.toFixed(3) : '–'), sort: (r) => (Number.isFinite(r.p) ? r.p : 2) }]} /> : <div className="faint" style={{ padding: 16 }}>Press Compute. Candidate genes are the markers, panel genes and top HVGs.</div>}
      </Card>
    </>
  );
}
