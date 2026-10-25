import { lazy, Suspense, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';
import type { Protocol } from './format';
import { loadStore, saveStore, type NotebookEntry } from './store';

const MixTab = lazy(() => import('./MixTab'));
const ProtocolTab = lazy(() => import('./ProtocolTab'));
const NotebookTab = lazy(() => import('./NotebookTab'));

type Tab = 'mix' | 'protocol' | 'notebook';
const NOTE = "Templates are generic. Your lab's validated SOP and reagent datasheets take priority.";

export default function ProtocolStudio() {
  const [tab, setTab] = useState<Tab>('mix');
  const [initial] = useState(() => loadStore());
  const [protocols, setProtocols] = useState<Protocol[]>(initial.protocols);
  const [notebook, setNotebook] = useState<NotebookEntry[]>(initial.notebook);
  const [blocked, setBlocked] = useState(initial.blocked);
  const [protocol, setProtocol] = useState<Protocol>({ title: 'Untitled protocol', steps: [] });

  const persist = (nextProtocols: Protocol[], nextNotebook: NotebookEntry[]) => {
    setProtocols(nextProtocols); setNotebook(nextNotebook);
    setBlocked(!saveStore({ protocols: nextProtocols, notebook: nextNotebook }));
  };
  const saveProtocol = (p: Protocol) => {
    const next = protocols.some((x) => x.title === p.title) ? protocols.map((x) => (x.title === p.title ? p : x)) : [...protocols, p];
    persist(next, notebook);
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Protocol Studio</h1><p>Scale a master mix, run a checklist with per-step timers, and keep a dated local notebook. Templates and imported protocols stay in your browser.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'mix', label: 'Master mix' }, { id: 'protocol', label: 'Protocol' }, { id: 'notebook', label: 'Notebook' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'mix' && <MixTab />}
        {tab === 'protocol' && <ProtocolTab protocol={protocol} setProtocol={setProtocol} onSave={saveProtocol} blocked={blocked} />}
        {tab === 'notebook' && <NotebookTab entries={notebook} protocols={protocols} onChange={(next) => persist(protocols, next)} blocked={blocked} />}
      </Suspense>
      <Callout kind="warn">{NOTE}</Callout>
    </div>
  );
}
