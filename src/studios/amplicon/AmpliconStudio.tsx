import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Callout, Tabs } from '@/ui/kit';
import { PRIMER_F, PRIMER_R, type AmpliconDemo } from './simAmplicon';
import type { AmpliconResult } from './pipeline';

export interface AmpliconSource { name: string; r1?: File; r2?: File }
export interface AmpliconInput { kind: 'demo' | 'files'; label: string; sources: AmpliconSource[]; demo: AmpliconDemo | null }
export interface AmpliconSettings { fwd: string; rev: string; maxEE: number; minSize: number }

export const AMPLICON_NOTE = 'ASV inference follows UNOISE-style rules and a RDP-style classifier; results can differ from DADA2/QIIME 2. Taxonomy is only as good as the reference you provide.';

const ReadsTab = lazy(() => import('./ReadsTab'));
const AsvsTab = lazy(() => import('./AsvsTab'));
const TaxonomyTab = lazy(() => import('./TaxonomyTab'));
const TableTab = lazy(() => import('./TableTab'));
const L = ({ children }: { children: ReactNode }) => <Suspense fallback={<div className="faint" style={{ padding: 24 }}>Loading tab…</div>}>{children}</Suspense>;

type Tab = 'reads' | 'asvs' | 'taxonomy' | 'table';

export default function AmpliconStudio() {
  const [input, setInput] = useState<AmpliconInput | null>(null);
  const [settings, setSettings] = useState<AmpliconSettings>({ fwd: PRIMER_F, rev: PRIMER_R, maxEE: 1, minSize: 8 });
  const [reference, setReference] = useState('');
  const [referenceName, setReferenceName] = useState('');
  const [result, setResult] = useState<AmpliconResult | null>(null);
  const [tab, setTab] = useState<Tab>('reads');

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Amplicon Studio</h1><p>16S/ITS reads to amplicon sequence variants, chimeras and a taxonomy table for the Microbiome Studio. Everything runs in your browser; nothing is uploaded.</p></div></div>
      <Callout>{AMPLICON_NOTE}</Callout>
      <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'reads', label: 'Reads' }, { id: 'asvs', label: 'ASVs' }, { id: 'taxonomy', label: 'Taxonomy' }, { id: 'table', label: 'Table' }]} />
      <L>
        {tab === 'reads' && <ReadsTab input={input} setInput={setInput} settings={settings} setSettings={setSettings} reference={reference} setReference={(t, n) => { setReference(t); setReferenceName(n); }} referenceName={referenceName} result={result} setResult={setResult} />}
        {tab === 'asvs' && <AsvsTab result={result} />}
        {tab === 'taxonomy' && <TaxonomyTab result={result} setResult={setResult} reference={reference} setReference={(t, n) => { setReference(t); setReferenceName(n); }} referenceName={referenceName} />}
        {tab === 'table' && <TableTab result={result} input={input} />}
      </L>
    </div>
  );
}
