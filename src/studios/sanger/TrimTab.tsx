import { useMemo } from 'react';
import { Callout, Card, Field, Stat, downloadText, fmt } from '@/ui/kit';
import type { AbifTrace } from './abif';
import { meanQ, q20Fraction } from './trim';

export type TrimMethod = 'mott' | 'window';

interface Props {
  trace: AbifTrace | null;
  method: TrimMethod;
  setMethod(m: TrimMethod): void;
  cutoff: number;
  setCutoff(n: number): void;
  window: number;
  setWindow(n: number): void;
  minMean: number;
  setMinMean(n: number): void;
  /** 0-based half-open kept range, shared with the Compare tab. */
  range: [number, number];
}

const wrap = (s: string, width = 60) => {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += width) out.push(s.slice(i, i + width));
  return out.join('\n');
};

const fasta = (name: string, seq: string) => `>${name.replace(/\s+/g, '_') || 'read'}\n${wrap(seq)}\n`;
const fastq = (name: string, seq: string, quality: number[]) =>
  `@${name.replace(/\s+/g, '_') || 'read'}\n${seq}\n+\n${quality.map((q) => String.fromCharCode(Math.max(0, Math.min(93, q)) + 33)).join('')}\n`;

export default function TrimTab({ trace, method, setMethod, cutoff, setCutoff, window, setWindow, minMean, setMinMean, range }: Props) {
  const kept = useMemo(() => {
    if (!trace) return '';
    return trace.bases.slice(range[0], range[1]);
  }, [trace, range]);
  const keptQuality = useMemo(() => (trace ? trace.quality.slice(range[0], range[1]) : []), [trace, range]);

  if (!trace) return (
    <Card title="Trim & export">
      <div className="faint" style={{ padding: 24, textAlign: 'center' }}>Load an ABIF trace in the Trace tab first.</div>
    </Card>
  );

  const full = trace.bases;
  const empty = kept.length === 0;
  const mean = meanQ(keptQuality);
  const q20 = q20Fraction(keptQuality);

  return (
    <div className="stack">
      <div className="cols-4">
        <Stat label="Kept bases" value={fmt(kept.length, 0)} hint={`of ${fmt(full.length, 0)} called`} />
        <Stat label="Kept range" value={empty ? 'none' : `${range[0] + 1}–${range[1]}`} hint="1-based inclusive" />
        <Stat label="Mean Q (kept)" value={empty ? '–' : fmt(mean, 1)} hint="Phred quality" />
        <Stat label="Q20+ (kept)" value={empty ? '–' : `${fmt(q20 * 100, 1)} %`} hint="per-base error < 1 %" />
      </div>

      <Card title="Trimming method" sub="The kept range is shared with the Compare tab.">
        <div className="grid-2">
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value as TrimMethod)}>
              <option value="mott">Mott (quality-weighted, default)</option>
              <option value="window">Window mean quality</option>
            </select>
          </Field>
          {method === 'mott' ? (
            <Field label="Mott cutoff (error probability)">
              <input type="number" min={0} max={1} step={0.01} value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))} />
            </Field>
          ) : (
            <div className="grid-2">
              <Field label="Window (bases)">
                <input type="number" min={2} max={100} step={1} value={window} onChange={(e) => setWindow(Math.max(2, Math.round(Number(e.target.value))))} />
              </Field>
              <Field label="Minimum mean Q">
                <input type="number" min={0} max={60} step={1} value={minMean} onChange={(e) => setMinMean(Math.max(0, Number(e.target.value)))} />
              </Field>
            </div>
          )}
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          {method === 'mott'
            ? 'Mott’s algorithm scores each base as cutoff minus the predicted error probability 10^(−Q/10), then keeps the maximum-scoring contiguous segment.'
            : 'Each end is trimmed until a full window has a mean quality of at least the minimum. The result is coarser than Mott.'}
        </div>
        {empty && <Callout kind="warn">No segment passes this threshold. Raise the Mott cutoff or lower the window mean.</Callout>}
      </Card>

      <Card title="Export" sub="Sequences and qualities are written exactly as stored in the file." actions={
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" disabled={empty} onClick={() => downloadText('sanger_trimmed.fasta', fasta(`${trace.sample}_trimmed`, kept), 'text/x-fasta')}>Trimmed FASTA</button>
          <button className="btn sm" onClick={() => downloadText('sanger_read.fasta', fasta(trace.sample, full), 'text/x-fasta')}>Full FASTA</button>
          <button className="btn sm" onClick={() => downloadText('sanger_read.fastq', fastq(trace.sample, full, trace.quality), 'text/x-fastq')}>Full FASTQ</button>
        </div>}>
        <div className="faint" style={{ fontSize: 12 }}>FASTQ encodes each quality value as Phred + 33. The trimmed FASTA contains bases {empty ? '—' : `${range[0] + 1} to ${range[1]}`}; the full files contain all {fmt(full.length, 0)} called bases.</div>
        <pre className="mono" style={{ marginTop: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, lineHeight: 1.45 }}>
          {empty ? 'No bases kept.' : `>${trace.sample}_trimmed\n${wrap(kept)}`}
        </pre>
      </Card>

      <Callout>Trimming removes low-quality ends but does not correct miscalls inside the kept range. Check the trace before reporting a variant.</Callout>
    </div>
  );
}
