import { useEffect, useMemo, useState } from 'react';
import { useHandoff } from '@/core/handoff';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { BarChart, Histogram, LineChart, cssVar } from '@/viz/charts';
import { MatrixHeat, MultiLine, TreeView } from '@/viz/more';
import { parseNewick } from '../phylo/kernels';
import { rebin } from './helpers';
import { syntheticAssembly, syntheticBed, syntheticFastq, syntheticGenomes } from './kernels';
import type { GenomeKernels } from './genome.worker';
import { GenomeViewer } from './GenomeViewer';
import { MappingPanel, type Mapped } from './MappingPanel';
import { CrisprOffTargetPanel, PrimerSpecificityPanel } from './SpecificityPanels';
import AssemblyPanel from './AssemblyPanel';

const remote = createRemote<GenomeKernels>(() => new Worker(new URL('./genome.worker.ts', import.meta.url), { type: 'module' }));
const V = '0.1.0', E = 'TypeScript worker kernels';
const T = (id: string, name: string, describe: ToolInfo['describe'], citations: string[] = []): ToolInfo => ({ id, name, version: V, engine: E, citations, describe });
const TOOLS = {
  fastq: T('genome.fastq-qc', 'FASTQ quality control', (p) => `Read quality was assessed by streaming ${p.maxReads === 0 ? 'all reads' : `up to ${p.maxReads} reads`} (per-position Phred quality, GC content, length, adapter k-mer search, duplication on 50-bp prefixes, 3′ quality-trim projections)`),
  asm: T('genome.assembly', 'Assembly statistics', () => 'Assembly contiguity statistics (N50/N90/L50, GC content, N content, contig length distribution) were computed'),
  iv: T('genome.intervals', 'Interval algebra', (p) => `Genomic intervals were processed with the ${p.op} operation (sweep-line implementation, BED half-open coordinates)`),
  cmp: T('genome.mash', 'MinHash genome comparison', (p) => `Whole-genome similarity was estimated with MinHash bottom-${p.size} sketches of canonical ${p.k}-mers and the Mash distance transform (Ondov et al. 2016); ANI ≈ 1 − Mash distance; trees by UPGMA`, ['ondov2016']),
  gff: T('genome.gff', 'GFF/GTF summary', () => 'Annotation features were tallied from GFF/GTF'),
};
type Tab = 'reads' | 'mapping' | 'browser' | 'primers' | 'crispr' | 'assemble' | 'assembly' | 'intervals' | 'compare';
const N_FILTER = new Set(['A', 'C', 'G', 'T']);
void N_FILTER;

export default function GenomeStudio() {
  const [tab, setTab] = useState<Tab>('reads'), [mapped, setMapped] = useState<Mapped | null>(null), oligos = useHandoff((s) => s.oligos), view = useHandoff((s) => s.view);
  // Oligos from Sequence Studio and files from Variant Studio open the tool that consumes them.
  useEffect(() => { if (oligos) setTab(oligos.guides.length ? 'crispr' : 'primers'); }, [oligos]);
  useEffect(() => { if (view?.length) setTab('browser'); }, [view]);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Genome Studio</h1><p>Streaming read QC, mapping with real minimap2, samtools and bcftools (WebAssembly), SNV and indel calling, an igv.js genome viewer with bundled RefSeq genomes, primer specificity and CRISPR off-target search, assembly metrics, interval algebra and MinHash genome comparison. Everything runs in your browser.</p></div></div>
      <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'reads', label: 'Read QC' }, { id: 'mapping', label: 'Mapping & variants' }, { id: 'browser', label: 'Genome viewer' }, { id: 'primers', label: 'Primer specificity' }, { id: 'crispr', label: 'CRISPR off-targets' }, { id: 'assemble', label: 'Assembly' }, { id: 'assembly', label: 'Assembly stats' }, { id: 'intervals', label: 'Intervals & annotation' }, { id: 'compare', label: 'Genome comparison' }]} />
      {tab === 'reads' && <ReadQc />}<div hidden={tab !== 'mapping'}><MappingPanel onMapped={setMapped} onBrowse={() => setTab('browser')} /></div>{tab === 'browser' && <GenomeViewer mapped={mapped} />}{tab === 'primers' && <PrimerSpecificityPanel />}{tab === 'crispr' && <CrisprOffTargetPanel />}{tab === 'assemble' && <AssemblyPanel />}{tab === 'assembly' && <Assembly />}{tab === 'intervals' && <Intervals />}{tab === 'compare' && <Compare />}
    </div>
  );
}

