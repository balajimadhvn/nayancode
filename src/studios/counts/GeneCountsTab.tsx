import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRemote } from '@/compute/rpc';
import { useHandoff } from '@/core/handoff';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, type Col } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { tpmFromCounts, type Strandedness } from './count';
import type { CountOut, CountsKernels, CountSampleArg } from './counts.worker';
import type { GffGene } from './gff';
import { useManifest } from '../genome/GenomePicker';
import { loadBundledText } from '../genome/genomeData';
import { runTool } from '../genome/wasmTools';
import type { AlignmentHand } from './CountsStudio';

const remote = createRemote<CountsKernels>(() => new Worker(new URL('./counts.worker.ts', import.meta.url), { type: 'module' }));
const dec = new TextDecoder();
const clean = (s: string) => s.replace(/\.(sam|bam)$/i, '').replace(/[^\w.-]+/g, '_');
interface Row { g: GffGene; i: number }
const TOOL: ToolInfo = {
  id: 'counts.genes', name: 'Gene-level read counting', version: '0.1.0', engine: 'TypeScript worker (interval index, featureCounts-style unique assignment, TPM)',
  citations: ['liao2014', 'danecek2021'],
  describe: (p) => `Reads were assigned to genes with featureCounts-style unique assignment (strandedness ${p.stranded}, minimum MAPQ ${p.minMapq}, minimum overlap ${p.minOverlap} bp); overlapping genes were counted as ambiguous and TPM was computed from the merged exon-union length.`,
};
const summaryCells = (r: { assigned: number; ambiguous: number; noFeature: number; lowMapq: number; unmapped: number }) =>
  [{ k: 'assigned', v: r.assigned, c: 'var(--accent)' }, { k: 'ambiguous', v: r.ambiguous, c: 'var(--warn)' }, { k: 'no feature', v: r.noFeature, c: 'var(--border-hi)' }, { k: 'low MAPQ', v: r.lowMapq, c: 'var(--accent-2)' }, { k: 'unmapped', v: r.unmapped, c: 'var(--danger)' }];

function SummaryBar({ r }: { r: { assigned: number; ambiguous: number; noFeature: number; lowMapq: number; unmapped: number } }) {
  const cells = summaryCells(r), total = Math.max(1, cells.reduce((a, x) => a + x.v, 0));
  return <div>
    <div style={{ display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden', background: 'var(--border)' }}>{cells.map((x) => x.v > 0 && <div key={x.k} title={`${x.k}: ${x.v.toLocaleString()}`} style={{ width: `${(100 * x.v) / total}%`, background: x.c }} />)}</div>
    <div className="row" style={{ gap: 12, marginTop: 6, fontSize: 11.5 }}>{cells.map((x) => <span key={x.k} className="faint"><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: x.c, marginRight: 4 }} />{x.k} {x.v.toLocaleString()}</span>)}</div>
  </div>;
}

