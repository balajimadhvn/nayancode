import { useEffect, useMemo, useState } from 'react';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { parseFasta } from '@/studios/sequence/kernels';
import type { AbifTrace } from './abif';
import { compareToReference, type CompareResult } from './compare';

interface Props {
  trace: AbifTrace | null;
  range: [number, number];
}

const TYPE_LABEL: Record<string, string> = { sub: 'substitution', ins: 'insertion', del: 'deletion' };

export default function CompareTab({ trace, range }: Props) {
  const [text, setText] = useState('');
  const [useTrim, setUseTrim] = useState(true);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { setResult(null); setError(''); }, [trace]);

  const records = useMemo(() => parseFasta(text), [text]);
  const reference = records[0]?.seq ?? '';

  if (!trace) return (
    <Card title="Compare with a reference">
      <div className="faint" style={{ padding: 24, textAlign: 'center' }}>Load an ABIF trace in the Trace tab first.</div>
    </Card>
  );

  const trimmed = useTrim ? range : undefined;
  const emptyTrim = useTrim && range[1] <= range[0];

  const run = () => {
    setError('');
    try {
      if (!reference) throw new Error('Paste a reference sequence or load a FASTA file.');
      setResult(compareToReference(trace.bases, reference, { trimmed, quality: trace.quality }));
    } catch (e) { setResult(null); setError((e as Error).message); }
  };

  const differences = result?.differences ?? [];
  const csv = () => downloadText('sanger_differences.csv', toCsv(differences.map((d) => ({
    reference_position: d.refPos, reference: d.ref, read: d.read, type: d.type, quality: d.quality ?? '',
  }))), 'text/csv');

  return (
    <div className="stack">
      <Card title="Reference sequence" sub="One FASTA record; local alignment is tried in both orientations.">
        <FileDrop accept=".fa,.fasta,.fna,.txt,text/plain" label="Drop a reference FASTA or click to browse" onText={(t) => { setText(t); setResult(null); }} />
        <Field label="Or paste a reference FASTA / plain sequence">
          <textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} placeholder={'>reference\nACGT…'} spellCheck={false} />
        </Field>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <button className="btn sm" onClick={run} disabled={!reference || emptyTrim}>Compare</button>
          <button className="btn sm" onClick={() => { setText(''); setResult(null); setError(''); }}>Clear</button>
          <label className="row" style={{ gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={useTrim} onChange={(e) => { setUseTrim(e.target.checked); setResult(null); }} disabled={range[1] <= range[0]} />
            Use the trimmed range ({range[1] > range[0] ? `${range[0] + 1}–${range[1]}` : 'empty'})
          </label>
          <span className="faint" style={{ fontSize: 12 }}>{records.length > 1 ? `Using the first of ${records.length} records (${records[0].id}).` : reference ? `${reference.length.toLocaleString()} nt` : 'No reference loaded.'}</span>
        </div>
        {emptyTrim && <Callout kind="warn">The trimmed range is empty. Turn off the trimmed range or relax the trimming threshold.</Callout>}
        {error && <Callout kind="err">{error}</Callout>}
      </Card>

      {result && (
        <>
          <div className="cols-4">
            <Stat label="Orientation" value={result.orientation === '+' ? 'forward (+)' : 'reverse (−)'} hint="higher-scoring strand" />
            <Stat label="Identity" value={`${fmt(result.identity * 100, 2)} %`} hint="identical aligned columns" />
            <Stat label="Reference range" value={`${fmt(result.refStart, 0)}–${fmt(result.refEnd, 0)}`} hint="1-based inclusive" />
            <Stat label="Differences" value={fmt(differences.length, 0)} hint="substitutions, insertions and deletions" />
          </div>
          <Card title="Differences" sub={`${differences.length} from ${fmt(result.alignedRead.replace(/-/g, '').length, 0)} aligned read bases`} pad={false} actions={
            <button className="btn sm" disabled={!differences.length} onClick={csv}>Download CSV</button>
          }>
            {!differences.length ? <div className="faint" style={{ padding: 20, textAlign: 'center' }}>The read matches the aligned reference segment.</div> : (
              <DataTable rows={differences} rowKey={(d, i) => `${d.refPos}-${i}`} cols={[
                { key: 'refPos', label: 'Ref position', num: true, sort: (d) => d.refPos, render: (d) => d.refPos.toLocaleString() },
                { key: 'ref', label: 'Reference' },
                { key: 'read', label: 'Read' },
                { key: 'type', label: 'Type', render: (d) => TYPE_LABEL[d.type] },
                { key: 'quality', label: 'Q', num: true, sort: (d) => d.quality ?? -1, render: (d) => (d.quality === undefined ? '–' : fmt(d.quality, 1)) },
              ]} />
            )}
          </Card>
          <Card title="Aligned segment" sub="Read on top, reference below; dashes are gaps.">
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, lineHeight: 1.45 }}>
              {`read  ${result.alignedRead}\n      ${result.alignedRead.split('').map((c, i) => (c === result.alignedRef[i] ? '|' : ' ')).join('')}\nref   ${result.alignedRef}`}
            </pre>
          </Card>
        </>
      )}

      <Callout>Local alignment allows gaps but is not a variant caller. Low-quality and mixed positions can look like substitutions; inspect the trace before acting on a difference.</Callout>
    </div>
  );
}
