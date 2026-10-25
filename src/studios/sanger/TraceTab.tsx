import { useMemo, useRef, useState } from 'react';
import { Callout, Card, DataTable, Stat, fmt } from '@/ui/kit';
import { parseAbif, type AbifTrace } from './abif';
import { demoTrace } from './fixture';
import { meanQ, q20Fraction, secondaryPeaks } from './trim';
import TraceView from './TraceView';

interface Props { trace: AbifTrace | null; onTrace(t: AbifTrace): void }

function readBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

export default function TraceTab({ trace, onTrace }: Props) {
  const [error, setError] = useState('');
  const [start, setStart] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const span = 60;

  const accept = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) { setError('The ABIF file is larger than 20 MB.'); return; }
    try {
      const parsed = parseAbif(await readBuffer(file));
      if (!parsed.bases.length) throw new Error('No base calls were found in the file.');
      setError(''); setStart(0); onTrace(parsed);
    } catch (e) { setError((e as Error).message); }
  };

  const demo = () => {
    try {
      const d = demoTrace();
      setError(''); setStart(0); onTrace(parseAbif(d.buffer));
    } catch (e) { setError((e as Error).message); }
  };

  const mixed = useMemo(() => trace ? secondaryPeaks(trace.traces, trace.peaks, trace.order) : [], [trace]);

  if (!trace) return (
    <div className="stack">
      <Card title="Load an ABIF trace">
        <div className="dropzone" role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void accept(f); }}>
          <div>Drop an .ab1 / .abi file or click to browse</div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Read locally. Never uploaded.</div>
          <input ref={input} type="file" accept=".ab1,.abi,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void accept(f); e.target.value = ''; }} />
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn sm" onClick={demo}>Load demo (400-base synthetic trace)</button></div>
        {error && <Callout kind="err">{error}</Callout>}
      </Card>
      <Callout>An ABIF file stores the electropherogram, base calls and quality values written by the instrument software. Its directory is read in the browser; nothing is uploaded.</Callout>
    </div>
  );

  const mean = meanQ(trace.quality), q20 = q20Fraction(trace.quality);
  return (
    <div className="stack">
      <div className="cols-4">
        <Stat label="Sample" value={trace.sample} hint="from SMPL" />
        <Stat label="Bases" value={fmt(trace.bases.length, 0)} hint={`${trace.quality.length} quality values`} />
        <Stat label="Mean Q" value={fmt(mean, 1)} hint={`${fmt(q20 * 100, 1)} % at Q20+`} />
        <Stat label="Mixed peaks" value={mixed.length} hint="secondary ≥ 25 %" />
      </div>
      <Card title="Electropherogram" sub={`${trace.order} channels · window ${Math.min(start + 1, trace.bases.length)}–${Math.min(start + span, trace.bases.length)}`} actions={
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setStart((s) => Math.max(0, s - span))}>− window</button>
          <button className="btn sm" onClick={() => setStart((s) => Math.min(Math.max(0, trace.bases.length - span), s + span))}>+ window</button>
          <button className="btn sm" onClick={() => input.current?.click()}>Open…</button>
          <input ref={input} type="file" accept=".ab1,.abi,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void accept(f); e.target.value = ''; }} />
        </div>}>
        <TraceView trace={trace} start={start} span={span} mixed={mixed} onCenter={(i) => setStart(Math.max(0, Math.min(trace.bases.length - span, i - Math.floor(span / 2))))} />
        <div className="row" style={{ gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          <input type="range" min={0} max={Math.max(0, trace.bases.length - span)} value={Math.min(start, Math.max(0, trace.bases.length - span))} onChange={(e) => setStart(+e.target.value)} aria-label="Trace window" style={{ flex: 1, minWidth: 200 }} />
          <span className="faint mono" style={{ fontSize: 12 }}>{start + 1}–{Math.min(start + span, trace.bases.length)} / {trace.bases.length}</span>
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>A green · C blue · G grey · T red. Bars below the letters are quality; a red letter with an IUPAC code marks a mixed peak. Click a base to centre it.</div>
        {error && <Callout kind="err">{error}</Callout>}
      </Card>
      <Card title="Mixed positions" sub={mixed.length ? `${mixed.length} flagged` : 'none flagged'} pad={false}>
        {!mixed.length ? <div className="faint" style={{ padding: 20, textAlign: 'center' }}>No secondary peak reaches 25 % of the called channel.</div> : <DataTable rows={mixed.slice(0, 100)} rowKey={(m) => String(m.index)} onRow={(m) => setStart(Math.max(0, Math.min(trace.bases.length - span, m.index - Math.floor(span / 2))))} cols={[
          { key: 'pos', label: 'Position', num: true, sort: (m) => m.position, render: (m) => m.position.toLocaleString() },
          { key: 'primary', label: 'Called' },
          { key: 'secondary', label: 'Secondary' },
          { key: 'code', label: 'IUPAC' },
        ]} />}
      </Card>
      <Callout>Base calls and quality values are those stored by the instrument software. Confirm any variant by inspecting the trace or sequencing the opposite strand.</Callout>
    </div>
  );
}
