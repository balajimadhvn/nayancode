import { lazy, Suspense, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';
import { demoData } from './demo';
import type { GeneSet } from './gmt';

const GeneSets = lazy(() => import('./GeneSets'));
const Ora = lazy(() => import('./Ora'));
const Gsea = lazy(() => import('./Gsea'));

type Tab = 'sets' | 'ora' | 'gsea';
const WARNING = 'Enrichment results depend on the gene sets and background you choose; use the full list of tested genes as background. Gene identifiers must use the same naming as your sets.';

export default function EnrichStudio() {
  const [tab, setTab] = useState<Tab>('sets');
  const [sets, setSets] = useState<GeneSet[]>([]);
  const [source, setSource] = useState('');
  const [geneText, setGeneText] = useState('');
  const [backgroundText, setBackgroundText] = useState('');
  const [rankedText, setRankedText] = useState('');

  const loadDemo = () => {
    const d = demoData();
    setSets(d.sets); setSource('synthetic demo');
    setGeneText(d.listText); setRankedText(d.rankedText); setBackgroundText('');
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Enrichment Studio</h1><p>Import your own GMT gene sets, test a gene list for over-representation, and run pre-ranked GSEA with seeded permutations. Nothing is uploaded and no gene-set database is bundled.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'sets', label: 'Gene sets' }, { id: 'ora', label: 'Over-representation' }, { id: 'gsea', label: 'Pre-ranked GSEA' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'sets' && <GeneSets sets={sets} source={source} onSets={(s, name) => { setSets(s); setSource(name); }} onDemo={loadDemo} />}
        {tab === 'ora' && <Ora sets={sets} geneText={geneText} setGeneText={setGeneText} backgroundText={backgroundText} setBackgroundText={setBackgroundText} />}
        {tab === 'gsea' && <Gsea sets={sets} rankedText={rankedText} setRankedText={setRankedText} />}
      </Suspense>
      <Callout kind="warn">{WARNING}</Callout>
    </div>
  );
}