function ReadQc() {
  const { run, busy, progress, note, error, cancel } = useRunner();
  const [res, setRes] = useState<Awaited<ReturnType<GenomeKernels['fastq']>> | null>(null), [maxReads, setMax] = useState(500000), [name, setName] = useState('');
  const go = (src: { file?: File; text?: string }, label: string) => { setName(label); void run({ label: `FASTQ QC · ${label}`, tool: TOOLS.fastq, params: { maxReads }, inputs: [{ name: label, data: src.text ?? `${label}:${src.file?.size}:${src.file?.lastModified}` }], run: (h) => remote.fastq({ ...src, maxReads: maxReads || Infinity }, h) }).then((r) => r && setRes(r)); };
  const q = res?.pos ?? [];
  return (
    <div className="split"><div className="stack">
      <Card title="FASTQ file" sub=".fastq / .fq / .gz">
        <div className="stack" style={{ gap: 10 }}>
          <label className="dropzone"><input type="file" hidden accept=".fastq,.fq,.gz" onChange={(e) => { const f = e.target.files?.[0]; if (f) go({ file: f }, f.name); }} />Choose a FASTQ file<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Streamed from disk in chunks. Never uploaded, never fully loaded.</div></label>
          <Field label="Reads to analyse"><select className="select" value={maxReads} onChange={(e) => setMax(+e.target.value)}><option value={100000}>First 100,000</option><option value={500000}>First 500,000</option><option value={2000000}>First 2 million</option><option value={0}>All reads (slow for big files)</option></select></Field>
          <button className="btn" disabled={busy} onClick={() => go({ text: syntheticFastq(20000, 150) }, 'synthetic_demo.fastq')}>Run synthetic demo (20k reads)</button>
          {busy && <><Busy progress={progress} note={note} /><button className="btn sm" onClick={cancel}>Cancel</button></>}
          {error && <Callout kind="err">{error}</Callout>}
          <div className="faint" style={{ fontSize: 11.5 }}>Typical speed 30–100 MB/s of FASTQ text on a laptop. Paired files: run each mate separately.</div>
        </div>
      </Card></div>
      <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Choose a FASTQ or run the demo.</div></Card> : <>
        <div className="cols-4"><Stat label="Reads" value={res.reads.toLocaleString()} hint={res.truncated ? 'analysis stopped at the read limit' : undefined} /><Stat label="Mean length" value={fmt(res.meanLen, 1)} /><Stat label="GC" value={`${fmt(res.gc * 100, 1)}%`} /><Stat label="≥ Q30 bases" value={`${fmt(res.q30 * 100, 1)}%`} /></div>
        {res.truncated && <Callout>Stopped after {res.reads.toLocaleString()} reads (your limit). Choose "All reads" for the full file.</Callout>}
        <div className="cols-4"><Stat label="Bases" value={res.bases.toLocaleString()} /><Stat label="≥ Q20" value={`${fmt(res.q20 * 100, 1)}%`} /><Stat label="N bases" value={`${fmt(res.nFrac * 100, 3)}%`} /><Stat label="Duplicates*" value={`${fmt(res.dupRate * 100, 1)}%`} hint={`estimated on first ${res.dupSampled.toLocaleString()} reads by 50-bp prefix`} /></div>
        <Card title="Per-position base quality" sub={`${name} · line = mean, bands = IQR and 10–90%`}><MultiLine xs={q.map((p) => p.pos)} yMin={0} yMax={42} xLabel="Position in read (bp)" yLabel="Phred quality" series={[{ name: '10–90%', ys: q.map((p) => p.q50), color: cssVar('--chart-c'), band: [q.map((p) => p.q10), q.map((p) => p.q90)] }, { name: 'IQR', ys: q.map((p) => p.q50), color: cssVar('--chart-a'), band: [q.map((p) => p.q25), q.map((p) => p.q75)] }, { name: 'mean', ys: q.map((p) => p.mean), color: cssVar('--chart-d') }]} /></Card>
        <div className="cols-2">
          <Card title="Per-read mean quality">{(() => { const r = rebin(res.readQ, 42, (i) => `Q${i}`); return <BarChart labels={r.labels.map((l, i) => (i % 6 ? '' : l))} values={r.values} colors={[cssVar('--chart-a')]} yLabel="Reads" />; })()}</Card>
          <Card title="GC content per read">{(() => { const r = rebin(res.gcHist, 25, (i) => `${i}%`); return <BarChart labels={r.labels} values={r.values} colors={[cssVar('--chart-c')]} yLabel="Reads" />; })()}</Card>
          <Card title="Read length">{(() => { const arr = Array.from({ length: res.maxLen + 1 }, () => 0); res.lens.forEach(([l, c]) => { arr[l] = c; }); const r = rebin(arr.slice(res.minLen), 24, (i) => String(res.minLen + i)); return <BarChart labels={r.labels} values={r.values} colors={[cssVar('--chart-b')]} yLabel="Reads" />; })()}</Card>
          <Card title="Base composition by position"><MultiLine xs={res.comp.map((c) => c.pos)} yMin={0} yMax={1} xLabel="Position (bp)" yLabel="Fraction" series={(['A', 'C', 'G', 'T', 'N'] as const).map((b, i) => ({ name: b, ys: res.comp.map((c) => c[b]), color: [cssVar('--accent-3'), cssVar('--chart-a'), cssVar('--chart-d'), cssVar('--chart-b'), cssVar('--text-faint')][i] }))} /></Card>
        </div>
        <div className="cols-2">
          <Card title="Adapter content" sub="reads containing the adapter k-mer"><div style={{ display: 'grid', gap: 10 }}>{res.adapters.map((a) => <div key={a.name}><div className="row" style={{ justifyContent: 'space-between' }}><span>{a.name}</span><b className="mono" style={{ color: a.frac > 0.05 ? 'var(--warn)' : 'var(--accent-3)' }}>{fmt(a.frac * 100, 2)}%</b></div><div className="progress"><i style={{ width: `${Math.min(100, a.frac * 1000)}%` }} /></div></div>)}{res.adapters.some((a) => a.frac > 0.05) && <Callout kind="warn">Adapter read-through above 5%: trim with fastp/cutadapt before alignment.</Callout>}</div></Card>
          <Card title="3′ quality trimming preview" sub="bases kept"><div style={{ display: 'grid', gap: 10 }}>{res.trim.map((t) => <div key={t.q}><div className="row" style={{ justifyContent: 'space-between' }}><span>trim to Q{t.q}</span><b className="mono">{fmt(t.kept * 100, 1)}% kept</b></div><div className="progress"><i style={{ width: `${t.kept * 100}%` }} /></div></div>)}</div></Card>
        </div>
      </>}</div></div>
  );
}

