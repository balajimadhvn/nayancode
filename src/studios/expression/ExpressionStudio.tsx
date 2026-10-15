import { assetUrl } from '@/core/asset';
import { useEffect, useMemo, useState } from 'react';
import { clearHandoffSoon, useHandoff } from '@/core/handoff';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { BarChart, Heatmap, Scatter, cssVar, type Pt } from '@/viz/charts';
import type { Analysed, ExpressionKernels } from './expression.worker';
import { syntheticBatchExperiment, syntheticExperiment, type DeRow } from './kernels';
import type { GeneSetPack, GseaRow, OraRow } from './enrichment';

const remote = createRemote<ExpressionKernels>(() => new Worker(new URL('./expression.worker.ts', import.meta.url), { type: 'module' }));

const TOOL: ToolInfo = {
  id: 'expression.de', name: 'Bulk RNA-seq differential expression', version: '0.1.0', engine: 'TypeScript worker kernel (limma-style moderated t on log2-CPM)',
  citations: ['anders2010', 'robinson2010', 'smyth2004', 'benjamini1995', 'johnson2007'],
  describe: (p) => `Counts were normalised with the median-of-ratios method, genes were filtered at ≥${p.minCpm} CPM in ≥${p.minSamples} samples, and differential expression between ${p.groupB} and ${p.groupA} was tested on log2-CPM values with empirical-Bayes moderated t-statistics; p-values were adjusted by Benjamini–Hochberg${p.batchCorrect ? '; batch effects were removed for PCA and heatmaps with parametric empirical-Bayes ComBat (group retained as a covariate), while the differential-expression test used the uncorrected counts' : ''}`,
};

