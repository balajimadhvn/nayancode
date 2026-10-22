import { useState } from 'react';
import { Callout, Card, DataTable, Field, Stat, fmt } from '@/ui/kit';
import { oligoTm } from '@/studios/sequence/kernels';
import { findPrimerSites, type PrimerSite } from './annotate';
import type { PlasmidTabProps } from './PlasmidStudio';

export default function PrimersTab({ plasmid }: PlasmidTabProps) {
  const [primer, setPrimer] = useState('GTAAAACGACGGCCAGT'), [maxMm, setMaxMm] = useState('2');
  const [sites, setSites] = useState<PrimerSite[] | null>(null), [err, setErr] = useState('');
  const tm = primer.replace(/[^ACGTacgt]/g, '').length >= 8 ? oligoTm(primer) : null;
  const run = () => {
    try { setSites(findPrimerSites(plasmid.seq, primer, Math.max(0, Math.min(5, Number(maxMm) || 0)))); setErr(''); }
    catch (e) { setSites(null); setErr((e as Error).message); }
  };
  return (
    <div className="split"><div className="stack">
      <Card title="1 · Primer"><div className="stack" style={{ gap: 10 }}>
        <textarea className="input mono" rows={3} style={{ fontSize: 12 }} value={primer} onChange={(e) => { setPrimer(e.target.value); setSites(null); }} />
        <Field label="Mismatches allowed away from the 3′ end"><input className="input" value={maxMm} onChange={(e) => setMaxMm(e.target.value)} /></Field>
        <button className="btn primary" onClick={run}>Find binding sites</button>
        {err && <Callout kind="err">{err}</Callout>}
        <div className="faint" style={{ fontSize: 11.5 }}>The 3′ terminal 12 nt must match exactly; up to {maxMm} other positions may differ. Both strands are searched.</div>
      </div></Card>
      {tm && <div className="cols-3">
        <Stat label="Length" value={`${tm.length} nt`} />
        <Stat label="Tm (nearest-neighbour)" value={`${fmt(tm.tm, 1)} °C`} hint="SantaLucia 1998 unified parameters, 50 mM Na⁺, 1.5 mM Mg²⁺" />
        <Stat label="GC" value={`${fmt(tm.gc * 100, 1)} %`} hint={`3′ GC = ${fmt(tm.threePrimeGC * 100, 0)} %`} />
      </div>}
      {tm && (tm.hairpinRisk || tm.selfDimerRisk) && <Callout kind="warn">The primer may form a {tm.hairpinRisk ? 'hairpin' : ''}{tm.hairpinRisk && tm.selfDimerRisk ? ' and ' : ''}{tm.selfDimerRisk ? 'self-dimer' : ''}. Check the 3′ end in particular.</Callout>}
    </div>
    <div className="stack">
      {!sites ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Enter a primer and search.</div></Card> : sites.length === 0 ? <Callout kind="warn">No binding site found with these settings. Relax the mismatches or check the primer orientation.</Callout> : (
        <Card title="Binding sites" sub={`${sites.length} site(s)`} pad={false}>
          <DataTable rowKey={(s) => `${s.start}-${s.strand}`} rows={sites} cols={[
            { key: 'start', label: 'Start', num: true, render: (s) => fmt(s.start, 0) }, { key: 'end', label: 'End', num: true, render: (s) => fmt(s.end, 0) },
            { key: 'strand', label: 'Strand', render: (s) => (s.strand === 1 ? '+' : '−') }, { key: 'mm', label: 'Mismatches', num: true, render: (s) => fmt(s.mismatches, 0) },
            { key: 'seq', label: 'Site sequence' }]} />
        </Card>
      )}
      <Card title="Amplification check"><div className="faint" style={{ fontSize: 12 }}>For a PCR product, enter a forward and a reverse primer: the product runs from the forward site to the reverse site (reverse-strand coordinates are already converted to the top strand). A pair on opposite strands with the reverse primer downstream of the forward primer is the expected arrangement.</div></Card>
    </div></div>
  );
}
