import { useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { createRemote } from '@/compute/rpc';
import { Busy, Callout, Card, Field, Stat, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { openSink, readFastq, readPairs, writeFastqChunks, type FastqRecord } from './fastq';
import { processRecord, type AdapterPreset, type TrimOpts } from './trim';
import type { ReadsKernels, TrimRunResult } from './reads.worker';
import type { ReadsSource } from './ReadsStudio';

const remote = createRemote<ReadsKernels>(() => new Worker(new URL('./reads.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = {
  id: 'reads.trim', name: 'FASTQ trimming and filtering', version: '0.1.0', engine: 'TypeScript streaming worker kernels',
  citations: ['martin2011', 'chen2018'],
  describe: (p) => `Reads were trimmed with ${p.adapter === 'none' ? 'no adapter' : `the ${p.adapter} adapter`}, poly-G${p.polyG ? '' : ' (off)'}, a 3' quality cutoff of ${p.qualityCutoff}, then filtered by length, N content, mean quality and expected errors`,
};

async function* trimmed(src: ReadsSource, p: TrimOpts, mate: 'single' | 'r1' | 'r2'): AsyncGenerator<FastqRecord> {
  if (src.demo) {
    for (const r of src.demo) { const o = processRecord(r, p); if (o.rec) yield o.rec; }
    return;
  }
  if (src.files.length === 2) {
    for await (const [r1, r2] of readPairs(src.files[0], src.files[1])) {
      const a = processRecord(r1, p), b = processRecord(r2, p);
      if (a.rec && b.rec) yield mate === 'r2' ? b.rec : a.rec;
    }
    return;
  }
  if (src.files[0]) for await (const r of readFastq(src.files[0])) { const o = processRecord(r, p); if (o.rec) yield o.rec; }
}

const inputCls = 'input';
export default function TrimTab({ src }: { src: ReadsSource }) {
  const paired = src.files.length === 2;
  const [preset, setPreset] = useState<AdapterPreset>('truseq'), [custom, setCustom] = useState('');
  const [qualityCutoff, setQualityCutoff] = useState(20), [polyG, setPolyG] = useState(true);
  const [minLen, setMinLen] = useState(30), [maxN, setMaxN] = useState(5), [minMeanQ, setMinMeanQ] = useState(0), [maxEE, setMaxEE] = useState(2);
  const [result, setResult] = useState<TrimRunResult | null>(null);
  const [saving, setSaving] = useState<string | null>(null), [saveErr, setSaveErr] = useState<string | null>(null);
  const { run, busy, progress, note, error } = useRunner();
  const opts: TrimOpts = { adapterPreset: preset, adapter: preset === 'custom' ? custom.toUpperCase().replace(/[^ACGTN]/g, '') : undefined, qualityCutoff, polyG, minLen, maxN, minMeanQ, maxExpectedErrors: maxEE };
  const go = () => void run({
    label: `Trim & filter · ${src.label}`, tool: TOOL, params: { adapter: preset, qualityCutoff, polyG, minLen, maxN, minMeanQ, maxEE },
    inputs: [{ name: src.label, data: src.label }],
    run: (h) => remote.trim({ file: src.files[0], file2: src.files[1], demo: src.demo ?? undefined, params: opts }, { onProgress: h.onProgress }),
  }).then((r) => { if (r) setResult(r); });
  const save = async (gzip: boolean, mate: 'single' | 'r1' | 'r2') => {
    setSaveErr(null); setSaving(gzip ? 'gz' : 'plain');
    try {
      const base = (src.files[0]?.name ?? 'synthetic_demo.fastq').replace(/\.(fastq|fq)(\.gz)?$/i, '');
      const suffix = mate === 'single' ? '' : `_${mate.toUpperCase()}`;
      const sink = await openSink(`${base}.trimmed${suffix}.fastq${gzip ? '.gz' : ''}`, { gzip });
      await writeFastqChunks(trimmed(src, opts, mate), sink); await sink.close();
    } catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); } finally { setSaving(null); }
  };
  return (
    <>
      <Card title="Trim & filter" sub={paired ? 'A pair is kept only when both mates pass; orphans are dropped (documented).' : 'Adapter, poly-G and quality trimming, then the filters.'}>
        <div className="cols-2" style={{ gap: 10 }}>
          <Field label="Adapter"><select className="select" value={preset} onChange={(e) => setPreset(e.target.value as AdapterPreset)}><option value="truseq">TruSeq (AGATCGGAAGAGC)</option><option value="nextera">Nextera (CTGTCTCTTATACACATCT)</option><option value="smallrna">Small RNA</option><option value="custom">Custom</option><option value="none">None</option></select></Field>
          {preset === 'custom' && <Field label="Custom adapter"><input className={inputCls} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="ACGT…" /></Field>}
          <Field label="3' quality cutoff"><input className="input" type="number" value={qualityCutoff} onChange={(e) => setQualityCutoff(+e.target.value)} /></Field>
          <Field label="Min length"><input className="input" type="number" value={minLen} onChange={(e) => setMinLen(+e.target.value)} /></Field>
          <Field label="Max N"><input className="input" type="number" value={maxN} onChange={(e) => setMaxN(+e.target.value)} /></Field>
          <Field label="Min mean Q"><input className="input" type="number" value={minMeanQ} onChange={(e) => setMinMeanQ(+e.target.value)} /></Field>
          <Field label="Max expected errors"><input className="input" type="number" step={0.1} value={maxEE} onChange={(e) => setMaxEE(+e.target.value)} /></Field>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={polyG} onChange={(e) => setPolyG(e.target.checked)} />Trim 3' poly-G runs (≥10)</label>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy} onClick={go}>Run</button>{busy && <span className="faint">{note}</span>}</div>
        {busy && <div style={{ marginTop: 10 }}><Busy progress={progress} note={note} /></div>}
        {error && <Callout kind="err">{error}</Callout>}
      </Card>
      {result && (
        <Card title="Result" sub={result.paired ? 'Counts are pairs; a pair passes only if both mates pass.' : 'Counts are reads.'}>
          <div className="cols-4">
            <Stat label={result.paired ? 'Pairs kept' : 'Reads kept'} value={`${result.counters.kept.toLocaleString()} (${fmt(result.counters.in ? (100 * result.counters.kept) / result.counters.in : 0, 1)}%)`} />
            <Stat label="Input" value={result.counters.in.toLocaleString()} />
            <Stat label="Before mean length" value={`${fmt(result.before.meanLength, 1)} bp`} />
            <Stat label="After mean length" value={`${fmt(result.after.meanLength, 1)} bp`} />
          </div>
          <div className="faint" style={{ marginTop: 10, fontSize: 12 }}>Removed: too short {result.counters.too_short.toLocaleString()} · too many N {result.counters.too_many_n.toLocaleString()} · low mean Q {result.counters.low_mean_q.toLocaleString()} · too many expected errors {result.counters.too_many_errors.toLocaleString()}.</div>
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn" disabled={!!saving} onClick={() => void save(false, paired ? 'r1' : 'single')}>{saving === 'plain' ? 'Saving…' : paired ? 'Save trimmed R1' : 'Save FASTQ'}</button>
            <button className="btn" disabled={!!saving} onClick={() => void save(true, paired ? 'r1' : 'single')}>{saving === 'gz' ? 'Saving…' : paired ? 'Save gzipped R1' : 'Save gzipped FASTQ'}</button>
            {paired && <button className="btn" disabled={!!saving} onClick={() => void save(false, 'r2')}>Save trimmed R2</button>}
            {paired && <button className="btn" disabled={!!saving} onClick={() => void save(true, 'r2')}>Save gzipped R2</button>}
          </div>
          {saveErr && <div style={{ marginTop: 10 }}><Callout kind="err">{saveErr}</Callout></div>}
          <div className="faint" style={{ marginTop: 8, fontSize: 11.5 }}>Save-to-disk is offered by Chrome and Edge; other browsers assemble the download in memory.</div>
        </Card>
      )}
    </>
  );
}
