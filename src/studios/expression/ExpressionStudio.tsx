import { assetUrl } from '@/core/asset';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { clearHandoffSoon, useHandoff } from '@/core/handoff';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, sci, toast, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { BarChart, Heatmap, Scatter, cssVar, type Pt } from '@/viz/charts';
import type { Analysed, ExpressionKernels } from './expression.worker';
import { syntheticBatchExperiment, syntheticExperiment, type DeRow } from './kernels';
import { checkDesign, defaultTest, formula, guessSpecs, levelsOf, parseSheet, syntheticPairedExperiment, testLabel, type TestSpec, type VarSpec } from './design';
import type { GeneSetPack, GseaRow, OraRow } from './enrichment';

const QuantifyCard = lazy(() => import('./QuantifyCard'));
const remote = createRemote<ExpressionKernels>(() => new Worker(new URL('./expression.worker.ts', import.meta.url), { type: 'module' }));

const TOOL: ToolInfo = {
  id: 'expression.de', name: 'Bulk RNA-seq differential expression', version: '0.2.0', engine: 'TypeScript worker kernel (TMM, voom, linear model, empirical-Bayes moderated t/F; validated against edgeR/limma)',
  citations: ['robinson2010', 'law2014', 'smyth2004', 'benjamini1995', 'anders2010', 'johnson2007'],
  describe: (p) => `Genes with ≥${p.minCpm} CPM in ≥${p.minSamples} samples were kept and normalised by TMM; log2-CPM values were fitted to the design ${p.formula}${p.voom ? ' with voom precision weights' : ''} by ${p.voom ? 'weighted ' : ''}least squares, and ${p.test} was assessed with empirical-Bayes moderated ${p.mode === 'anova' ? 'F' : 't'}-statistics; p-values were adjusted by Benjamini–Hochberg. For QC, PCA and heatmaps, counts were normalised with the median-of-ratios method${p.batch ? `, and the “${p.batch}” effect was removed for these plots only with parametric empirical-Bayes ComBat` : ''}`,
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
  const [truth, setTruth] = useState<{ genes: Set<string>; label: string } | null>(null); // planted genes and the comparison they answer
  const [minCpm, setMinCpm] = useState(1), [minSamples, setMinSamples] = useState(2), [lfc, setLfc] = useState(0), [fdr, setFdr] = useState(0.05), [useVoom, setUseVoom] = useState(true);
  const [res, setRes] = useState<Analysed | null>(null);
  const [tab, setTab] = useState<ResTab>('de');
  const { run, busy, progress, note, error, cancel } = useRunner();

  const samples = useMemo(() => { const h = counts.slice(0, counts.indexOf('\n') >>> 0).trim(); return h ? h.split(h.includes('\t') ? '\t' : ',').slice(1).map((x) => x.trim().replace(/^"|"$/g, '')) : undefined; }, [counts]);
  const sh = useMemo(() => parseSheet(sheet, samples), [sheet, samples]);
  const [specs, setSpecs] = useState<VarSpec[]>([]), [test, setTest] = useState<TestSpec | null>(null);
  const sheetKey = sh.columns.join('|') + '#' + sh.samples.length;
  useEffect(() => { const g = guessSpecs(sh); setSpecs(g); setTest(defaultTest(sh, g)); }, [sheetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const check = useMemo(() => (specs.length || test ? checkDesign(sh, specs, test, samples ?? sh.samples) : { error: 'Load a sample sheet to set up the design.' }), [sh, specs, test, samples]);

  const [planted, setPlanted] = useState<string | null>(null);
  const hand = useHandoff((s) => s.expr);
  useEffect(() => { if (hand) { setCounts(hand.counts); setSheet(hand.sheet); setTruth(null); setPlanted(null); setRes(null); clearHandoffSoon('expr'); } }, [hand]);
  const load = (e: { csv: string; sheet: string; truth: Set<string> }, pl: string | null = null, label = 'treated vs control') => { setCounts(e.csv); setSheet(e.sheet); setTruth({ genes: e.truth, label }); setPlanted(pl); setRes(null); };
  const demoReal = async () => {
    const pack = await fetch(dataBase() + 'reactome_human.json').then((r) => r.json()) as GeneSetPack;
    const set = pack.sets.find((s) => /^Interferon Signaling$/i.test(s.name)) ?? pack.sets.find((s) => s.g.length > 80 && s.g.length < 250)!;
    const up = new Set(set.g.map((i) => pack.genes[i])); let sd = 11; const rnd = () => ((sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296);
    const pool = pack.genes.filter((g) => !up.has(g) && /^[A-Z0-9-]+$/.test(g)).sort(() => rnd() - 0.5).slice(0, 4200 - up.size), names = [...up, ...pool].sort(() => rnd() - 0.5);
    load(syntheticExperiment(5, names.length, 4, { names, up }), set.name);
  };
  const go = () => {
    if (!test) return;
    const params = { formula: formula(specs), test: testLabel(test), mode: test.kind, minCpm, minSamples, lfcThreshold: lfc, fdr, voom: useVoom, batch: sh.columns.find((c) => /^batch$/i.test(c)) ?? '' };
    void run({ label: `DE · ${testLabel(test)}`, tool: TOOL, params, inputs: [{ name: 'counts', data: counts }, { name: 'sample_sheet', data: sheet }], run: (h) => remote.analyse({ counts, sheet, run: { specs, test, minCpm, minSamples, useVoom, fdr, lfc } }, { onProgress: h.onProgress, signal: h.signal }) }).then((r) => { if (r) { setRes(r); setTab('de'); } });
  };
  const ready = counts.trim() && sheet.trim() && !check.error;
  const setSpec = (i: number, patch: Partial<VarSpec>) => setSpecs((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const factors = specs.filter((s) => s.use && s.kind === 'factor'), numerics = specs.filter((s) => s.use && s.kind === 'numeric');
  const setKind = (k: TestSpec['kind']) => {
    if (k === 'slope') { setTest(numerics[0] ? { kind: 'slope', variable: numerics[0].name } : null); return; }
    const f = (test && test.kind !== 'slope' && factors.find((x) => x.name === test.factor)) || (k === 'anova' ? factors.find((x) => levelsOf(sh, x.name).length > 2) : undefined) || factors[0];
    if (!f) { setTest(null); return; }
    const lv = levelsOf(sh, f.name), ref = f.reference ?? lv[0];
    setTest(k === 'anova' ? { kind: 'anova', factor: f.name } : { kind: 'pair', factor: f.name, a: ref, b: lv.find((x) => x !== ref) ?? ref });
  };
  const setFactor = (name: string) => { const lv = levelsOf(sh, name), ref = specs.find((s) => s.name === name)?.reference ?? lv[0]; setTest(test?.kind === 'anova' ? { kind: 'anova', factor: name } : { kind: 'pair', factor: name, a: ref, b: lv.find((x) => x !== ref) ?? ref }); };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Expression Studio</h1><p>Bulk RNA-seq from count matrix to differential expression, QC and figures, for any experimental design. Statistics run in a Web Worker; no data leaves the browser.</p></div></div>
      <div className="split">
        <div className="stack">
          <Card title="1 · Data">
            <div className="stack" style={{ gap: 10 }}>
              <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setCounts(t); setTruth(null); setRes(null); }} label={counts ? `Counts loaded (${counts.split('\n').length - 1} genes)` : 'Count matrix (genes × samples, CSV/TSV)'} />
              <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setSheet(t); setRes(null); }} label={sheet ? `Sample sheet loaded (${sh.samples.length} samples · ${sh.columns.length} variable${sh.columns.length === 1 ? '' : 's'})` : 'Sample sheet (sample, then one column per variable)'} />
              <button className="btn" onClick={() => load(syntheticExperiment(7, 4000, 4))}>Load synthetic demo (4,000 genes · 4 vs 4)</button>
              <button className="btn" onClick={() => load(syntheticPairedExperiment(), null, 'drugA vs control')}>Load paired demo (3 treatments × 4 donors)</button>
              <button className="btn" onClick={() => load(syntheticBatchExperiment(9, 3000, 6))}>Load batch-effect demo (2 batches)</button>
              <button className="btn" onClick={() => void demoReal()}>Load real-gene demo (planted pathway, for enrichment)</button>
              {truth && <Callout>Synthetic counts{planted ? ` with real gene symbols; the “${planted}” pathway genes are planted as up-regulated` : ` with ${truth.genes.size} planted DE genes (${truth.label})`}. Results of that comparison are checked against the planted truth.</Callout>}
            </div>
          </Card>
          <Suspense fallback={null}><QuantifyCard onUse={(c, sh, note) => { setCounts(c); if (sh) setSheet(sh); setTruth(null); setPlanted(null); setRes(null); toast(note); }} /></Suspense>
          <Card title="2 · Design">
            <div className="stack" style={{ gap: 10 }}>
              {!specs.length ? <div className="faint">Load a sample sheet: the first column names the samples, each further column is a variable (group, batch, donor, age…).</div> : <>
                <div className="table-wrap"><table className="t"><thead><tr><th>Use</th><th>Variable</th><th>Type</th><th>Baseline level</th></tr></thead><tbody>
                  {specs.map((s, i) => { const lv = levelsOf(sh, s.name), numOk = lv.length > 0 && lv.every((v) => Number.isFinite(Number(v))); return (
                    <tr key={s.name}>
                      <td><input type="checkbox" aria-label={`Use ${s.name} in the model`} checked={s.use} onChange={(e) => setSpec(i, { use: e.target.checked })} /></td>
                      <td>{s.name}<div className="faint" style={{ fontSize: 11 }}>{lv.length} distinct value{lv.length === 1 ? '' : 's'}</div></td>
                      <td><select className="select" aria-label={`Type of ${s.name}`} value={s.kind} disabled={!numOk} onChange={(e) => setSpec(i, { kind: e.target.value as VarSpec['kind'], reference: e.target.value === 'factor' ? lv[0] : undefined })}><option value="factor">factor</option><option value="numeric">numeric</option></select></td>
                      <td>{s.kind === 'factor' ? <select className="select" aria-label={`Baseline level of ${s.name}`} value={s.reference ?? lv[0]} onChange={(e) => setSpec(i, { reference: e.target.value })}>{lv.map((l) => <option key={l}>{l}</option>)}</select> : <span className="faint">centred</span>}</td>
                    </tr>); })}
                </tbody></table></div>
                <div className="faint" style={{ fontSize: 12 }}>Model <code>{formula(specs)}</code>{check.design ? ` · ${check.design.columns.length} coefficients · ${(samples?.length ?? sh.samples.length) - check.design.columns.length} residual df` : ''}. Paired or repeated samples: include the donor/subject column. Batches: include the batch column.</div>
              </>}
            </div>
          </Card>
          <Card title="3 · Test & thresholds">
            <div className="stack" style={{ gap: 10 }}>
              <Field label="Question"><select className="select" value={test?.kind ?? 'pair'} onChange={(e) => setKind(e.target.value as TestSpec['kind'])}><option value="pair">Compare two levels of a factor</option><option value="anova" disabled={!factors.some((f) => levelsOf(sh, f.name).length > 2)}>Any difference across all levels (F-test)</option><option value="slope" disabled={!numerics.length}>Trend with a numeric variable</option></select></Field>
              {test && test.kind !== 'slope' && <Field label="Factor"><select className="select" value={test.factor} onChange={(e) => setFactor(e.target.value)}>{factors.map((f) => <option key={f.name}>{f.name}</option>)}</select></Field>}
              {test?.kind === 'pair' && <div className="cols-2" style={{ gap: 8 }}>
                <Field label="Reference level"><select className="select" value={test.a} onChange={(e) => setTest({ ...test, a: e.target.value })}>{levelsOf(sh, test.factor).map((g) => <option key={g}>{g}</option>)}</select></Field>
                <Field label="Comparison level"><select className="select" value={test.b} onChange={(e) => setTest({ ...test, b: e.target.value })}>{levelsOf(sh, test.factor).map((g) => <option key={g}>{g}</option>)}</select></Field>
              </div>}
              {test?.kind === 'slope' && <Field label="Variable"><select className="select" value={test.variable} onChange={(e) => setTest({ kind: 'slope', variable: e.target.value })}>{numerics.map((f) => <option key={f.name}>{f.name}</option>)}</select></Field>}
              <div className="cols-2" style={{ gap: 8 }}>
                <Field label="Min CPM"><input className="input" type="number" min={0} step={0.5} value={minCpm} onChange={(e) => setMinCpm(+e.target.value)} /></Field>
                <Field label="In ≥ samples"><input className="input" type="number" min={1} value={minSamples} onChange={(e) => setMinSamples(+e.target.value)} /></Field>
                <Field label="|log2FC| ≥"><input className="input" type="number" min={0} step={0.1} value={lfc} onChange={(e) => setLfc(+e.target.value)} /></Field>
                <Field label="FDR ≤"><input className="input" type="number" min={0.001} max={1} step={0.01} value={fdr} onChange={(e) => setFdr(+e.target.value)} /></Field>
              </div>
              <label className="row" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={useVoom} onChange={(e) => setUseVoom(e.target.checked)} /> voom precision weights (recommended)</label>
              {check.error && sheet.trim() && <Callout kind="err">{check.error}</Callout>}
              <div className="row"><button className="btn primary" onClick={go} disabled={!ready || busy}><span style={{ display: 'inline-flex' }}>▶</span> Run analysis</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
              {busy && <Busy progress={progress} note={note} />}
              {error && <Callout kind="err">{error}</Callout>}
            </div>
          </Card>
          <Callout>TMM normalisation, voom weights and moderated t/F statistics reproduce edgeR + limma to about 1e-11 on the bundled benchmark. Always confirm key findings with your reference pipeline.</Callout>
        </div>
        <div className="stack">
          {!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load data, set up the design and run. Try the synthetic demo to see the full workflow in seconds.</div></Card> : <Results res={res} tab={tab} setTab={setTab} truth={truth} planted={planted} />}
        </div>
      </div>
    </div>
  );
}

