import { useMemo, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { Scatter, cssVar, type Pt } from '@/viz/charts';
import { BoxByGroup, MultiLine, StackedBars, catColors } from '@/viz/more';
import { RANKS, parseFeatureTable, parseMetadata, syntheticMicrobiome } from './kernels';
import { treeFromTaxonomy } from './unifrac';
import type { Metric } from './microbiome.worker';
import type { MbKernels } from './microbiome.worker';

const remote = createRemote<MbKernels>(() => new Worker(new URL('./microbiome.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = { id: 'microbiome.analysis', name: 'Microbiome community analysis', version: '0.1.0', engine: 'TypeScript worker kernels', citations: ['anderson2001', 'lozupone2005', 'aitchison1982', 'gloor2017', 'hurlbert1971', 'benjamini1995', 'mann1947'], describe: (p) => `Community analysis of a feature table: alpha diversity (observed features, Shannon, Simpson, Chao1, Pielou) compared between groups by Mann–Whitney/Kruskal–Wallis tests; beta diversity by ${p.metric} dissimilarity with PCoA and PERMANOVA (${p.perms} permutations); differential abundance by CLR transformation (pseudocount 0.5) and Welch t-tests with Benjamini–Hochberg correction; rarefaction by analytic expected richness` };
type Tab = 'comp' | 'alpha' | 'beta' | 'da' | 'rare';
const ALPHAS = [['shannon', 'Shannon'], ['observed', 'Observed features'], ['simpson', 'Simpson (1−D)'], ['chao1', 'Chao1'], ['pielou', "Pielou's evenness"]] as const;

export default function MicrobiomeStudio() {
  const [table, setTable] = useState(''), [meta, setMeta] = useState(''), [truth, setTruth] = useState<Set<string> | null>(null);
  const [tree, setTree] = useState(''), [groupCol, setGroupCol] = useState(''), [metric, setMetric] = useState<Metric>('bray'), [rank, setRank] = useState(5), [perms, setPerms] = useState(999), [minPrev, setMinPrev] = useState(0.2), [a, setA] = useState(''), [b, setB] = useState('');
  const [res, setRes] = useState<Awaited<ReturnType<MbKernels['analyse']>> | null>(null), [tab, setTab] = useState<Tab>('comp');
  const { run, busy, progress, note, error } = useRunner();
  const parsed = useMemo(() => { try { if (!table || !meta) return null; const t = parseFeatureTable(table); const m = parseMetadata(meta, t.samples); return { t, m }; } catch (e) { return { err: (e as Error).message } as { err: string }; } }, [table, meta]);
  const ok = parsed && !('err' in parsed) ? parsed : null;
  const col = groupCol && ok?.m.columns.includes(groupCol) ? groupCol : ok?.m.columns[0] ?? '';
  const levels = useMemo(() => (ok && col ? [...new Set(ok.m.values[col])] : []), [ok, col]);
  const ga = a && levels.includes(a) ? a : levels[0] ?? '', gb = b && levels.includes(b) ? b : levels[1] ?? '';
  const go = () => void run({ label: `Microbiome · ${ok?.t.samples.length} samples`, tool: TOOL, params: { metric, perms, rank, group: col }, inputs: [{ name: 'table', data: table }, { name: 'metadata', data: meta }], run: (h) => remote.analyse({ table, meta, groupCol: col, tree, metric, rank, perms, groupA: ga, groupB: gb, minPrev }, h) }).then((r) => r && setRes(r));
  const demo = () => { const d = syntheticMicrobiome(6, 12); setTable(d.table); setMeta(d.meta); setTruth(d.truth); setRes(null); setGroupCol('group'); setTree(treeFromTaxonomy(d.taxonomy.ids, d.taxonomy.lineages)); };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Microbiome Studio</h1><p>Diversity, ordination, PERMANOVA and differential abundance for amplicon feature tables. Bring a table from QIIME 2, nf-core/ampliseq or DADA2; read-level classification stays on a server.</p></div></div>
      <div className="split"><div className="stack">
        <Card title="1 · Data"><div className="stack" style={{ gap: 10 }}>
          <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setTable(t); setTruth(null); setRes(null); }} label={table ? 'Feature table loaded' : 'Feature table (features × samples, optional taxonomy column)'} />
          <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setMeta(t); setRes(null); }} label={meta ? 'Metadata loaded' : 'Sample metadata (sample, group, …)'} />
          <button className="btn" onClick={demo}>Load synthetic demo (24 samples, 112 ASVs + tree)</button>
          <FileDrop accept=".nwk,.tre,.tree,.txt" onText={(t) => setTree(t.trim())} label={tree ? `Phylogenetic tree loaded (${tree.length.toLocaleString()} chars)` : 'Optional: phylogenetic tree (Newick) for UniFrac'} />
          {parsed && 'err' in parsed && <Callout kind="err">{parsed.err}</Callout>}
          {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.t.features.length} features × {ok.t.samples.length} samples</div>}
          <div className="faint" style={{ fontSize: 11.5 }}>Export from QIIME 2: <code>qiime tools export</code> then <code>biom convert --to-tsv</code>. Taxonomy column header: <code>taxonomy</code>, ranks separated by <code>;</code>.</div>
        </div></Card>
        {ok && <Card title="2 · Design"><div className="stack" style={{ gap: 10 }}>
          <Field label="Group variable"><select className="select" value={col} onChange={(e) => setGroupCol(e.target.value)}>{ok.m.columns.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <div className="cols-2" style={{ gap: 8 }}><Field label="Compare A"><select className="select" value={ga} onChange={(e) => setA(e.target.value)}>{levels.map((l) => <option key={l}>{l}</option>)}</select></Field><Field label="vs B"><select className="select" value={gb} onChange={(e) => setB(e.target.value)}>{levels.map((l) => <option key={l}>{l}</option>)}</select></Field></div>
          <div className="cols-2" style={{ gap: 8 }}><Field label="Beta metric"><select className="select" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}><option value="bray">Bray–Curtis</option><option value="jaccard">Jaccard</option><option value="aitchison">Aitchison (CLR)</option><option value="unifrac-weighted">Weighted UniFrac (needs tree)</option><option value="unifrac-unweighted">Unweighted UniFrac (needs tree)</option></select></Field><Field label="Taxa rank"><select className="select" value={rank} onChange={(e) => setRank(+e.target.value)}>{RANKS.map((r, i) => <option key={r} value={i}>{r}</option>)}</select></Field>
            <Field label="Permutations"><select className="select" value={perms} onChange={(e) => setPerms(+e.target.value)}>{[199, 499, 999, 4999].map((v) => <option key={v}>{v}</option>)}</select></Field><Field label="DA min prevalence"><input className="input" type="number" step={0.05} min={0} max={1} value={minPrev} onChange={(e) => setMinPrev(+e.target.value)} /></Field></div>
          <button className="btn primary" disabled={busy} onClick={go}>Run analysis</button>{busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
        </div></Card>}
        <Callout>UniFrac needs a tree whose tip names equal your feature IDs (build one in the Phylogenetics Studio, or export from QIIME 2 / ampliseq). Shotgun read classification needs multi-GB databases and belongs on a server.</Callout>
      </div>
      <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load a feature table and metadata (or the demo), then run.</div></Card> : <Results res={res} tab={tab} setTab={setTab} rank={rank} truth={truth} ga={ga} gb={gb} />}</div></div>
    </div>
  );
}