const ENRICH_TOOL: ToolInfo = {
  id: 'expression.enrichment', name: 'Gene-set enrichment', version: '0.1.0', engine: 'TypeScript worker kernel; Reactome / WikiPathways / GO bundled offline',
  citations: ['fisher1922', 'subramanian2005', 'benjamini1995', 'reactome2024', 'wikipathways2024', 'go2023'],
  describe: (p) => `${p.method === 'gsea' ? 'Preranked gene-set enrichment analysis (weighted Kolmogorov–Smirnov statistic, t-statistic ranking, size-matched random-set null with ' + p.perms + ' permutations)' : 'Over-representation analysis (hypergeometric test against the annotated background of tested genes)'} was performed against ${p.collection}; p-values were adjusted by Benjamini–Hochberg`,
};
const dataBase = () => assetUrl('data/');
const palette = () => [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d')];

export default function ExpressionStudio() {
  const [counts, setCounts] = useState(''), [sheet, setSheet] = useState('');
  const [truth, setTruth] = useState<Set<string> | null>(null);
  const [minCpm, setMinCpm] = useState(1), [minSamples, setMinSamples] = useState(2), [lfc, setLfc] = useState(0), [fdr, setFdr] = useState(0.05);
  const [groupA, setGroupA] = useState(''), [groupB, setGroupB] = useState('');
  const [res, setRes] = useState<Analysed | null>(null);
  const [tab, setTab] = useState<ResTab>('de');
  const { run, busy, progress, note, error, cancel } = useRunner();

  const groups = useMemo(() => [...new Set(sheet.split(/\r?\n/).slice(1).map((l) => l.split(/[\t,]/)[1]?.trim()).filter(Boolean))] as string[], [sheet]);
  const ga = groupA && groups.includes(groupA) ? groupA : groups[0] ?? '', gb = groupB && groups.includes(groupB) ? groupB : groups[1] ?? groups[0] ?? '';

  const [planted, setPlanted] = useState<string | null>(null);
  const hand = useHandoff((s) => s.expr);
  useEffect(() => { if (hand) { setCounts(hand.counts); setSheet(hand.sheet); setTruth(null); setPlanted(null); setRes(null); setGroupA(''); setGroupB(''); clearHandoffSoon('expr'); } }, [hand]);
  const demoReal = async () => {
    const pack = await fetch(dataBase() + 'reactome_human.json').then((r) => r.json()) as GeneSetPack;
    const set = pack.sets.find((s) => /^Interferon Signaling$/i.test(s.name)) ?? pack.sets.find((s) => s.g.length > 80 && s.g.length < 250)!;
    const up = new Set(set.g.map((i) => pack.genes[i])); let sd = 11; const rnd = () => ((sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296);
    const pool = pack.genes.filter((g) => !up.has(g) && /^[A-Z0-9-]+$/.test(g)).sort(() => rnd() - 0.5).slice(0, 4200 - up.size), names = [...up, ...pool].sort(() => rnd() - 0.5);
    const e = syntheticExperiment(5, names.length, 4, { names, up }); setCounts(e.csv); setSheet(e.sheet); setTruth(e.truth); setPlanted(set.name); setGroupA('control'); setGroupB('treated'); setRes(null);
  };
  const demoBatch = () => { const e = syntheticBatchExperiment(9, 3000, 6); setCounts(e.csv); setSheet(e.sheet); setTruth(e.truth); setPlanted(null); setGroupA('control'); setGroupB('treated'); setRes(null); };
  const demo = () => { const e = syntheticExperiment(7, 4000, 4); setCounts(e.csv); setSheet(e.sheet); setTruth(e.truth); setPlanted(null); setGroupA('control'); setGroupB('treated'); setRes(null); };
  const go = () => {
    const params = { groupA: ga, groupB: gb, minCpm, minSamples, lfcThreshold: lfc, fdr, batchCorrect: hasBatch };
    void run({ label: `DE · ${gb} vs ${ga}`, tool: TOOL, params, inputs: [{ name: 'counts', data: counts }, { name: 'sample_sheet', data: sheet }], run: (h) => remote.analyse({ counts, sheet, params }, { onProgress: h.onProgress, signal: h.signal }) }).then((r) => { if (r) { setRes(r); setTab('de'); } });
  };
  const hasBatch = sheet.split(/\r?\n/).slice(1).some((l) => !!l.split(/[\t,]/)[2]?.trim());
  const ready = counts.trim() && sheet.trim() && ga && gb;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Expression Studio</h1><p>Bulk RNA-seq from count matrix to differential expression, QC and figures. Statistics run in a Web Worker; no data leaves the browser.</p></div></div>
      <div className="split">
        <div className="stack">
          <Card title="1 · Data">
            <div className="stack" style={{ gap: 10 }}>
              <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setCounts(t); setTruth(null); setRes(null); }} label={counts ? `Counts loaded (${counts.split('\n').length - 1} genes)` : 'Count matrix (genes × samples, CSV/TSV)'} />
              <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setSheet(t); setRes(null); }} label={sheet ? `Sample sheet loaded (${groups.length} groups)` : 'Sample sheet (sample, group[, batch])'} />
              <button className="btn" onClick={demo}>Load synthetic demo (4,000 genes · 4 vs 4)</button>
              <button className="btn" onClick={demoBatch}>Load batch-effect demo (ComBat, 2 batches)</button>
              <button className="btn" onClick={() => void demoReal()}>Load real-gene demo (planted pathway, for enrichment)</button>
              {truth && <Callout>Synthetic counts{planted ? ` with real gene symbols; the “${planted}” pathway genes are planted as up-regulated` : ' with 300 planted DE genes'}. Results are checked against the planted truth.</Callout>}
            </div>
          </Card>
          <Card title="2 · Design & thresholds">
            <div className="stack" style={{ gap: 10 }}>
              <div className="cols-2" style={{ gap: 8 }}>
                <Field label="Reference group"><select className="select" value={ga} onChange={(e) => setGroupA(e.target.value)}>{groups.map((g) => <option key={g}>{g}</option>)}</select></Field>
                <Field label="Comparison group"><select className="select" value={gb} onChange={(e) => setGroupB(e.target.value)}>{groups.map((g) => <option key={g}>{g}</option>)}</select></Field>
              </div>
              <div className="cols-2" style={{ gap: 8 }}>
                <Field label="Min CPM"><input className="input" type="number" min={0} step={0.5} value={minCpm} onChange={(e) => setMinCpm(+e.target.value)} /></Field>
                <Field label="In ≥ samples"><input className="input" type="number" min={1} value={minSamples} onChange={(e) => setMinSamples(+e.target.value)} /></Field>
                <Field label="|log2FC| ≥"><input className="input" type="number" min={0} step={0.1} value={lfc} onChange={(e) => setLfc(+e.target.value)} /></Field>
                <Field label="FDR ≤"><input className="input" type="number" min={0.001} max={1} step={0.01} value={fdr} onChange={(e) => setFdr(+e.target.value)} /></Field>
              </div>
              <div className="row"><button className="btn primary" onClick={go} disabled={!ready || busy}><span style={{ display: 'inline-flex' }}>▶</span> Run analysis</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
              {busy && <Busy progress={progress} note={note} />}
              {error && <Callout kind="err">{error}</Callout>}
            </div>
          </Card>
          <Callout>Engine v0: moderated t on log2-CPM (no voom weights yet). PyDESeq2 in Pyodide is planned. Always confirm key findings with your reference pipeline.</Callout>
        </div>
        <div className="stack">
          {!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load data, choose the two groups and run. Try the synthetic demo to see the full workflow in seconds.</div></Card> : <Results res={res} tab={tab} setTab={setTab} truth={truth} planted={planted} />}
        </div>
      </div>
    </div>
  );
}