type ResTab = 'qc' | 'pca' | 'de' | 'enrich' | 'heat';
function Results({ res, tab, setTab, truth, planted }: { res: Analysed; tab: ResTab; setTab(t: ResTab): void; truth: { genes: Set<string>; label: string } | null; planted: string | null }) {
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
  if (truth && truth.label === de.label) { const called = de.rows.filter((r) => r.sig !== 'ns'); const tp = called.filter((r) => truth.genes.has(r.gene)).length; eval_ = { tp, fp: called.length - tp, sens: tp / truth.genes.size, fdr: called.length ? (called.length - tp) / called.length : 0 }; }
  const anova = de.mode === 'anova', lfcLabel = anova ? 'largest log2FC' : de.mode === 'slope' ? 'log2FC per unit' : 'log2FC';
  const exportDe = () => downloadText('differential_expression.csv', toCsv(de.rows.map((r) => anova
    ? { gene: r.gene, ...Object.fromEntries((de.levelNames ?? []).map((n, i) => [`log2FC ${n}`, r.lfcs?.[i]])), avg_log2cpm: r.avgExpr, F: r.t, p_value: r.p, fdr: r.fdr, call: r.sig === 'ns' ? 'ns' : 'sig' }
    : { gene: r.gene, [lfcLabel.replace(/ /g, '_')]: r.log2FC, avg_log2cpm: r.avgExpr, t: r.t, p_value: r.p, fdr: r.fdr, call: r.sig })), 'text/csv');
  return (
    <>
      <div className="cols-4">
        <Stat label="Genes tested" value={de.tested.toLocaleString()} hint={`${de.filteredOut} removed by expression filter`} /><Stat label="Up" value={<span style={{ color: cols[1] }}>{de.nUp.toLocaleString()}</span>} /><Stat label="Down" value={<span style={{ color: cols[0] }}>{de.nDown.toLocaleString()}</span>} /><Stat label="Prior df (EB)" value={Number.isFinite(de.priorDf) ? fmt(de.priorDf, 1) : '∞'} hint="Estimated df of the variance prior; larger = more shrinkage" />
      </div>
      {eval_ && <Callout><b style={{ color: 'var(--text)' }}>Validation against planted truth:</b>&nbsp;sensitivity {fmt(eval_.sens * 100, 0)}% ({eval_.tp}/{truth!.genes.size}) · empirical FDR {fmt(eval_.fdr * 100, 1)}% (nominal {fmt(de.params.fdr * 100, 0)}%)</Callout>}
      <Tabs value={tab} onChange={setTab} items={[{ id: 'de', label: 'Differential expression' }, { id: 'enrich', label: 'Enrichment' }, { id: 'pca', label: 'PCA' }, { id: 'qc', label: 'QC' }, { id: 'heat', label: 'Top genes' }]} />
      {tab === 'de' && <>
        <div className="cols-2">
          <Card title="Volcano" sub={`${de.label} · ${de.formula}`}><Scatter points={volcano} colors={dcols} names={['not significant', 'up', 'down']} xLabel={lfcLabel} yLabel="-log10 p" labelScore={(q) => Math.abs(q.x) * q.y} labelDefault={10} exportName="volcano" vlines={de.params.lfcThreshold ? [-de.params.lfcThreshold, de.params.lfcThreshold] : []} height={360} /></Card>
          <Card title="MA plot"><Scatter points={ma} colors={dcols} xLabel="mean log2 CPM" yLabel={lfcLabel} hlines={[0]} labelScore={(q) => Math.abs(q.y)} labelDefault={10} exportName="ma-plot" height={360} /></Card>
        </div>
        <Card title="Results table" sub={`${rows.length.toLocaleString()} genes`} actions={<><input className="input" style={{ width: 160 }} placeholder="Filter gene…" value={filter} onChange={(e) => setFilter(e.target.value)} /><button className="btn sm" onClick={exportDe}>Export CSV</button></>} pad={false}>
          <DataTable<DeRow> rows={rows} rowKey={(r) => r.gene} cols={[
            { key: 'gene', label: 'Gene', sort: (r) => r.gene }, { key: 'log2FC', label: lfcLabel, num: true, render: (r) => fmt(r.log2FC, 3), sort: (r) => r.log2FC },
            { key: 'avg', label: 'Mean log2CPM', num: true, render: (r) => fmt(r.avgExpr, 2), sort: (r) => r.avgExpr }, { key: 't', label: anova ? 'F' : 't', num: true, render: (r) => fmt(r.t, 2), sort: (r) => r.t },
            { key: 'p', label: 'p-value', num: true, render: (r) => sci(r.p), sort: (r) => r.p }, { key: 'fdr', label: 'FDR', num: true, render: (r) => sci(r.fdr), sort: (r) => r.fdr },
            { key: 'sig', label: 'Call', render: (r) => <span className={`badge ${r.sig === 'ns' ? 'planned' : r.sig === 'up' ? 'building' : 'live'}`}>{r.sig}</span> },
          ]} />
        </Card>
      </>}
      {tab === 'enrich' && <Enrichment de={de} planted={planted} />}
      {tab === 'pca' && <Card title="Principal components" sub={`top ${pca.nGenes} variable genes · log2 size-factor-normalised${batch ? (pcView === 'raw' ? ' · before ComBat' : ' · after ComBat') : ''}`} actions={<>{batch && <><select className="select" style={{ width: 140 }} value={pcView} onChange={(e) => setPcView(e.target.value as typeof pcView)}><option value="corrected">ComBat-corrected</option><option value="raw">Uncorrected</option></select><select className="select" style={{ width: 110 }} value={pcBy} onChange={(e) => setPcBy(e.target.value as typeof pcBy)}><option value="group">colour: {qc.colourBy || 'group'}</option><option value="batch">colour: batch</option></select></>}<select className="select" style={{ width: 80 }} value={pcX} onChange={(e) => setPcX(+e.target.value)}>{pca.varExplained.map((_, i) => <option key={i} value={i}>PC{i + 1}</option>)}</select><select className="select" style={{ width: 80 }} value={pcY} onChange={(e) => setPcY(+e.target.value)}>{pca.varExplained.map((_, i) => <option key={i} value={i}>PC{i + 1}</option>)}</select></>}>
        <Scatter points={pca.scores.map((s, i) => ({ x: s[pcX] ?? 0, y: s[pcY] ?? 0, cat: batch && pcBy === 'batch' ? bnames.indexOf(batch.labels[i]) : gnames.indexOf(qc.groups[i]), label: `${qc.samples[i]} (${qc.groups[i]}${batch ? `, batch ${batch.labels[i]}` : ''})` }))} colors={cols} names={batch && pcBy === 'batch' ? bnames : gnames} xLabel={`PC${pcX + 1} (${fmt(pca.varExplained[pcX] * 100, 1)}%)`} yLabel={`PC${pcY + 1} (${fmt(pca.varExplained[pcY] * 100, 1)}%)`} radius={7} height={400} />
      {batch && <Callout>{batch.nBatches} batches detected in the sample sheet. ComBat removes batch location/scale per gene while protecting the group contrast. ComBat is used for these plots only: differential expression uses the uncorrected counts{de.formula.includes(batch.column) ? `, with “${batch.column}” as a term in the model` : ''} (testing on ComBat-corrected values understates variance). <button className="btn" onClick={() => downloadText('combat_corrected_log2.csv', batch.correctedCsv, 'text/csv')}>Download corrected matrix</button></Callout>}</Card>}
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
  const anova = de.mode === 'anova';
  const [coll, setColl] = useState<Coll>('reactome'), [method, setMethod] = useState<Meth>(anova ? 'ora-all' : 'ora-up'), [fdr, setFdr] = useState(0.05), [lfc, setLfc] = useState(0.5), [out, setOut] = useState<Awaited<ReturnType<typeof remote.enrich>> | null>(null);
  const go = () => void run({ label: `Enrichment · ${coll} · ${method}`, tool: ENRICH_TOOL, params: { collection: coll, method, perms: 5000 }, inputs: [{ name: 'ranked_genes', data: de.rows.slice(0, 3000).map((r) => `${r.gene}:${r.t.toFixed(3)}`).join(',') }], run: (h) => remote.enrich({ dataBase: dataBase(), collection: coll, method, rows: de.rows.map((r) => ({ gene: r.gene, t: r.t, fdr: r.fdr, log2FC: r.log2FC })), fdr, lfc, perms: 5000 }, h) }).then((r) => r && setOut(r));
  const rows = out ? (out.kind === 'ora' ? out.ora! : out.gsea!) : [];
  const rank = planted && coll === 'reactome' ? rows.findIndex((r) => r.name.toLowerCase() === planted.toLowerCase()) : -1;
  const maxLog = Math.max(1, ...rows.slice(0, 15).map((r) => -Math.log10(Math.max(1e-300, r.fdr))));
  return (
    <>
      <Card title="Gene-set enrichment" sub="bundled offline: Reactome (CC BY 4.0), WikiPathways (CC0), Gene Ontology (CC BY 4.0). Human gene symbols or Ensembl IDs.">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Collection"><select className="select" value={coll} onChange={(e) => setColl(e.target.value as Coll)}><option value="reactome">Reactome pathways</option><option value="wikipathways">WikiPathways</option><option value="go_bp">GO Biological Process</option></select></Field>
          <Field label="Method"><select className="select" value={method} onChange={(e) => setMethod(e.target.value as Meth)}>{!anova && <><option value="ora-up">ORA · up-regulated genes</option><option value="ora-down">ORA · down-regulated genes</option></>}<option value="ora-all">ORA · all DE genes</option>{!anova && <option value="gsea">Preranked GSEA (all genes by t)</option>}</select></Field>
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
