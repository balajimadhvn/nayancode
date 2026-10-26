import { lazy, Suspense, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';
import ComputeBadge from '@/ui/ComputeBadge';

const LjTab = lazy(() => import('./LjTab'));
const GoTab = lazy(() => import('./GoTab'));

type Tab = 'lj' | 'go';

export default function DynamicsStudio() {
  const [tab, setTab] = useState<Tab>('lj');
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div>
        <h1>Dynamics Studio</h1>
        <p>A Lennard-Jones fluid and a coarse-grained C-alpha protein model, simulated on your own processor or graphics card. Nothing is uploaded.</p>
        <div style={{ marginTop: 8 }}><ComputeBadge /></div>
      </div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'lj', label: 'Argon fluid' }, { id: 'go', label: 'Protein folding (Go model)' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'lj' && <LjTab />}
        {tab === 'go' && <GoTab />}
      </Suspense>
      <Callout kind="warn">Educational and research-grade engines. The fluid is a classical Lennard-Jones model in reduced units; the folding model is a structure-based toy model of one known fold, not a force field for predicting structures or binding. For all-atom molecular dynamics use the Native MD tab, which needs the Nayancode Bridge.</Callout>
    </div>
  );
}