function Assembly() {
  const { run, busy, error } = useRunner(); const [text, setText] = useState(''); const [res, setRes] = useState<Awaited<ReturnType<GenomeKernels['assembly']>> | null>(null);
  const go = (t: string) => { setText(t); void run({ label: 'Assembly statistics', tool: TOOLS.asm, params: {}, inputs: [{ name: 'assembly', data: t }], run: () => remote.assembly({ text: t }) }).then((r) => r && setRes(r)); };
  return (
    <div className="split"><div className="stack"><Card title="Assembly FASTA"><div className="stack" style={{ gap: 10 }}><FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t) => go(t)} label="Drop contigs / scaffolds FASTA" /><button className="btn" onClick={() => go(syntheticAssembly())} disabled={busy}>Demo: 60 synthetic contigs</button>{error && <Callout kind="err">{error}</Callout>}{text && <button className="btn ghost sm" onClick={() => { setText(''); setRes(null); }}>Clear</button>}</div></Card>
      <Callout>Contiguity only. Completeness (BUSCO-style gene sets) needs lineage datasets and a protein aligner; it is on the roadmap as a cloud job.</Callout></div>
      <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Drop an assembly FASTA to see N50, L50, GC and length distributions.</div></Card> : <>
        <div className="cols-4"><Stat label="Contigs" value={res.contigs} /><Stat label="Total (bp)" value={res.total.toLocaleString()} /><Stat label="N50" value={res.n50.toLocaleString()} /><Stat label="L50" value={res.l50} /></div>
        <div className="cols-4"><Stat label="Longest" value={res.longest.toLocaleString()} /><Stat label="N90" value={res.n90.toLocaleString()} /><Stat label="GC" value={`${fmt(res.gc * 100, 2)}%`} /><Stat label="Ns" value={`${fmt(res.nFrac * 100, 3)}%`} /></div>
        <div className="cols-2"><Card title="Nx curve" sub="contig length at which x% of the assembly is covered"><LineChart xs={res.nx.map((n) => n.x)} ys={res.nx.map((n) => n.len)} xLabel="x (%)" yLabel="Nx length (bp)" yMin={0} /></Card><Card title="Contig lengths" sub="log10 bp"><Histogram values={res.lengths.map((l) => Math.log10(l))} label="log10(contig length)" bins={20} /></Card></div>
        <Card title="Contigs" pad={false} actions={<button className="btn sm" onClick={() => downloadText('contigs.csv', toCsv(res.contigTable), 'text/csv')}>CSV</button>}><DataTable rows={res.contigTable} rowKey={(r) => r.id} cols={[{ key: 'id', label: 'Contig', sort: (r) => r.id }, { key: 'length', label: 'Length', num: true, sort: (r) => r.length, render: (r) => r.length.toLocaleString() }, { key: 'gc', label: 'GC %', num: true, sort: (r) => r.gc, render: (r) => fmt(r.gc * 100, 1) }, { key: 'ns', label: 'Ns', num: true, sort: (r) => r.ns }]} /></Card>
      </>}</div></div>
  );
}

