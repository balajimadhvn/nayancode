import { useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { createRemote } from '@/compute/rpc';
import { Busy, Callout, Card, DataTable, Field, Stat, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { openSink, readPairs, writeFastqChunks, type FastqRecord } from './fastq';
import { mergePair } from './merge';
import type { ReadsKernels, MergeResult, DedupResult } from './reads.worker';
import type { ReadsSource } from './ReadsStudio';

const remote = createRemote<ReadsKernels>(() => new Worker(new URL('./reads.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = {
  id: 'reads.merge', name: 'Paired-end overlap merging', version: '0.1.0', engine: 'TypeScript streaming worker kernels',
  citations: ['edgar2015'],
  describe: (p) => `Read pairs were merged when a suffix/prefix overlap of at least ${p.minOverlap} bases had a mismatch rate at or below ${p.maxRate}; mismatches took the higher-quality base and read-through adapters were removed`,
};

async function* merged(src: ReadsSource, minOverlap: number, maxRate: number): AsyncGenerator<FastqRecord> {
  if (!src.files[0] || !src.files[1]) throw new Error('Load two FASTQ files for merging.');
  for await (const [r1, r2] of readPairs(src.files[0], src.files[1])) {
    const m = mergePair(r1, r2, { minOverlap, maxMismatchRate: maxRate });
    if (m) yield m;
  }
}
export default function MergeTab({ src }: { src: ReadsSource }) {
  const paired = src.files.length === 2;
  const [minOverlap, setMinOverlap] = useState(10), [maxRate, setMaxRate] = useState(0.1);
  const [res, setRes] = useState<MergeResult | null>(null);
  const [dedupRes, setDedupRes] = useState<DedupResult | null>(null);
  const [saving, setSaving] = useState(false), [saveErr, setSaveErr] = useState<string | null>(null);
  const { run, busy, progress, note, error } = useRunner();
  const go = () => void run({
    label: `Merge pairs · ${src.label}`, tool: TOOL, params: { minOverlap, maxRate }, inputs: [{ name: src.label, data: src.label }],
    run: (h) => remote.merge({ file: src.files[0], file2: src.files[1], minOverlap, maxMismatchRate: maxRate }, { onProgress: h.onProgress }),
  }).then((r) => { if (r) setRes(r); });
  const save = async (gzip: boolean) => {
    setSaving(true); setSaveErr(null);
    try {
      const base = (src.files[0]?.name ?? 'merged').replace(/\.(fastq|fq)(\.gz)?$/i, '');
      const sink = await openSink(`${base}.merged.fastq${gzip ? '.gz' : ''}`, { gzip });
      await writeFastqChunks(merged(src, minOverlap, maxRate), sink); await sink.close();
    } catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };
  const dedupGo = () => void run({
    label: `Deduplicate · ${src.label}`, tool: TOOL, params: { maxReads: 500_000 }, inputs: [{ name: src.label, data: src.label }],
    run: (h) => remote.dedup({ file: src.files[0], demo: src.demo ?? undefined, maxReads: 500_000 }, { onProgress: h.onProgress }),
  }).then((r) => { if (r) setDedupRes(r); });
  const saveDedup = async () => {
    if (!dedupRes) return;
    setSaving(true); setSaveErr(null);
    try {
      const base = (src.files[0]?.name ?? 'deduplicated').replace(/\.(fastq|fq)(\.gz)?$/i, '');
      const sink = await openSink(`${base}.dedup.fastq`, {});
      await writeFastqChunks(dedupRes.records, sink); await sink.close();
    } catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };
  return (
    <>
      <Card title="Merge pairs" sub={paired ? 'Overlap scan from longest to shortest; ties favour fewer mismatches.' : 'This tab needs two FASTQ files (R1 and R2).'}>
        <div className="cols-2" style={{ gap: 10 }}>
          <Field label="Minimum overlap (bp)"><input className="input" type="number" value={minOverlap} onChange={(e) => setMinOverlap(+e.target.value)} /></Field>
          <Field label="Maximum mismatch rate"><input className="input" type="number" step={0.01} value={maxRate} onChange={(e) => setMaxRate(+e.target.value)} /></Field>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={!paired || busy} onClick={go}>Run</button>{busy && <span className="faint">{note}</span>}</div>
        {busy && <div style={{ marginTop: 10 }}><Busy progress={progress} note={note} /></div>}
        {error && <Callout kind="err">{error}</Callout>}
      </Card>
      {res && (
        <Card title="Merge result" sub="A merged read can be shorter than either input when the fragment is shorter than a read (read-through).">
          <div className="cols-3">
            <Stat label="Pairs" value={res.pairs.toLocaleString()} />
            <Stat label="Merged" value={res.merged.toLocaleString()} />
            <Stat label="Merge rate" value={`${fmt(res.pairs ? (100 * res.merged) / res.pairs : 0, 1)}%`} />
          </div>
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn" disabled={saving} onClick={() => void save(false)}>{saving ? 'Saving…' : 'Save merged FASTQ'}</button>
            <button className="btn" disabled={saving} onClick={() => void save(true)}>Save gzipped merged FASTQ</button>
          </div>
          {saveErr && <div style={{ marginTop: 10 }}><Callout kind="err">{saveErr}</Callout></div>}
          {res.preview.length > 0 && <DataTable rows={res.preview} rowKey={(r) => r.id} cols={[{ key: 'id', label: 'Read' }, { key: 'len', label: 'Length', num: true, render: (r) => r.seq.length.toLocaleString() }, { key: 'overlap', label: 'Overlap call', render: (r) => r.desc.split('(')[1]?.replace(')', '') ?? r.desc }]} />}
        </Card>
      )}
      <Card title="Deduplicate" sub="Exact duplicate sequences are removed, keeping the first occurrence. Up to 500,000 reads are examined and the first 100,000 kept reads are available to save. For paired files this uses R1 only.">
        <div className="row"><button className="btn primary" disabled={busy} onClick={dedupGo}>Run</button></div>
        {dedupRes && (
          <>
            <div className="cols-3" style={{ marginTop: 10 }}>
              <Stat label="Input reads" value={dedupRes.input.toLocaleString()} />
              <Stat label="Kept" value={dedupRes.kept.toLocaleString()} />
              <Stat label="Duplicates removed" value={`${dedupRes.removed.toLocaleString()} (${fmt(dedupRes.input ? (100 * dedupRes.removed) / dedupRes.input : 0, 1)}%)`} />
            </div>
            <div className="row" style={{ marginTop: 12 }}><button className="btn" disabled={saving} onClick={() => void saveDedup()}>Save deduplicated FASTQ</button></div>
          </>
        )}
      </Card>
      <Callout>Sequences are compared exactly. Near-duplicates (sequencing errors) are not collapsed; use the trim tab first if that matters.</Callout>
    </>
  );
}
