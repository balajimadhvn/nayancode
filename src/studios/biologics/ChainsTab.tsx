import { Callout, Card, DataTable, Stat } from '@/ui/kit';
import type { ChainAnalysis } from './liabilities';

/** Sequence with CDRs coloured and liabilities underlined. */
function Annotated({ c }: { c: ChainAnalysis }) {
  const inCdr = (pos: number) => c.ranges.some(([a, b]) => pos >= a && pos <= b);
  const liable = new Set(c.liabilities.filter((l) => l.kind !== 'oxidation' || l.risk !== 'low').map((l) => l.position));
  return (
    <div className="mono" style={{ fontSize: 12, lineHeight: 1.7, wordBreak: 'break-all' }}>
      {[...c.seq].map((aa, i) => {
        const pos = i + 1, cdr = inCdr(pos), u = liable.has(pos);
        return <span key={i} style={{ background: cdr ? 'var(--accent-soft, rgba(0,114,178,0.18))' : undefined, textDecoration: u ? 'underline' : undefined, textUnderlineOffset: 2, padding: '0 0.5px' }}>{aa}</span>;
      })}
    </div>
  );
}

export default function ChainsTab({ chains }: { chains: ChainAnalysis[] }) {
  return (
    <div className="stack">
      {chains.map((c) => (
        <Card key={c.label} title={`${c.label} · ${c.cdr.chain === 'H' ? 'VH' : c.cdr.chain === 'L' ? 'VL' : 'unrecognised'}`} sub={`${c.seq.length} aa`}>
          <div className="cols-3">
            <Stat label="CDR1" value={c.cdr.cdr1} hint={`positions ${c.cdr.cdr1Pos[0]}–${c.cdr.cdr1Pos[1]}`} />
            <Stat label="CDR2" value={c.cdr.cdr2} hint={`positions ${c.cdr.cdr2Pos[0]}–${c.cdr.cdr2Pos[1]}`} />
            <Stat label="CDR3" value={c.cdr.cdr3} hint={`positions ${c.cdr.cdr3Pos[0]}–${c.cdr.cdr3Pos[1]}`} />
          </div>
          <Annotated c={c} />
          <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Shaded: CDR residues. Underlined: sequence-liability motifs (excluding low-risk oxidation sites).</div>
        </Card>
      ))}
      <Card title="CDR table" pad={false}>
        <DataTable rowKey={(r) => r.chain + r.cdr} rows={chains.map((c) => ({ chain: c.label, type: c.cdr.chain ?? '–', cdr: 'CDR1', seq: c.cdr.cdr1, len: c.cdr.cdr1.length, pos: `${c.cdr.cdr1Pos[0]}–${c.cdr.cdr1Pos[1]}` }))
          .concat(chains.map((c) => ({ chain: c.label, type: c.cdr.chain ?? '–', cdr: 'CDR2', seq: c.cdr.cdr2, len: c.cdr.cdr2.length, pos: `${c.cdr.cdr2Pos[0]}–${c.cdr.cdr2Pos[1]}` })))
          .concat(chains.map((c) => ({ chain: c.label, type: c.cdr.chain ?? '–', cdr: 'CDR3', seq: c.cdr.cdr3, len: c.cdr.cdr3.length, pos: `${c.cdr.cdr3Pos[0]}–${c.cdr.cdr3Pos[1]}` })))} cols={[
          { key: 'chain', label: 'Chain' }, { key: 'type', label: 'Type' }, { key: 'cdr', label: 'CDR' }, { key: 'seq', label: 'Sequence' },
          { key: 'len', label: 'Length', num: true }, { key: 'pos', label: 'Positions' }]} />
      </Card>
      {chains.some((c) => c.cdr.chain === null) && <Callout kind="err">At least one chain was not recognised as a VH or VL domain.</Callout>}
    </div>
  );
}
