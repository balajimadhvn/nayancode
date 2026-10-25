import { lazy, Suspense, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';

const Design = lazy(() => import('./Design'));
const InSilico = lazy(() => import('./InSilico'));
const Check = lazy(() => import('./Check'));

type Tab = 'design' | 'pcr' | 'check';
const WARNING = 'Rules-based design with a nearest-neighbour Tm; no genome-wide specificity search. Always BLAST primers against your genome and test them.';

export default function PrimerStudio() {
  const [tab, setTab] = useState<Tab>('design');

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Primer Studio</h1><p>Design PCR primer pairs around a target, predict amplicons with an in-silico PCR, and check primers for hairpins, self- and pair-dimers, GC clamps and homopolymers. Everything runs in your browser.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'design', label: 'Design' }, { id: 'pcr', label: 'In-silico PCR' }, { id: 'check', label: 'Check' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'design' && <Design />}
        {tab === 'pcr' && <InSilico />}
        {tab === 'check' && <Check />}
      </Suspense>
      <Callout kind="warn">{WARNING}</Callout>
    </div>
  );
}