type ResTab = 'qc' | 'pca' | 'de' | 'enrich' | 'heat';
function Results({ res, tab, setTab, truth, planted }: { res: Analysed; tab: ResTab; setTab(t: ResTab): void; truth: Set<string> | null; planted: string | null }) {
  const [pcX, setPcX] = useState(0), [pcY, setPcY] = useState(1), [pcView, setPcView] = useState<'corrected' | 'raw'>('corrected'), [pcBy, setPcBy] = useState<'group' | 'batch'>('group');
  const { de, qc, heat, batch } = res;
  const pca = batch && pcView === 'raw' ? batch.pcaBefore : res.pca;
  const bnames = batch ? [...new Set(batch.labels)] : [];
  const cols = palette();
  const gnames = [...new Set(qc.groups)];
  const gcol = (g: string) => cols[gnames.indexOf(g) % 4];
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => de.rows.filter((r) => !filter || r.gene.toLowerCase().includes(filter.toLowerCase())), [de, filter]);
  const volcano: Pt[] = useMemo(() => de.rows.map((r) => ({ x: r.log2FC, y: -Math.log10(Math.max(r.p, 1e-300)), cat: r.sig === 'ns' ? 0 : r.sig === 'up' ? 1 : 2, label: r.gene })), [de]);
  const ma: Pt[] = useMemo(() => de.rows.map((r) => ({ x: r.avgExpr, y: r.log2FC, cat: r.sig === 'ns' ? 0 : r.sig === 'up' ? 1 : 2, label: r.gene })), [de]);
  const dcols = [cssVar('--chart-mute'), cssVar('--chart-b'), cssVar('--chart-a')];
  let eval_: { tp: number; fp: number; sens: number; fdr: number } | null = null;
  if (truth) { const called = de.rows.filter((r) => r.sig !== 'ns'); const tp = called.filter((r) => truth.has(r.gene)).length; eval_ = { tp, fp: called.length - tp, sens: tp / truth.size, fdr: called.length ? (called.length - tp) / called.length : 0 }; }
  const exportDe = () => downloadText('differential_expression.csv', toCsv(de.rows.map((r) => ({ gene: r.gene, log2FC: r.log2FC, avg_log2cpm: r.avgExpr, t: r.t, p_value: r.p, fdr: r.fdr, call: r.sig }))), 'text/csv');
  return (
    <>
      <div className="cols-4">
        <Stat label="Genes tested" value={de.tested.toLocaleString()} hint={`${de.filteredOut} removed by expression filter`} /><Stat label="Up" value={<span style={{ color: cols[1] }}>{de.nUp.toLocaleString()}</span>} /><Stat label="Down" value={<span style={{ color: cols[0] }}>{de.nDown.toLocaleString()}</span>} /><Stat label="Prior df (EB)" value={Number.isFinite(de.priorDf) ? fmt(de.priorDf, 1) : '∞'} hint="Estimated df of the variance prior; larger = more shrinkage" />
      </div>
      {eval_ && <Callout><b style={{ color: 'var(--text)' }}>Validation against planted truth:</b>&nbsp;sensitivity {fmt(eval_.sens * 100, 0)}% ({eval_.tp}/{truth!.size}) · empirical FDR {fmt(eval_.fdr * 100, 1)}% (nominal {fmt(de.params.fdr * 100, 0)}%)</Callout>}
      <Tabs value={tab} onChange={setTab} items={[{ id: 'de', label: 'Differential expression' }, { id: 'enrich', label: 'Enrichment' }, { id: 'pca', label: 'PCA' }, { id: 'qc', label: 'QC' }, { id: 'heat', label: 'Top genes' }]} />
      {tab === 'de' && <>
        <div className="cols-2">
          <Card title="Volcano" sub={`${de.params.groupB} vs ${de.params.groupA}`}><Scatter points={volcano} colors={dcols} names={['not significant', 'up', 'down']} xLabel="log2 fold change" yLabel="-log10 p" vlines={de.params.lfcThreshold ? [-de.params.lfcThreshold, de.params.lfcThreshold] : []} height={360} /></Card>
          <Card title="MA plot"><Scatter points={ma} colors={dcols} xLabel="mean log2 CPM" yLabel="log2 fold change" hlines={[0]} height={360} /></Card>
        </div>
        <Card title="Results table" sub={`${rows.length.toLocaleString()} genes`} actions={<><input className="input" style={{ width: 160 }} placeholder="Filter gene…" value={filter} onChange={(e) => setFilter(e.target.value)} /><button className="btn sm" onClick={exportDe}>Export CSV</button></>} pad={false}>
          <DataTable<DeRow> rows={rows} rowKey={(r) => r.gene} cols={[
            { key: 'gene', label: 'Gene', sort: (r) => r.gene }, { key: 'log2FC', label: 'log2FC', num: true, render: (r) => fmt(r.log2FC, 3), sort: (r) => r.log2FC },
            { key: 'avg', label: 'Mean log2CPM', num: true, render: (r) => fmt(r.avgExpr, 2), sort: (r) => r.avgExpr }, { key: 't', label: 't', num: true, render: (r) => fmt(r.t, 2), sort: (r) => r.t },
            { key: 'p', label: 'p-value', num: true, render: (r) => sci(r.p), sort: (r) => r.p }, { key: 'fdr', label: 'FDR', num: true, render: (r) => sci(r.fdr), sort: (r) => r.fdr },
            { key: 'sig', label: 'Call', render: (r) => <span className={`badge ${r.sig === 'ns' ? 'planned' : r.sig === 'up' ? 'building' : 'live'}`}>{r.sig}</span> },
          ]} />
        </Card>
      </>}
      {tab === 'enrich' && <Enrichment de={de} planted={planted} />}
      {tab === 'pca' && <Card title="Principal components" sub={`top ${pca.nGenes} variable genes · log2 size-factor-normalised${batch ? (pcView === 'raw' ? ' · before ComBat' : ' · after ComBat') : ''}`} actions={<>{batch && <><select className="select" style={{ width: 140 }} value={pcView} onChange={(e) => setPcView(e.target.value as typeof pcView)}><option value="corrected">ComBat-corrected</option><option value="raw">Uncorrected</option></select><select className="select" style={{ width: 110 }} value={pcBy} onChange={(e) => setPcBy(e.target.value as typeof pcBy)}><option value="group">colour: group</option><option value="batch">colour: batch</option></select></>}<select className="select" style={{ width: 80 }} value={pcX} onChange={(e) => setPcX(+e.target.value)}>{pca.varExplained.map((_, i) => <option key={i} value={i}>PC{i + 1}</option>)}</select><select className="select" style={{ width: 80 }} value={pcY} onChange={(e) => setPcY(+e.target.value)}>{pca.varExplained.map((_, i) => <option key={i} value={i}>PC{i + 1}</option>)}</select></>}>
        <Scatter points={pca.scores.map((s, i) => ({ x: s[pcX] ?? 0, y: s[pcY] ?? 0, cat: batch && pcBy === 'batch' ? bnames.indexOf(batch.labels[i]) : gnames.indexOf(qc.groups[i]), label: `${qc.samples[i]} (${qc.groups[i]}${batch ? `, batch ${batch.labels[i]}` : ''})` }))} colors={cols} names={batch && pcBy === 'batch' ? bnames : gnames} xLabel={`PC${pcX + 1} (${fmt(pca.varExplained[pcX] * 100, 1)}%)`} yLabel={`PC${pcY + 1} (${fmt(pca.varExplained[pcY] * 100, 1)}%)`} radius={7} height={400} />
      {batch && <Callout>{batch.nBatches} batches detected in the sample sheet. ComBat removes batch location/scale per gene while protecting the group contrast. Differential expression above still uses the uncorrected counts (testing on ComBat-corrected values understates variance). <button className="btn" onClick={() => downloadText('combat_corrected_log2.csv', batch.correctedCsv, 'text/csv')}>Download corrected matrix</button></Callout>}</Card>}
      {tab === 'qc' && <div className="cols-2">
        <Card title="Library size" sub="total counts"><BarChart labels={qc.samples} values={qc.libSize} colors={qc.groups.map(gcol)} yLabel="Counts" fmt={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v))} /></Card>
        <Card title="Detected genes" sub="count > 0"><BarChart labels={qc.samples} values={qc.detected} colors={qc.groups.map(gcol)} yLabel="Genes" /></Card>
        <Card title="Size factors" sub="median-of-ratios"><BarChart labels={qc.samples} values={qc.sf} colors={qc.groups.map(gcol)} yLabel="Factor" fmt={(v) => v.toFixed(2)} /></Card>
        <Card title="Samples"><div className="legend">{gnames.map((g) => <span key={g}><i style={{ background: gcol(g) }} />{g}</span>)}</div></Card>
      </div>}
      {tab === 'heat' && <Card title="Top 40 genes by p-value" sub="row z-score of log2 normalised counts, clustered (UPGMA, 1−r)"><Heatmap rows={heat.genes} cols={heat.samples} z={heat.z} height={Math.max(300, heat.genes.length * 14 + 70)} /></Card>}
    </>
  );
}