function Intervals() {
  const { run, busy, error } = useRunner(), g = useRunner();
  const [a, setA] = useState(''), [b, setB] = useState(''), [op, setOp] = useState<'intersect' | 'subtract' | 'merge' | 'closest'>('intersect'), [gap, setGap] = useState(0);
  const [res, setRes] = useState<Awaited<ReturnType<GenomeKernels['intervals']>> | null>(null), [gff, setGff] = useState<Awaited<ReturnType<GenomeKernels['gff']>> | null>(null);
  const go = () => void run({ label: `Intervals · ${op}`, tool: TOOLS.iv, params: { op, gap }, inputs: [{ name: 'A', data: a }, { name: 'B', data: b }], run: () => remote.intervals({ a, b, op, gap }) }).then((r) => r && setRes(r));
  return (
    <div className="stack">
      <div className="cols-2">
        <Card title="Set A (BED)"><textarea className="input" value={a} onChange={(e) => setA(e.target.value)} spellCheck={false} placeholder="chr1	100	500	peak1" /><div style={{ marginTop: 8 }} className="row"><FileDrop onText={(t) => setA(t)} label="Drop BED" /></div></Card>
        <Card title="Set B (BED)"><textarea className="input" value={b} onChange={(e) => setB(e.target.value)} spellCheck={false} placeholder="chr1	300	900	gene1" /><div style={{ marginTop: 8 }}><FileDrop onText={(t) => setB(t)} label="Drop BED" /></div></Card>
      </div>
      <div className="row"><button className="btn" onClick={() => { setA(syntheticBed(21, 400)); setB(syntheticBed(22, 250, 300)); }}>Load demo peaks & features</button>
        <select className="select" style={{ width: 200 }} value={op} onChange={(e) => setOp(e.target.value as typeof op)}><option value="intersect">A ∩ B (intersect)</option><option value="subtract">A − B (subtract)</option><option value="merge">Merge A</option><option value="closest">Closest B to each A</option></select>
        {op === 'merge' && <Field label="max gap (bp)"><input className="input" type="number" style={{ width: 100 }} value={gap} onChange={(e) => setGap(+e.target.value)} /></Field>}
        <button className="btn primary" disabled={!a.trim() || busy} onClick={go}>Run</button></div>
      {error && <Callout kind="err">{error}</Callout>}
      {res && <><div className="cols-4"><Stat label="A intervals" value={res.stats.nA} /><Stat label="B intervals" value={res.stats.nB} /><Stat label="Result" value={res.rows.length} /><Stat label="Jaccard A,B" value={res.stats.nB ? fmt(res.stats.jaccard, 4) : '–'} /></div>
        <Card title="Result" sub={`${res.stats.bpOut.toLocaleString()} bp`} pad={false} actions={<button className="btn sm" onClick={() => downloadText('result.bed', res.rows.map((r) => [r.chrom, r.start, r.end, r.name, r.extra ?? ''].join('\t')).join('\n') + '\n')}>Export BED</button>}><DataTable rows={res.rows} rowKey={(_, i) => String(i)} cols={[{ key: 'chrom', label: 'Chrom', sort: (r) => r.chrom }, { key: 'start', label: 'Start', num: true, sort: (r) => r.start }, { key: 'end', label: 'End', num: true, sort: (r) => r.end }, { key: 'name', label: 'Name' }, ...(op === 'closest' ? [{ key: 'extra', label: 'Closest B' }] : [])]} /></Card></>}
      <Card title="Annotation summary (GFF3 / GTF)"><div className="stack" style={{ gap: 10 }}><FileDrop accept=".gff,.gff3,.gtf,.txt" onText={(t) => void g.run({ label: 'GFF summary', tool: TOOLS.gff, params: {}, inputs: [{ name: 'gff', data: t }], run: () => remote.gff({ text: t }) }).then((r) => r && setGff(r))} label="Drop a GFF3 / GTF file" />{g.error && <Callout kind="err">{g.error}</Callout>}{gff && <DataTable rows={gff.types} rowKey={(r) => r.type} cols={[{ key: 'type', label: 'Feature', sort: (r) => r.type }, { key: 'n', label: 'Count', num: true, sort: (r) => r.n }, { key: 'bp', label: 'Total bp', num: true, sort: (r) => r.bp, render: (r) => r.bp.toLocaleString() }]} />}</div></Card>
    </div>
  );
}