export default function GeneCountsTab({ alignment }: { alignment: AlignmentHand | null }) {
  const { run, busy, progress, note, error, cancel } = useRunner();
  const setExpr = useHandoff((s) => s.setExpr), nav = useNavigate();
  const { manifest } = useManifest();
  const [annotation, setAnnotation] = useState(''), [annName, setAnnName] = useState('');
  const [stranded, setStranded] = useState<Strandedness>('none'), [minMapq, setMinMapq] = useState(10), [minOverlap, setMinOverlap] = useState(1);
  const [files, setFiles] = useState<File[]>([]), [useAligned, setUseAligned] = useState(true);
  const [res, setRes] = useState<CountOut | null>(null), [loadingAnn, setLoadingAnn] = useState(false), [annErr, setAnnErr] = useState(''), [demoSamples, setDemoSamples] = useState<CountSampleArg[]>([]);

  const genes = res?.genes ?? [];
  const tpmCols = useMemo(() => (res ? res.samples.map((s) => tpmFromCounts(s.counts, res.genes.map((g) => g.length))) : []), [res]);
  const sampleNames = res?.samples.map((s) => s.name) ?? [];
  const matrix = () => res ? ['gene,' + sampleNames.join(','), ...res.genes.map((g, i) => `${g.id},${res.samples.map((s) => s.counts[i]).join(',')}`)].join('\n') : '';
  const tpmCsv = () => res ? ['gene,' + sampleNames.join(','), ...res.genes.map((g, i) => `${g.id},${res.samples.map((_, j) => tpmCols[j][i].toFixed(3)).join(',')}`)].join('\n') : '';
  const sheet = () => ['sample,group', ...sampleNames.map((n) => `${n},all`)].join('\n');
  const csvCell = (s: string) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const matrixCsv = () => res ? ['gene,' + sampleNames.map(csvCell).join(','), ...res.genes.map((g, i) => [`"${g.id}"`, ...res.samples.map((s) => s.counts[i])].join(','))].join('\n') : '';

  const loadBundledGff = async (id: string) => {
    if (!id) return; setLoadingAnn(true); setAnnErr('');
    try { const t = await loadBundledText(id, 'gff'); setAnnotation(t); const g = manifest?.genomes.find((x) => x.id === id); setAnnName(g ? `${g.name} (RefSeq GFF3)` : 'bundled annotation'); setRes(null); setDemoSamples([]); }
    catch (e) { setAnnErr((e as Error).message); } finally { setLoadingAnn(false); }
  };

  const samOf = async (f: File): Promise<string> => {
    if (!/\.bam$/i.test(f.name)) return f.text();
    const bytes = new Uint8Array(await f.arrayBuffer());
    const v = await runTool('samtools', ['view', '-h', '/in.bam', '-o', '/in.sam'], { 'in.bam': bytes }, ['in.sam']);
    if (!v.out['in.sam']) throw new Error(`samtools view failed for ${f.name}: ${v.stderr.slice(-160)}`);
    return dec.decode(v.out['in.sam']);
  };

  const runCount = (samples: CountSampleArg[], ann: string, strand: Strandedness) => void run({
    label: `Gene counts · ${samples.length} sample${samples.length === 1 ? '' : 's'}`, tool: TOOL,
    params: { stranded: strand, minMapq, minOverlap, samples: samples.length },
    inputs: [{ name: 'annotation', data: ann.slice(0, 200000) }, { name: 'samples', data: samples.map((s) => `${s.name}:${s.sam.length}`).join(', ') }],
    run: async (h) => {
      h.onProgress(0.1, 'Parsing annotation and counting reads');
      const out = await remote.countSam({ annotation: ann, samples, stranded: strand, minMapq, minOverlap, skipDuplicates: false }, { signal: h.signal, onProgress: (p, n) => h.onProgress(0.1 + 0.9 * p, n) });
      return out;
    },
    summary: (r) => `Reads from ${r.samples.length} sample${r.samples.length === 1 ? '' : 's'} were assigned to ${r.genes.length} genes with featureCounts-style unique assignment (strandedness ${strand}, MAPQ ≥ ${minMapq}, overlap ≥ ${minOverlap} bp); ${r.samples.map((s) => `${s.name}: ${s.assigned.toLocaleString()} assigned, ${s.ambiguous.toLocaleString()} ambiguous`).join('; ')}.`,
  }).then((r) => { if (r) setRes(r); });

  const go = () => {
    if (!annotation) { alert('Load a GFF3/GTF annotation first.'); return; }
    const samples: CountSampleArg[] = [];
    if (demoSamples.length && !files.length) samples.push(...demoSamples);
    if (useAligned && alignment) samples.push({ name: clean(alignment.label), sam: alignment.sam });
    if (!files.length && !samples.length) { alert('Choose at least one SAM/BAM file or use the alignment from the Align tab.'); return; }
    if (!files.length) { runCount(samples, annotation, stranded); return; }
    void run({ label: 'Reading alignments', tool: TOOL, params: { stranded, minMapq, minOverlap, samples: files.length + samples.length }, inputs: [{ name: 'annotation', data: annotation.slice(0, 200000) }], run: async (h) => {
      const list = [...samples];
      for (let i = 0; i < files.length; i++) {
        h.onProgress((i + 0.2) / (files.length + 1), `Reading ${files[i].name}`);
        list.push({ name: clean(files[i].name), sam: await samOf(files[i]) });
      }
      return list;
    } }).then((list) => { if (list) runCount(list, annotation, stranded); });
  };

  const demo = () => void remote.demoCounts({ seed: 11 }).then((d) => {
    setAnnotation(d.annotation); setAnnName('SYNTHETIC · 20 genes on 100 kb, 2 samples'); setStranded('reverse'); setUseAligned(false); setFiles([]); setRes(null); setDemoSamples(d.samples);
    runCount(d.samples, d.annotation, 'reverse');
  }).catch((e: Error) => alert(e.message));

  const rows: Row[] = res ? res.genes.map((g, i) => ({ g, i })) : [];
  const countCols: Col<Row>[] = res ? res.samples.map((s, j) => ({ key: `c${j}`, label: s.name, num: true, sort: (r) => s.counts[r.i], render: (r) => s.counts[r.i].toLocaleString() })) : [];
  const tpmTableCols: Col<Row>[] = res ? res.samples.map((s, j) => ({ key: `t${j}`, label: s.name, num: true, sort: (r) => tpmCols[j][r.i], render: (r) => fmt(tpmCols[j][r.i], 1) })) : [];

  return <div className="split"><div className="stack">
    <Card title="Annotation & alignments" sub="GFF3/GTF + SAM/BAM, counted in your browser">
      <div className="stack" style={{ gap: 10 }}>
        <Field label="Bundled annotation (RefSeq GFF3)"><select className="select" defaultValue="" disabled={loadingAnn} onChange={(e) => void loadBundledGff(e.target.value)} aria-label="Bundled annotation"><option value="">Choose, or upload a GFF/GTF below…</option>{manifest?.genomes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        {annErr && <Callout kind="err">{annErr}</Callout>}
        <FileDrop accept=".gff,.gff3,.gtf,.txt" onText={(t, n) => { setAnnotation(t); setAnnName(n); setRes(null); setDemoSamples([]); }} label={annName ? `Annotation: ${annName}` : 'Annotation GFF3 or GTF (exon union defines gene length)'} />
        <div className="cols-3" style={{ gap: 8 }}>
          <Field label="Strandedness"><select className="select" value={stranded} onChange={(e) => setStranded(e.target.value as Strandedness)}><option value="none">None (unstranded)</option><option value="forward">Forward (read same strand)</option><option value="reverse">Reverse (read opposite strand)</option></select></Field>
          <Field label="Minimum MAPQ"><input className="input" type="number" min={0} max={60} value={minMapq} onChange={(e) => setMinMapq(Math.max(0, +e.target.value))} /></Field>
          <Field label="Minimum overlap (bp)"><input className="input" type="number" min={1} value={minOverlap} onChange={(e) => setMinOverlap(Math.max(1, +e.target.value))} /></Field>
        </div>
        <label className="dropzone"><input type="file" multiple hidden accept=".sam,.bam" onChange={(e) => { setFiles([...(e.target.files ?? [])]); setDemoSamples([]); }} />{files.length ? `${files.length} alignment file${files.length > 1 ? 's' : ''} (one sample each)` : 'SAM/BAM files, one per sample (≤ 500 MB each)'}<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>BAM is converted with samtools in your browser. Never uploaded.</div></label>
        {alignment && <label className="row" style={{ gap: 6, fontSize: 12 }}><input type="checkbox" checked={useAligned} onChange={(e) => setUseAligned(e.target.checked)} />Use “{alignment.label}” from the Align tab as a sample</label>}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><button className="btn primary" disabled={busy} onClick={go}>Count reads per gene</button><button className="btn" disabled={busy} onClick={demo}>Load SYNTHETIC demo (20 genes, 100 kb)</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
        {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
      </div>
    </Card>
    <Callout>Reads are counted once, on read 1 for paired-end data. A read that overlaps more than one gene after the strandedness rule is reported as ambiguous, never split. Gene length is the merged exon union, as used for TPM. Annotation and alignments stay in this browser tab; large BAM files are limited by browser memory. Research use only.</Callout>
  </div>
  <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load an annotation and alignments (or the SYNTHETIC demo), then count.</div></Card> : <>
    <div className="cols-4"><Stat label="Genes" value={genes.length.toLocaleString()} /><Stat label="Samples" value={sampleNames.length} /><Stat label="Assigned reads" value={res.samples.reduce((a, s) => a + s.assigned, 0).toLocaleString()} /><Stat label="Ambiguous reads" value={res.samples.reduce((a, s) => a + s.ambiguous, 0).toLocaleString()} /></div>
    <Card title="Assignment summary" sub="per sample">
      {res.samples.map((s) => <div key={s.name} style={{ marginBottom: 10 }}><div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>{s.name}</div><SummaryBar r={s} /></div>)}
    </Card>
    <Card title="Counts" sub="merged exon union · one row per gene" pad={false} actions={<><button className="btn sm" onClick={() => downloadText('gene_counts.csv', matrixCsv(), 'text/csv')}>CSV</button><button className="btn sm" onClick={() => downloadText('gene_tpm.csv', tpmCsv(), 'text/csv')}>TPM CSV</button><button className="btn sm" disabled={sampleNames.length < 2} title={sampleNames.length < 2 ? 'The Expression Studio needs at least two sample columns' : 'Open the count matrix in the Expression Studio'} onClick={() => { setExpr({ counts: matrix(), sheet: sheet(), label: `Gene counts: ${genes.length} genes × ${sampleNames.length} sample${sampleNames.length === 1 ? '' : 's'}` }); nav('/expression'); }}>Send to Expression Studio</button></>}>
      <DataTable rows={rows} rowKey={(r) => r.g.id} cols={[{ key: 'name', label: 'Gene', sort: (r) => r.g.name, render: (r) => <span title={r.g.id}>{r.g.name}</span> }, { key: 'id', label: 'ID' }, { key: 'len', label: 'Length (bp)', num: true, sort: (r) => r.g.length, render: (r) => r.g.length.toLocaleString() }, ...countCols]} />
      {sampleNames.length < 2 && <div className="faint" style={{ padding: '8px 12px', fontSize: 12 }}>Add a second sample to send this matrix to the Expression Studio; it requires at least two sample columns.</div>}
    </Card>
    <Card title="TPM" sub="transcripts per million from merged exon-union length" pad={false}><DataTable rows={rows} rowKey={(r) => r.g.id} cols={[{ key: 'name', label: 'Gene', render: (r) => r.g.name }, ...tpmTableCols]} /></Card>
  </>}</div></div>;
}