type Coll = 'reactome' | 'wikipathways' | 'go_bp'; type Meth = 'ora-up' | 'ora-down' | 'ora-all' | 'gsea';
function Enrichment({ de, planted }: { de: Analysed['de']; planted: string | null }) {
  const { run, busy, progress, note, error } = useRunner();
  const [coll, setColl] = useState<Coll>('reactome'), [method, setMethod] = useState<Meth>('ora-up'), [fdr, setFdr] = useState(0.05), [lfc, setLfc] = useState(0.5), [out, setOut] = useState<Awaited<ReturnType<typeof remote.enrich>> | null>(null);
  const go = () => void run({ label: `Enrichment · ${coll} · ${method}`, tool: ENRICH_TOOL, params: { collection: coll, method, perms: 5000 }, inputs: [{ name: 'ranked_genes', data: de.rows.slice(0, 3000).map((r) => `${r.gene}:${r.t.toFixed(3)}`).join(',') }], run: (h) => remote.enrich({ dataBase: dataBase(), collection: coll, method, rows: de.rows.map((r) => ({ gene: r.gene, t: r.t, fdr: r.fdr, log2FC: r.log2FC })), fdr, lfc, perms: 5000 }, h) }).then((r) => r && setOut(r));
  const rows = out ? (out.kind === 'ora' ? out.ora! : out.gsea!) : [];
  const rank = planted && coll === 'reactome' ? rows.findIndex((r) => r.name.toLowerCase() === planted.toLowerCase()) : -1;
  const maxLog = Math.max(1, ...rows.slice(0, 15).map((r) => -Math.log10(Math.max(1e-300, r.fdr))));
  return (
    <>
      <Card title="Gene-set enrichment" sub="bundled offline: Reactome (CC BY 4.0), WikiPathways (CC0), Gene Ontology (CC BY 4.0). Human gene symbols or Ensembl IDs.">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Collection"><select className="select" value={coll} onChange={(e) => setColl(e.target.value as Coll)}><option value="reactome">Reactome pathways</option><option value="wikipathways">WikiPathways</option><option value="go_bp">GO Biological Process</option></select></Field>
          <Field label="Method"><select className="select" value={method} onChange={(e) => setMethod(e.target.value as Meth)}><option value="ora-up">ORA · up-regulated genes</option><option value="ora-down">ORA · down-regulated genes</option><option value="ora-all">ORA · all DE genes</option><option value="gsea">Preranked GSEA (all genes by t)</option></select></Field>
          {method !== 'gsea' && <><Field label="FDR ≤"><input className="input" type="number" step={0.01} value={fdr} onChange={(e) => setFdr(+e.target.value)} style={{ width: 80 }} /></Field><Field label="|log2FC| ≥"><input className="input" type="number" step={0.1} value={lfc} onChange={(e) => setLfc(+e.target.value)} style={{ width: 80 }} /></Field></>}
          <button className="btn primary" disabled={busy} onClick={go}>Run enrichment</button>
        </div>
        {busy && <div style={{ marginTop: 10 }}><Busy progress={progress} note={note} /></div>}{error && <div style={{ marginTop: 10 }}><Callout kind="err">{error}</Callout></div>}
        <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>KEGG is intentionally not offered: it requires a paid licence for commercial use. Reactome, WikiPathways and GO cover the same biology under open licences. Mouse data: symbols are matched case-insensitively against human orthologue symbols (approximate).</div>
      </Card>
      {out && <>
        {planted && coll === 'reactome' && <Callout><b style={{ color: 'var(--text)' }}>Validation:</b>&nbsp;the planted pathway “{planted}” ranks #{rank >= 0 ? rank + 1 : 'not found'} of {rows.length} ({out.kind === 'ora' ? 'ORA' : 'GSEA'}{rank >= 0 ? `, FDR ${sci(rows[rank].fdr)}` : ''}).</Callout>}
        <div className="cols-4"><Stat label="Collection" value={out.meta.name.split(':')[0].replace(' pathways', '')} /><Stat label={out.kind === 'ora' ? 'Genes tested' : 'Genes ranked'} value={out.listSize.toLocaleString()} /><Stat label="Significant (FDR<0.05)" value={rows.filter((r) => r.fdr < 0.05).length} /><Stat label="IDs mapped (Ensembl)" value={out.mapped} /></div>
        <Card title="Top terms" sub={`${out.meta.name} · ${out.meta.license} · ${out.meta.attribution}`} actions={<button className="btn sm" onClick={() => downloadText('enrichment.csv', toCsv(rows.map((r) => ({ ...r, genes: 'genes' in r ? r.genes.join(';') : '', leadingEdge: 'leadingEdge' in r ? r.leadingEdge.join(';') : '' }))), 'text/csv')}>CSV</button>} pad={false}>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="t"><thead><tr><th>Term</th><th className="num">{out.kind === 'ora' ? 'Overlap / set' : 'Size'}</th><th className="num">{out.kind === 'ora' ? 'Fold' : 'NES'}</th><th className="num">FDR</th><th style={{ width: 160 }}>−log10 FDR</th></tr></thead><tbody>
            {rows.slice(0, 30).map((r) => <tr key={r.id}><td title={'genes' in r ? r.genes.join(', ') : (r as GseaRow).leadingEdge.join(', ')}>{r.name}<div className="faint" style={{ fontSize: 11 }}>{r.id}</div></td><td className="num">{out.kind === 'ora' ? `${(r as OraRow).overlap} / ${(r as OraRow).setSize}` : (r as GseaRow).size}</td><td className="num">{fmt(out.kind === 'ora' ? (r as OraRow).fold : (r as GseaRow).nes, 2)}</td><td className="num">{sci(r.fdr)}</td><td><div className="progress" style={{ height: 8 }}><i style={{ width: `${Math.min(100, (-Math.log10(Math.max(1e-300, r.fdr)) / maxLog) * 100)}%` }} /></div></td></tr>)}
          </tbody></table></div>
        </Card></>}
    </>
  );
}
