import { Callout, Card, DataTable, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import type { ChainAnalysis, Liability } from './liabilities';

const colour = (risk: Liability['risk']) => (risk === 'high' ? 'var(--danger)' : risk === 'medium' ? 'var(--warn, #b8860b)' : 'inherit');

export default function DevelopabilityTab({ chains }: { chains: ChainAnalysis[] }) {
  const all = chains.flatMap((c) => c.liabilities.map((l) => ({ ...l, chain: c.label })));
  const flags = chains.flatMap((c) => c.flags.map((f) => ({ chain: c.label, ...f })));
  const p = chains[0].props;
  return (
    <div className="stack">
      <div className="cols-3">
        <Stat label="Theoretical pI" value={fmt(p.pI, 2)} hint="bisection on the net charge with the documented pKa set" />
        <Stat label="Net charge at pH 7.4" value={fmt(p.charge7, 2)} />
        <Stat label="Molecular weight" value={`${fmt(p.mw / 1000, 1)} kDa`} />
      </div>
      <div className="cols-3">
        <Stat label="CDR total length" value={`${p.cdrLength} aa`} />
        <Stat label="CDR-H3 length" value={p.cdrH3Length === null ? '–' : `${p.cdrH3Length} aa`} />
        <Stat label="Hydrophobic CDR fraction" value={`${fmt(p.hydrophobicCdrFraction * 100, 0)} %`} />
      </div>
      <div className="cols-3">
        <Stat label="Net CDR charge (pH 7.4)" value={fmt(p.cdrCharge, 2)} />
        <Stat label="Hydrophobic clusters" value={String(p.hydrophobicClusters)} hint="runs of four or more AVILMFWY residues touching a CDR" />
        <Stat label="GRAVY" value={fmt(p.gravy, 3)} hint="Kyte–Doolittle" />
      </div>
      {flags.length > 0 ? flags.map((f, i) => <Callout key={i} kind={f.level === 'warn' ? 'warn' : undefined}><b>{f.chain}:</b> {f.text}</Callout>) : <Callout>No rule-of-thumb flags were triggered.</Callout>}
      <Card title="Sequence liabilities" sub={`${all.length} motif(s)`} pad={false}>
        <DataTable limit={100} rowKey={(l, i) => `${l.chain}-${l.kind}-${l.position}-${i}`} rows={all} cols={[
          { key: 'chain', label: 'Chain' }, { key: 'kind', label: 'Liability' }, { key: 'motif', label: 'Motif' }, { key: 'position', label: 'Position', num: true },
          { key: 'region', label: 'Region' }, { key: 'risk', label: 'Risk', render: (l) => <span style={{ color: colour(l.risk) }}>{l.risk}</span> },
          { key: 'note', label: 'Note' }]} />
        <div className="row" style={{ padding: 10 }}><button className="btn sm" onClick={() => downloadText('developability_liabilities.csv', toCsv(all.map((l) => ({ chain: l.chain, liability: l.kind, motif: l.motif, position: l.position, region: l.region, risk: l.risk, note: l.note ?? '' }))), 'text/csv')}>Export liabilities (CSV)</button></div>
      </Card>
      <Card title="What the flags mean"><div className="faint" style={{ fontSize: 12 }}>The thresholds are published rules of thumb, not validated cut-offs: an Fv pI above 9.5 or below 6, a CDR-H3 longer than 20 residues, more than two hydrophobic CDR clusters, and a net CDR charge outside ±2. They direct attention; they do not predict a developability outcome.</div></Card>
    </div>
  );
}