function Compare() {
  const { run, busy, progress, note, error } = useRunner(); const [text, setText] = useState(''), [kk, setK] = useState(16), [size, setSize] = useState(2000);
  const [res, setRes] = useState<Awaited<ReturnType<GenomeKernels['compare']>> | null>(null);
  const go = (t: string) => { setText(t); void run({ label: 'MinHash ANI', tool: TOOLS.cmp, params: { k: kk, size }, inputs: [{ name: 'genomes', data: t.length > 5e6 ? t.slice(0, 5e6) : t }], run: (h) => remote.compare({ text: t, k: kk, size }, h) }).then((r) => r && setRes(r)); };
  const tree = useMemo(() => (res ? parseNewick(res.newick) : null), [res]);
  return (
    <div className="split"><div className="stack"><Card title="Genomes" sub="multi-FASTA, one record per genome"><div className="stack" style={{ gap: 10 }}>
      <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t) => go(t)} label="Drop multi-FASTA of genomes" />
      <button className="btn" disabled={busy} onClick={() => go(syntheticGenomes(5, 120000).map((g) => `>${g.id}\n${g.seq}`).join('\n'))}>Demo: 5 synthetic genomes (1/5/10% diverged)</button>
      <div className="cols-2" style={{ gap: 8 }}><Field label="k-mer"><select className="select" value={kk} onChange={(e) => setK(+e.target.value)}>{[12, 14, 16].map((v) => <option key={v}>{v}</option>)}</select></Field><Field label="Sketch size"><select className="select" value={size} onChange={(e) => setSize(+e.target.value)}>{[500, 1000, 2000, 5000].map((v) => <option key={v}>{v}</option>)}</select></Field></div>
      {text && <button className="btn sm" disabled={busy} onClick={() => go(text)}>Re-run with these settings</button>}{busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
    </div></Card><Callout>Mash-style bottom sketches estimate ANI to about ±1% for related genomes above ~80% identity. For taxonomy-grade ANI, confirm with fastANI or skani.</Callout></div>
      <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Provide two or more genomes to estimate average nucleotide identity.</div></Card> : <>
        <Card title="Estimated ANI" sub="≈ 1 − Mash distance"><MatrixHeat labels={res.names} m={res.ani} min={0.8} max={1} fmt={(v) => `${(v * 100).toFixed(1)}`} cell={res.names.length > 10 ? 28 : 46} /></Card>
        {tree && <Card title="UPGMA tree from Mash distance"><TreeView tree={tree} /></Card>}</>}</div></div>
  );
}
