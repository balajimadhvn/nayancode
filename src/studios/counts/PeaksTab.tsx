import { useMemo, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, Stat, downloadText, fmt, sci } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import type { CountsKernels, PeakOut } from './counts.worker';
import { coverageToBedGraph, peaksToBed } from './peaks';
import { runTool } from '../genome/wasmTools';
import type { AlignmentHand } from './CountsStudio';

const remote = createRemote<CountsKernels>(() => new Worker(new URL('./counts.worker.ts', import.meta.url), { type: 'module' }));
const dec = new TextDecoder();
const TOOL: ToolInfo = {
  id: 'counts.peaks', name: 'MACS-style peak calling', version: '0.1.0', engine: 'TypeScript worker (cross-correlation fragment size, local Poisson lambda, Benjamini-Hochberg FDR)',
  citations: ['zhang2008', 'danecek2021'],
  describe: (p) => `Fragments were extended to ${p.d} bp, binned at 10 bp, and scored against a local Poisson rate (1, 5 and 10 kb windows; control scaled to treatment depth). Bins with a Benjamini-Hochberg q ≤ ${p.q} were merged across gaps ≤ 50 bp and regions ≥ 200 bp were reported as narrowPeak-style BED.`,
};
const asInt = (n: number) => Math.max(1, Math.round(n));

