import { useRef, useState } from 'react';
import { Callout, Card, DataTable, Stat, fmt } from '@/ui/kit';
import { parseFcs, type FcsFile } from './fcs';
import { makeDemoFcs } from './demo';
import type { TransformKind, TransformSpec } from './transform';

interface Props {
  parsed: FcsFile | null;
  transforms: Record<string, TransformSpec>;
  setTransforms(t: Record<string, TransformSpec>): void;
  onFile(file: FcsFile, isDemo: boolean): void;
}

export default function DataTab({ parsed, transforms, setTransforms, onFile }: Props) {
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = async (file: File) => {
    setError('');
    if (file.size > 200 * 1024 * 1024) { setError('The FCS file is larger than 200 MB.'); return; }
    try { onFile(parseFcs(await file.arrayBuffer()), false); }
    catch (e) { setError((e as Error).message); }
  };
  const demo = () => {
    setError('');
    try { onFile(parseFcs(makeDemoFcs()), true); } catch (e) { setError((e as Error).message); }
  };
  const setTransform = (name: string, patch: Partial<TransformSpec>) => setTransforms({ ...transforms, [name]: { ...(transforms[name] ?? { kind: 'none' }), ...patch } });

  return (
    <div className="stack">
      <Card title="FCS file" sub={parsed ? `${fmt(parsed.tot, 0)} events · ${parsed.params.length} parameters` : 'FCS 3.0/3.1 list mode. Read locally, never uploaded.'} actions={
        parsed ? <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => input.current?.click()}>Open another…</button>
          <input ref={input} type="file" accept=".fcs,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void take(f); e.target.value = ''; }} />
        </div> : undefined
      }>
        {!parsed && <>
          <div className={`dropzone ${over ? 'over' : ''}`} role="button" tabIndex={0} onClick={() => input.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void take(f); }}>
            <div>Drop an .fcs file or click to browse</div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Up to 2,000,000 events and 64 parameters.</div>
            <input ref={input} type="file" accept=".fcs,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void take(f); e.target.value = ''; }} />
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn sm" onClick={demo}>Load demo (30,000 events)</button></div>
        </>}
        {parsed && <div className="cols-4">
          <Stat label="Events" value={fmt(parsed.tot, 0)} hint="after $TOT check" />
          <Stat label="Parameters" value={parsed.params.length} hint="limit 64" />
          <Stat label="Data type" value={parsed.text.$DATATYPE ?? 'F'} hint={parsed.text.$BYTEORD ?? ''} />
          <Stat label="Spillover" value={parsed.spill ? `${parsed.spill.names.length} channels` : 'none'} hint={parsed.spill ? 'from the file' : 'compensation unavailable'} />
        </div>}
        {error && <Callout kind="err">{error}</Callout>}
      </Card>

      {parsed && <Card title="Parameters and transforms" sub="Transforms are used for gating and plots; statistics stay on the compensated, untransformed values." pad={false}>
        <DataTable rows={parsed.params} rowKey={(p) => p.name} cols={[
          { key: 'name', label: 'Parameter', render: (p) => <span className="mono">{p.name}</span> },
          { key: 'stain', label: 'Stain / marker', render: (p) => p.stain || '—' },
          { key: 'range', label: 'Range', num: true, render: (p) => fmt(p.range, 0) },
          { key: 'log', label: 'File scale', render: (p) => (p.log ? 'log (converted)' : 'linear') },
          { key: 'transform', label: 'Transform', render: (p) => (
            <select value={transforms[p.name]?.kind ?? 'none'} onChange={(e) => setTransform(p.name, { kind: e.target.value as TransformKind })} aria-label={`Transform for ${p.name}`}>
              <option value="none">None</option>
              <option value="arcsinh">arcsinh</option>
              <option value="log">log10</option>
            </select>
          ) },
          { key: 'cofactor', label: 'Cofactor / floor', render: (p) => (transforms[p.name]?.kind === 'arcsinh'
            ? <input type="number" min={1} step={5} value={transforms[p.name]?.cofactor ?? 150} onChange={(e) => setTransform(p.name, { cofactor: Math.max(1, Number(e.target.value)) })} style={{ width: 90 }} aria-label={`Cofactor for ${p.name}`} />
            : transforms[p.name]?.kind === 'log'
              ? <input type="number" min={1} step={1} value={transforms[p.name]?.floor ?? 1} onChange={(e) => setTransform(p.name, { floor: Math.max(1, Number(e.target.value)) })} style={{ width: 90 }} aria-label={`Floor for ${p.name}`} />
              : '—') },
        ]} />
      </Card>}

      <Callout>FCS files can store log-amplified channels; those values are converted to linear fluorescence on import. The transform you choose here is only for display and gating.</Callout>
    </div>
  );
}
