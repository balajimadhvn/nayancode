import { useState } from 'react';
import { Callout, Card, DataTable, Field, downloadText, fmt, toCsv } from '@/ui/kit';
import type { Feature } from './genbank';
import type { PlasmidTabProps } from './PlasmidStudio';

export default function FeaturesTab({ plasmid, features, setFeatures }: PlasmidTabProps) {
  const [add, setAdd] = useState({ label: '', type: 'CDS', start: '', end: '', strand: '1' });
  const [err, setErr] = useState('');
  const rename = (i: number, label: string) => setFeatures(features.map((f, j) => (j === i ? { ...f, label } : f)));
  const remove = (i: number) => setFeatures(features.filter((_f, j) => j !== i));
  const addFeature = () => {
    const start = Number(add.start), end = Number(add.end);
    if (!add.label.trim()) { setErr('Give the feature a label.'); return; }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) { setErr('Start and end must be whole numbers with 1 ≤ start ≤ end.'); return; }
    if (end > plasmid.seq.length) { setErr(`End ${end} is beyond the sequence length (${plasmid.seq.length}).`); return; }
    const f: Feature = { type: add.type || 'misc_feature', start, end, strand: add.strand === '-1' ? -1 : 1, label: add.label.trim(), qualifiers: {} };
    setFeatures([...features, f].sort((a, b) => a.start - b.start));
    setAdd({ label: '', type: 'CDS', start: '', end: '', strand: '1' });
    setErr('');
  };
  return (
    <div className="split"><div className="stack">
      <Card title="Add a feature"><div className="stack" style={{ gap: 10 }}>
        <Field label="Label"><input className="input" value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} placeholder="e.g. my insert" /></Field>
        <div className="cols-2" style={{ gap: 8 }}>
          <Field label="Type"><select className="select" value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value })}>{['CDS', 'promoter', 'terminator', 'rep_origin', 'primer_bind', 'protein_bind', 'misc_feature', 'resistance'].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Strand"><select className="select" value={add.strand} onChange={(e) => setAdd({ ...add, strand: e.target.value })}><option value="1">+ (forward)</option><option value="-1">− (reverse)</option></select></Field>
        </div>
        <div className="cols-2" style={{ gap: 8 }}><Field label="Start (1-based)"><input className="input" value={add.start} onChange={(e) => setAdd({ ...add, start: e.target.value })} /></Field><Field label="End (inclusive)"><input className="input" value={add.end} onChange={(e) => setAdd({ ...add, end: e.target.value })} /></Field></div>
        <button className="btn primary" onClick={addFeature}>Add feature</button>
        {err && <Callout kind="err">{err}</Callout>}
      </div></Card>
      <Card title="Export"><div className="stack" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => downloadText(`${plasmid.name}_features.csv`, toCsv(features.map((f) => ({ label: f.label, type: f.type, start: f.start, end: f.end, strand: f.strand, identity: f.identity ?? '', coverage: f.coverage ?? '' }))), 'text/csv')}>Features as CSV</button>
        <div className="faint" style={{ fontSize: 11.5 }}>Names and coordinates are saved with the GenBank download on the previous card.</div>
      </div></Card>
    </div>
    <div className="stack">
      <Card title="Features" sub={`${features.length} on this plasmid`} pad={false}>
        <DataTable limit={200} rowKey={(f, i) => `${f.label}-${i}`} rows={features} cols={[
          { key: 'label', label: 'Label', width: 220 },
          { key: 'type', label: 'Type' }, { key: 'start', label: 'Start', num: true }, { key: 'end', label: 'End', num: true },
          { key: 'strand', label: 'Strand', render: (f) => (f.strand === 1 ? '+' : '−') },
          { key: 'len', label: 'Length', num: true, render: (f) => fmt(f.end - f.start + 1, 0) },
          { key: 'identity', label: 'Identity', num: true, render: (f) => (f.identity === undefined ? 'typed' : `${fmt(f.identity * 100, 1)} %`) },
        ]} />
      </Card>
      <Card title="Edit" pad={false}>
        <DataTable limit={200} rowKey={(f, i) => `edit-${f.label}-${i}`} rows={features} cols={[
          { key: 'label', label: 'Label', width: 240, render: (f) => <input className="input" style={{ width: 220 }} value={f.label} onChange={(e) => rename(features.indexOf(f), e.target.value)} /> },
          { key: 'range', label: 'Coordinates', render: (f) => `${f.start}..${f.end}${f.strand === -1 ? ' (c)' : ''}` },
          { key: 'del', label: '', render: (f) => <button className="btn ghost sm" onClick={() => remove(features.indexOf(f))}>Remove</button> },
        ]} />
      </Card>
    </div></div>
  );
}
