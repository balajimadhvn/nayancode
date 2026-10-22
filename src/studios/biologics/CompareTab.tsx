import { useMemo, useState } from 'react';
import { Callout, Card, DataTable, downloadText, fmt, toCsv } from '@/ui/kit';
import { analyseAntibody } from './liabilities';

const DEMO = `trastuzumab,EVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS
adalimumab,EVQLVESGGGLVQPGRSLRLSCAASGFTFDDYAMHWVRQAPGKGLEWVSAITWNSGHIDYADSVEGRFTISRDNAKNSLYLQMNSLRAEDTAVYYCAKVSYLSTASSLDYWGQGTLVTVSS`;
const DEMO_LIGHT = `trastuzumab,DIQMTQSPSSLSASVGDRVTITCRASQDVNTAVAWYQQKPGKAPKLLIYSASFLYSGVPSRFSGSRSGTDFTLTISSLQPEDFATYYCQQHYTTPPTFGQGTKVEIK
adalimumab,DIQMTQSPSSLSASVGDRVTITCRASQGIRNYLAWYQQKPGKAPKLLIYAASTLQSGVPSRFSGSGSGTDFTLTISSLQPEDVATYYCQRYNRAPYTFGQGTKVEIK`;

export default function CompareTab() {
  const [text, setText] = useState('');
  const rows = useMemo(() => {
    const out: { name: string; chain: string; pI: number; charge: number; cdrH3: number | null; liabilities: number; flags: string; error: string }[] = [];
    for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6)) {
      const i = line.indexOf(',');
      const name = i > 0 ? line.slice(0, i).trim() : `entry ${out.length + 1}`;
      const seq = i > 0 ? line.slice(i + 1) : line;
      try {
        const chains = analyseAntibody(seq);
        for (const c of chains) out.push({ name, chain: c.cdr.chain ?? '–', pI: c.props.pI, charge: c.props.charge7, cdrH3: c.cdr.chain === 'H' ? c.cdr.cdr3.length : null, liabilities: c.liabilities.length, flags: c.flags.map((f) => f.text).join('; '), error: '' });
      } catch (e) { out.push({ name, chain: '–', pI: NaN, charge: NaN, cdrH3: null, liabilities: 0, flags: '', error: (e as Error).message }); }
    }
    return out;
  }, [text]);
  return (
    <div className="stack">
      <Card title="Compare antibodies" sub="one per line: name,sequence (VH and VL entries separately)"><div className="stack" style={{ gap: 10 }}>
        <textarea className="input mono" rows={6} style={{ fontSize: 11 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'name,sequence\ntrastuzumab,EVQL…'} />
        <div className="row" style={{ gap: 6 }}><button className="btn" onClick={() => setText(DEMO)}>Demo (two VH)</button><button className="btn" onClick={() => setText(DEMO_LIGHT)}>Demo (two VL)</button><button className="btn ghost" onClick={() => setText('')}>Clear</button></div>
        <div className="faint" style={{ fontSize: 11.5 }}>Up to 6 entries. pI and charge are computed per chain; CDR-H3 length is shown for heavy chains.</div>
      </div></Card>
      {rows.length === 0 ? <Card><div className="faint" style={{ padding: '24px 6px', textAlign: 'center' }}>Paste antibodies (or a demo) to compare.</div></Card> : (
        <Card title="Side by side" pad={false}>
          <DataTable rowKey={(r, i) => `${r.name}-${i}`} rows={rows} cols={[
            { key: 'name', label: 'Antibody' }, { key: 'chain', label: 'Chain' },
            { key: 'pI', label: 'pI', num: true, render: (r) => (Number.isFinite(r.pI) ? fmt(r.pI, 2) : '–') },
            { key: 'charge', label: 'Charge pH 7.4', num: true, render: (r) => (Number.isFinite(r.charge) ? fmt(r.charge, 2) : '–') },
            { key: 'cdrH3', label: 'CDR-H3 length', num: true, render: (r) => (r.cdrH3 === null ? '–' : String(r.cdrH3)) },
            { key: 'liabilities', label: 'Liabilities', num: true },
            { key: 'flags', label: 'Flags', render: (r) => r.error || (r.flags ? r.flags.split('; ').length + ' flag(s)' : 'none') },
          ]} />
          <div className="row" style={{ padding: 10 }}><button className="btn sm" onClick={() => downloadText('antibody_comparison.csv', toCsv(rows.map((r) => ({ name: r.name, chain: r.chain, pI: r.pI, charge_ph7_4: r.charge, cdr_h3_length: r.cdrH3 ?? '', liabilities: r.liabilities, flags: r.flags }))), 'text/csv')}>Export comparison (CSV)</button></div>
        </Card>
      )}
      {rows.some((r) => r.error) && <Callout kind="err">{rows.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`).join(' · ')}</Callout>}
    </div>
  );
}
