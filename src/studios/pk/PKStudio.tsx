import { lazy, Suspense, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';

const NcaTab = lazy(() => import('./NcaTab'));
const SimulateTab = lazy(() => import('./SimulateTab'));
const DosingTab = lazy(() => import('./DosingTab'));

type Tab = 'nca' | 'simulate' | 'dosing';

export default function PKStudio() {
  const [tab, setTab] = useState<Tab>('nca');
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>PK Studio</h1><p>Non-compartmental analysis of concentration–time data, closed-form one- and two-compartment simulations, and multiple-dose regimens with steady-state predictions. All calculations run in your browser.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'nca', label: 'Non-compartmental' }, { id: 'simulate', label: 'Simulate' }, { id: 'dosing', label: 'Dosing regimens' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'nca' && <NcaTab />}
        {tab === 'simulate' && <SimulateTab />}
        {tab === 'dosing' && <DosingTab />}
      </Suspense>
      <Callout kind="warn">Educational and research tool. NCA results depend on sampling; this is not a validated clinical pharmacology package (use Phoenix WinNonlin, PKNCA or NONMEM for regulated work).</Callout>
    </div>
  );
}