export default function PeaksTab({ alignment }: { alignment: AlignmentHand | null }) {
  const { run, busy, progress, note, error, cancel } = useRunner();
  const [treatment, setTreatment] = useState<File | null>(null), [control, setControl] = useState<File | null>(null);
  const [useAligned, setUseAligned] = useState(true), [d, setD] = useState<'auto' | string>('auto'), [q, setQ] = useState('0.01'), [assay, setAssay] = useState<'chip' | 'atac'>('chip');
  const [res, setRes] = useState<PeakOut | null>(null), [sel, setSel] = useState(0), [demo, setDemo] = useState(false);

  const samOf = async (f: File): Promise<string> => {
    if (!/\.bam$/i.test(f.name)) return f.text();
    const bytes = new Uint8Array(await f.arrayBuffer());
    const v = await runTool('samtools', ['view', '-h', '/in.bam', '-o', '/in.sam'], { 'in.bam': bytes }, ['in.sam']);
    if (!v.out['in.sam']) throw new Error(`samtools view failed for ${f.name}: ${v.stderr.slice(-160)}`);
    return dec.decode(v.out['in.sam']);
  };

  const call = (treatSam: string, ctrlSam: string | undefined, dd: number | 'auto', qq: number) => void run({
    label: 'Peak calling', tool: TOOL, params: { d: dd, q: qq, assay, control: !!ctrlSam },
    inputs: [{ name: 'treatment', data: treatSam.slice(0, 200000) }, { name: 'control', data: (ctrlSam ?? '').slice(0, 200000) }],
    run: async (h) => {
      h.onProgress(0.1, 'Binning fragments and computing local lambda');
      const out = await remote.peaksSam({ treatment: treatSam, control: ctrlSam, d: dd, qCutoff: qq, shift: assay === 'atac' ? -100 : 0, extend: assay === 'atac' ? 200 : undefined }, { signal: h.signal, onProgress: (p, n) => h.onProgress(0.1 + 0.9 * p, n) });
      return out;
    },
    summary: (r) => `Peaks were called with a MACS-style local-lambda model: fragment size ${r.d} bp, 10 bp bins, control ${ctrlSam ? 'scaled to treatment depth' : 'not supplied'}, Benjamini-Hochberg q ≤ ${qq}; ${r.peaks.length} region${r.peaks.length === 1 ? '' : 's'} passed the 200 bp minimum.`,
  }).then((r) => { if (r) { setRes(r); setSel(0); setDemo(false); } });

  const go = () => {
    if (demo && !treatment) { void remote.demoPeaks({ seed: 7, qCutoff: +q || 0.01 }).then((r) => { setRes(r); setSel(0); }).catch((e: Error) => alert(e.message)); return; }
    if (!treatment && !(useAligned && alignment)) { alert('Choose a treatment SAM/BAM file, or use the alignment from the Align tab.'); return; }
    void run({ label: 'Reading peak input', tool: TOOL, params: { d, q, assay }, inputs: [{ name: 'input', data: treatment?.name ?? alignment?.label ?? '' }], run: async (h) => {
      let t = treatment ? await samOf(treatment) : '';
      h.onProgress(0.4, 'Reading control');
      if (!t && useAligned && alignment) t = alignment.sam;
      const c = control ? await samOf(control) : undefined;
      return { t, c };
    } }).then((s) => { if (s) call(s.t, s.c, d === 'auto' ? 'auto' : asInt(+d), +q || 0.01); });
  };

  const loadDemo = () => void remote.demoPeaks({ seed: 7, qCutoff: +q || 0.01 }).then((r) => { setRes(r); setSel(0); setDemo(true); setTreatment(null); setControl(null); }).catch((e: Error) => alert(e.message));

  const rows = useMemo(() => (res?.peaks ?? []).map((p, i) => ({ p, i })), [res]);
  const peak = res?.peaks[sel] ?? null;
  const chrom = peak ? res?.chroms.find((c) => c.chrom === peak.chrom) : null;
  const plot = useMemo(() => {
    if (!peak || !chrom) return null;
    const bin = 10, lo = Math.max(0, Math.floor((peak.start - 2000) / bin)), hi = Math.min(chrom.coverage.length, Math.ceil((peak.end + 2000) / bin));
    return { points: Array.from({ length: Math.max(0, hi - lo) }, (_, i) => ({ x: (lo + i) * bin + 5, y: chrom.coverage[lo + i] })), xMin: lo * bin, xMax: hi * bin };
  }, [peak, chrom]);

  const truth = res?.planted ? (() => {
    const hit = res.planted.filter((p) => res.peaks.some((x) => Math.abs(x.summit - p.centre) <= 100)).length;
    return `${hit}/${res.planted.length} planted peaks recovered with a summit within 100 bp; ${res.peaks.length - hit} other region${res.peaks.length - hit === 1 ? '' : 's'}.`;
  })() : null;

  return <div className="split"><div className="stack">
    <Card title="Treatment & control" sub="SAM/BAM, fragment coverage">
      <div className="stack" style={{ gap: 10 }}>
        <label className="dropzone"><input type="file" hidden accept=".sam,.bam" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 500 * 1024 * 1024) { alert('File is larger than 500 MB, the limit for this browser tool.'); return; } setTreatment(f); setDemo(false); setRes(null); }} />{treatment ? `Treatment: ${treatment.name}` : 'Treatment SAM/BAM (ChIP-seq, ATAC-seq or CUT&Tag; ≤ 500 MB)'}<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>BAM is converted with samtools in your browser. Never uploaded.</div></label>
        <label className="dropzone"><input type="file" hidden accept=".sam,.bam" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 500 * 1024 * 1024) { alert('File is larger than 500 MB, the limit for this browser tool.'); return; } setControl(f); }} />{control ? `Control: ${control.name}` : 'Optional control SAM/BAM (input or IgG)'}</label>
        {alignment && <label className="row" style={{ gap: 6, fontSize: 12 }}><input type="checkbox" checked={useAligned} onChange={(e) => setUseAligned(e.target.checked)} />Use “{alignment.label}” from the Align tab as treatment</label>}
        <div className="cols-3" style={{ gap: 8 }}>
          <Field label="Fragment size d"><select className="select" value={d} onChange={(e) => setD(e.target.value)}><option value="auto">Auto (cross-correlation)</option><option value="200">200 bp</option><option value="150">150 bp</option><option value="250">250 bp</option></select></Field>
          <Field label="FDR q cutoff"><input className="input" type="number" step={0.001} min={0.001} max={0.5} value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Assay"><select className="select" value={assay} onChange={(e) => setAssay(e.target.value as typeof assay)}><option value="chip">ChIP / CUT&amp;Tag</option><option value="atac">ATAC (shift -100, extend 200)</option></select></Field>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><button className="btn primary" disabled={busy} onClick={go}>Call peaks</button><button className="btn" disabled={busy} onClick={loadDemo}>Load SYNTHETIC demo (10 Mb, 3 peaks)</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
        {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
      </div>
    </Card>
    <Callout>Peaks are called on contigs up to 50 Mb in this browser (bacteria, viruses, targeted or small eukaryotic data); larger contigs are listed as skipped. Fragment size “auto” uses the plus/minus 5′ cross-correlation, or the median template length for paired data. Local lambda uses 1, 5 and 10 kb windows and a control scaled to treatment depth. Research use only; not clinical.</Callout>
  </div>
  <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load treatment and optional control alignments (or the SYNTHETIC demo), then call peaks.</div></Card> : <>
    <div className="cols-4"><Stat label="Peaks" value={`${res.peaks.length} peaks`} /><Stat label="Fragment size" value={`${res.d} bp`} /><Stat label="Bins" value={(res.chroms.reduce((a, c) => a + c.coverage.length, 0)).toLocaleString()} /><Stat label="Chromosomes" value={res.chroms.length} /></div>
    {truth && <Callout><b style={{ color: 'var(--text)' }}>SYNTHETIC truth:</b> {truth} The demo is simulated data, not a real experiment.</Callout>}
    {res.skipped.length > 0 && <Callout kind="warn">{res.skipped.length} contig{res.skipped.length === 1 ? ' was' : 's were'} skipped because they exceed 50 Mb: {res.skipped.slice(0, 4).map((s) => `${s.chrom} (${(s.length / 1e6).toFixed(1)} Mb)`).join(', ')}{res.skipped.length > 4 ? ' …' : ''}. Count or call peaks on one chromosome at a time, or use MACS on your computer.</Callout>}
    <Card title="Peaks" sub="narrowPeak-style coordinates (0-based, end-exclusive)" pad={false} actions={<><button className="btn sm" onClick={() => downloadText('peaks.narrowPeak', peaksToBed(res.peaks))}>BED</button><button className="btn sm" onClick={() => downloadText('coverage.bedGraph', res.chroms.map((c) => coverageToBedGraph(c.coverage, c.chrom, 10)).join(''))}>bedGraph</button></>}>
      {res.peaks.length === 0 ? <div className="faint" style={{ padding: 18 }}>No region passed q ≤ {q}. Try a larger q, a control, or check that the treatment has mapped reads.</div> : <DataTable rows={rows} rowKey={(r) => `${r.p.chrom}:${r.p.start}:${r.i}`} onRow={(r) => setSel(r.i)} cols={[
        { key: 'chrom', label: 'Contig' }, { key: 'start', label: 'Start', num: true, sort: (r) => r.p.start }, { key: 'end', label: 'End', num: true, render: (r) => r.p.end.toLocaleString() },
        { key: 'fold', label: 'Fold', num: true, sort: (r) => r.p.fold, render: (r) => `${fmt(r.p.fold, 2)}×` }, { key: 'p', label: '−log10 p', num: true, sort: (r) => r.p.p, render: (r) => fmt(-Math.log10(Math.max(r.p.p, 1e-300)), 1) },
        { key: 'q', label: '−log10 q', num: true, sort: (r) => r.p.q, render: (r) => fmt(-Math.log10(Math.max(r.p.q, 1e-300)), 1) }, { key: 's', label: 'Summit', num: true, render: (r) => r.p.summit.toLocaleString() },
      ]} />}
    </Card>
    {peak && plot && <Card title={`Coverage · ${peak.chrom}:${peak.start.toLocaleString()}–${peak.end.toLocaleString()}`} sub="10 bp bins; dashed line marks the summit">
      <CurvePlot height={260} exportName="peak_coverage" spec={{ series: [{ name: 'fragment coverage', color: cssVar('--chart-a'), points: plot.points }], xLabel: 'Position (bp)', yLabel: 'Coverage', xMin: plot.xMin, xMax: plot.xMax, vlines: [{ x: peak.summit, label: 'summit' }] }} />
      <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Fold enrichment {fmt(peak.fold, 2)}×; p = {sci(peak.p)}; q = {sci(peak.q)}.</div>
    </Card>}
  </>}</div></div>;
}
