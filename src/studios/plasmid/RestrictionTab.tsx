import { useMemo, useState } from 'react';
import { Callout, Card, DataTable, downloadText, fmt, toCsv } from '@/ui/kit';
import { digest, ENZYMES } from '@/studios/sequence/kernels';
import type { PlasmidTabProps } from './PlasmidStudio';

export default function RestrictionTab({ plasmid }: PlasmidTabProps) {
  const circular = plasmid.topology === 'circular';
  const [selected, setSelected] = useState<string[]>(['EcoRI', 'HindIII']);
  const singles = useMemo(() => ENZYMES.map((e) => ({ enzyme: e.name, site: e.site, d: digest(plasmid.seq, [e.name], circular) })).filter((x) => x.d.sites.length === 1).map((x) => ({ enzyme: x.enzyme, site: x.site, pos: x.d.sites[0].pos })).sort((a, b) => a.pos - b.pos), [plasmid.seq, circular]);
  const res = useMemo(() => digest(plasmid.seq, selected, circular), [plasmid.seq, selected, circular]);
  const toggle = (name: string) => setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
  return (
    <div className="split"><div className="stack">
      <Card title="1 · Enzymes"><div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6 }}><button className="btn sm" onClick={() => setSelected([])}>Clear</button><button className="btn sm" onClick={() => setSelected(singles.map((s) => s.enzyme))}>All unique cutters</button><button className="btn sm" onClick={() => setSelected(['EcoRI', 'HindIII'])}>EcoRI + HindIII</button></div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{ENZYMES.map((e) => <label key={e.name} className="row" style={{ gap: 4 }}><input type="checkbox" checked={selected.includes(e.name)} onChange={() => toggle(e.name)} />{e.name}</label>)}</div>
        <div className="faint" style={{ fontSize: 11.5 }}>{ENZYMES.length} palindromic Type II enzymes. Sites are found on the given strand; cuts are mapped onto the top strand.</div>
      </div></Card>
      {selected.length > 1 && <Callout><div>{selected.length} enzymes selected. A circular plasmid with <i>k</i> cuts gives <i>k</i> fragments; the sizes below must add up to {plasmid.seq.length.toLocaleString()} bp.</div></Callout>}
      <Card title="2 · Fragments" pad={false}>
        <DataTable rowKey={(r) => `${r.enzyme}-${r.pos}`} rows={res.sites} cols={[
          { key: 'enzyme', label: 'Enzyme' }, { key: 'pos', label: 'Site start', num: true },
        ]} />
        <div className="faint" style={{ padding: 10, fontSize: 12 }}>Fragments (bp, largest first): {res.fragments.map((f) => f.toLocaleString()).join(' · ')} — total {res.fragments.reduce((a, b) => a + b, 0).toLocaleString()} bp.</div>
        <div className="row" style={{ padding: 10 }}><button className="btn sm" onClick={() => downloadText('restriction_digest.csv', toCsv(res.sites.map((s) => ({ enzyme: s.enzyme, site_start: s.pos })).concat(res.fragments.map((f, i) => ({ enzyme: `fragment ${i + 1}`, site_start: f })))), 'text/csv')}>Export digest (CSV)</button></div>
      </Card>
    </div>
    <div className="stack">
      <Card title="Unique cutters" sub={`${singles.length} enzymes cut once`} pad={false}>
        <DataTable limit={100} rowKey={(r) => r.enzyme} rows={singles} cols={[
          { key: 'enzyme', label: 'Enzyme' }, { key: 'site', label: 'Site' }, { key: 'pos', label: 'Position', num: true, render: (r) => fmt(r.pos, 0) },
          { key: 'use', label: '', render: (r) => <button className="btn ghost sm" onClick={() => setSelected((s) => (s.includes(r.enzyme) ? s : [...s, r.enzyme]))}>Add</button> }]} />
      </Card>
    </div></div>
  );
}