function Results({ res, tab, setTab, rank, truth, ga, gb }: { res: Awaited<ReturnType<MbKernels['analyse']>>; tab: Tab; setTab(t: Tab): void; rank: number; truth: Set<string> | null; ga: string; gb: string }) {
  const lv = [...new Set(res.groups)], gc = [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d')], gcol = (g: string) => gc[lv.indexOf(g) % 4];
  const [alphaKey, setAlphaKey] = useState<(typeof ALPHAS)[number][0]>('shannon');
  const taxaCols = catColors(res.taxa.taxa.length - 1).concat(['#6b7280']);
  const da = res.da, called = da?.filter((r) => r.fdr < 0.05) ?? [];
  const tp = truth ? called.filter((r) => truth.has(r.feature)).length : 0;
  const pcoaPts: Pt[] = res.pcoa.coords.map((c, i) => ({ x: c[0], y: c[1] ?? 0, cat: lv.indexOf(res.groups[i]), label: `${res.samples[i]} (${res.groups[i]})` }));
  const daPts: Pt[] = da ? da.map((r) => ({ x: r.log2fc, y: -Math.log10(Math.max(r.p, 1e-300)), cat: r.fdr < 0.05 ? (r.log2fc > 0 ? 1 : 2) : 0, label: `${r.feature} ${r.taxon.split(';').pop() ?? ''}` })) : [];
  return (
    <>
      <div className="cols-4"><Stat label="Samples" value={res.samples.length} /><Stat label="Features" value={res.nFeatures} /><Stat label="Median depth" value={Math.round([...res.alpha.map((x) => x.depth)].sort((x, y) => x - y)[res.alpha.length >> 1]).toLocaleString()} /><Stat label="PERMANOVA" value={res.permanova ? `p = ${res.permanova.p.toFixed(3)}` : '–'} hint={res.permanova ? `pseudo-F ${res.permanova.F.toFixed(2)}, R² ${res.permanova.R2.toFixed(2)}` : undefined} /></div>
      <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'comp', label: 'Composition' }, { id: 'alpha', label: 'Alpha diversity' }, { id: 'beta', label: 'Beta diversity' }, { id: 'da', label: 'Differential abundance' }, { id: 'rare', label: 'Rarefaction' }]} />
      {tab === 'comp' && <Card title={`Taxonomic composition`} sub={`${RANKS[rank]} level, top 10 + Other`}><StackedBars labels={res.samples} series={res.taxa.rel} names={res.taxa.taxa} colors={taxaCols} height={340} /></Card>}
      {tab === 'alpha' && <><Card title="Alpha diversity" sub={res.alphaP[alphaKey] !== undefined ? `${lv.length === 2 ? 'Mann–Whitney' : 'Kruskal–Wallis'} p = ${sci(res.alphaP[alphaKey])}` : ''} actions={<select className="select" style={{ width: 170 }} value={alphaKey} onChange={(e) => setAlphaKey(e.target.value as typeof alphaKey)}>{ALPHAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}><BoxByGroup groups={lv} values={lv.map((g) => res.alpha.filter((_, i) => res.groups[i] === g).map((x) => x[alphaKey]))} yLabel={ALPHAS.find((x) => x[0] === alphaKey)![1]} colors={lv.map(gcol)} /></Card>
        <Card title="Per-sample table" pad={false} actions={<button className="btn sm" onClick={() => downloadText('alpha_diversity.csv', toCsv(res.alpha.map((a, i) => ({ sample: res.samples[i], group: res.groups[i], ...a }))), 'text/csv')}>CSV</button>}><DataTable rows={res.alpha.map((a, i) => ({ ...a, sample: res.samples[i], group: res.groups[i] }))} rowKey={(r) => r.sample} cols={[{ key: 'sample', label: 'Sample', sort: (r) => r.sample }, { key: 'group', label: 'Group', sort: (r) => r.group }, { key: 'depth', label: 'Reads', num: true, sort: (r) => r.depth, render: (r) => r.depth.toLocaleString() }, { key: 'observed', label: 'Observed', num: true, sort: (r) => r.observed }, { key: 'shannon', label: 'Shannon', num: true, sort: (r) => r.shannon, render: (r) => fmt(r.shannon, 2) }, { key: 'simpson', label: 'Simpson', num: true, render: (r) => fmt(r.simpson, 3) }, { key: 'chao1', label: 'Chao1', num: true, render: (r) => fmt(r.chao1, 1) }]} /></Card></>}
      {tab === 'beta' && <Card title="Principal coordinates (PCoA)" sub={res.permanova ? `PERMANOVA pseudo-F = ${res.permanova.F.toFixed(2)}, R² = ${res.permanova.R2.toFixed(2)}, p = ${res.permanova.p.toFixed(3)}` : undefined}><Scatter points={pcoaPts} colors={gc} names={lv} xLabel={`PCo1 (${fmt(res.pcoa.varExplained[0] * 100, 1)}%)`} yLabel={`PCo2 (${fmt((res.pcoa.varExplained[1] ?? 0) * 100, 1)}%)`} radius={7} height={400} /></Card>}
      {tab === 'da' && (res.daError ? <Callout kind="err">{res.daError}</Callout> : da && <>
        {truth && <Callout><b style={{ color: 'var(--text)' }}>Validation against planted truth:</b>&nbsp;{tp}/{truth.size} planted taxa recovered, empirical FDR {fmt(called.length ? ((called.length - tp) / called.length) * 100 : 0, 1)}% (nominal 5%).</Callout>}
        <Card title="Differential abundance" sub={`${gb} vs ${ga} · CLR + Welch t · BH FDR`}><Scatter points={daPts} colors={[cssVar('--chart-mute'), cssVar('--chart-b'), cssVar('--chart-a')]} names={['n.s.', `higher in ${gb}`, `higher in ${ga}`]} xLabel="log2 fold change (relative abundance)" yLabel="-log10 p" height={340} /></Card>
        <Card title="Features" pad={false} actions={<button className="btn sm" onClick={() => downloadText('differential_abundance.csv', toCsv(da), 'text/csv')}>CSV</button>}><DataTable rows={da} rowKey={(r) => r.feature} cols={[{ key: 'feature', label: 'Feature', sort: (r) => r.feature }, { key: 'taxon', label: 'Taxon', render: (r) => <span className="dim">{r.taxon.split(';').slice(-2).join(' › ').replace(/[a-z]__/g, '')}</span> }, { key: 'log2fc', label: 'log2FC', num: true, sort: (r) => r.log2fc, render: (r) => fmt(r.log2fc, 2) }, { key: 'prev', label: 'Prevalence', num: true, render: (r) => `${fmt(r.prevalence * 100, 0)}%` }, { key: 'p', label: 'p', num: true, sort: (r) => r.p, render: (r) => sci(r.p) }, { key: 'fdr', label: 'FDR', num: true, sort: (r) => r.fdr, render: (r) => sci(r.fdr) }]} /></Card></>)}
      {tab === 'rare' && <Card title="Rarefaction" sub="expected richness at each depth (analytic, Hurlbert 1971); curves that plateau mean sufficient sequencing"><MultiLine xs={res.rare[0].pts.map((_, i) => i + 1)} series={res.rare.map((r, i) => ({ name: r.sample, ys: r.pts.map((p) => p.richness), color: gcol(res.groups[i]) })).filter((_, i) => i < 40)} xLabel="Depth step (fraction of each sample's reads)" yLabel="Expected features" height={300} /><div className="legend" style={{ marginTop: 6 }}>{lv.map((g) => <span key={g}><i style={{ background: gcol(g) }} />{g}</span>)}</div></Card>}
    </>
  );
}
