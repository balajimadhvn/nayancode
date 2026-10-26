import { useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { createRemote } from '@/compute/rpc';
import { Busy, Callout, Card, DataTable, Field, Stat } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { openSink, writeFastqChunks } from './fastq';
import type { ReadsKernels, SubsampleResult, DemuxRun } from './reads.worker';
import type { ReadsSource } from './ReadsStudio';

const remote = createRemote<ReadsKernels>(() => new Worker(new URL('./reads.worker.ts', import.meta.url), { type: 'module' }));
const SUB_TOOL: ToolInfo = { id: 'reads.subsample', name: 'Reservoir subsampling', version: '0.1.0', engine: 'TypeScript streaming worker kernels', citations: [], describe: (p) => `${p.n} reads were drawn by seeded reservoir sampling (Algorithm R, seed ${p.seed})` };
const DEMUX_TOOL: ToolInfo = { id: 'reads.demux', name: 'Barcode demultiplexing', version: '0.1.0', engine: 'TypeScript streaming worker kernels', citations: [], describe: (p) => `Reads were assigned to the unique barcode within ${p.maxMismatch} substitutions at the ${p.where} of the read; ambiguous and unassigned reads were counted separately` };

const EXAMPLE = 'sample,barcode\nsampleA,ACGTACGT\nsampleB,TGCATGCA\nsampleC,GATCAGTC\nsampleD,CTAGCTAG\n';

export default function PairsToolsTab({ src }: { src: ReadsSource }) {
  const [n, setN] = useState(1000), [seed, setSeed] = useState(1);
  const [sub, setSub] = useState<SubsampleResult | null>(null);
  const [barcodes, setBarcodes] = useState(EXAMPLE), [maxMismatch, setMaxMismatch] = useState(1), [where, setWhere] = useState<'start' | 'end'>('start');
  const [demux, setDemux] = useState<DemuxRun | null>(null);
  const [saving, setSaving] = useState(false), [saveErr, setSaveErr] = useState<string | null>(null);
  const { run, busy, progress, note, error } = useRunner();

  const sample = () => void run({
    label: `Subsample · ${src.label}`, tool: SUB_TOOL, params: { n, seed }, inputs: [{ name: src.label, data: src.label }],
    run: (h) => remote.subsample({ file: src.files[0], demo: src.demo ?? undefined, n, seed }, { onProgress: h.onProgress }),
  }).then((r) => { if (r) setSub(r); });
  const demuxGo = () => void run({
    label: `Demultiplex · ${src.label}`, tool: DEMUX_TOOL, params: { maxMismatch, where }, inputs: [{ name: src.label, data: src.label }, { name: 'barcodes', data: barcodes }],
    run: (h) => remote.demux({ file: src.files[0], demo: src.demo ?? undefined, barcodes, maxMismatch, where, maxReads: 500_000 }, { onProgress: h.onProgress }),
  }).then((r) => { if (r) setDemux(r); });
  const saveSub = async () => {
    if (!sub) return; setSaving(true); setSaveErr(null);
    try { const sink = await openSink('subsample.fastq', {}); await writeFastqChunks(sub.sampled, sink); await sink.close(); }
    catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };
  const rows = demux ? Object.entries(demux.counts).map(([sample, count]) => ({ sample, count })) : [];

  return (
    <>
      <Card title="Subsample" sub="Seeded reservoir sampling keeps exactly n reads (or all when fewer); the same seed gives the same sample. For paired files this samples R1 only.">
        <div className="cols-2" style={{ gap: 10 }}>
          <Field label="Reads to keep"><input className="input" type="number" value={n} onChange={(e) => setN(+e.target.value)} /></Field>
          <Field label="Seed"><input className="input" type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} /></Field>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy} onClick={sample}>Run</button></div>
        {sub && (
          <>
            <div className="cols-3" style={{ marginTop: 10 }}>
              <Stat label="Sampled reads" value={sub.sampled.length.toLocaleString()} />
              <Stat label="Requested" value={sub.requested.toLocaleString()} />
              <Stat label="Seed" value={seed} />
            </div>
            <div className="row" style={{ marginTop: 12 }}><button className="btn" disabled={saving} onClick={() => void saveSub()}>{saving ? 'Saving…' : 'Save sampled FASTQ'}</button></div>
          </>
        )}
      </Card>
      <Card title="Demultiplex" sub="The unique barcode within the mismatch limit wins; an equal best match is ambiguous, no match is unassigned. Up to 500,000 reads are examined.">
        <Field label="Barcode table (sample,barcode)"><textarea className="input" style={{ minHeight: 108, fontFamily: 'var(--mono)' }} value={barcodes} onChange={(e) => setBarcodes(e.target.value)} /></Field>
        <div className="cols-2" style={{ gap: 10 }}>
          <Field label="Max mismatches"><input className="input" type="number" min={0} max={3} value={maxMismatch} onChange={(e) => setMaxMismatch(+e.target.value)} /></Field>
          <Field label="Barcode position"><select className="select" value={where} onChange={(e) => setWhere(e.target.value as 'start' | 'end')}><option value="start">5' start</option><option value="end">3' end</option></select></Field>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy} onClick={demuxGo}>Run</button></div>
        {demux && (
          <>
            <div className="cols-3" style={{ marginTop: 10 }}>
              <Stat label="Barcodes" value={demux.barcodes} />
              <Stat label="Ambiguous" value={demux.ambiguous.toLocaleString()} />
              <Stat label="Unassigned" value={demux.unassigned.toLocaleString()} />
            </div>
            <DataTable rows={rows} rowKey={(r) => r.sample} cols={[{ key: 'sample', label: 'Sample' }, { key: 'count', label: 'Reads', num: true, render: (r) => r.count.toLocaleString(), sort: (r) => r.count }]} />
          </>
        )}
      </Card>
      {busy && <Busy progress={progress} note={note} />}
      {error && <Callout kind="err">{error}</Callout>}
      {saveErr && <Callout kind="err">{saveErr}</Callout>}
      <Callout>Per-sample output files are not written in this version; the table gives the assignment counts. Use the barcode table that the sequencing facility provided, and check the barcode distances before trusting the counts.</Callout>
    </>
  );
}
