import { lazy, Suspense, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';
import ComputeBadge from '@/ui/ComputeBadge';
import type { Alignment } from '@/studios/sequence/kernels';
import type { Db } from './db';

export interface HitRow {
  rank: number;
  index: number;
  id: string;
  description: string;
  length: number;
  score: number;
  bits: number;
  e: number;
  identity: number | null;
}

export interface SearchResult {
  query: string;
  db: Db;
  rows: HitRow[];
  engine: 'gpu' | 'cpu';
  device: string;
  ms: number;
  gcups: number | null;
  residues: number;
  alignments: Record<number, Alignment>;
  note?: string;
}

export type EngineChoice = 'auto' | 'gpu' | 'cpu';

const SearchTab = lazy(() => import('./SearchTab'));
const HitsTab = lazy(() => import('./HitsTab'));

type Tab = 'search' | 'hits';

export default function SearchStudio() {
  const [tab, setTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [db, setDb] = useState<Db | null>(null);
  const [engine, setEngine] = useState<EngineChoice>('auto');
  const [result, setResult] = useState<SearchResult | null>(null);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div>
        <h1>Search Studio</h1>
        <p>Exhaustive Smith-Waterman protein similarity search on your own graphics card or processor. Your query and database stay in this browser.</p>
        <div style={{ marginTop: 8 }}><ComputeBadge /></div>
      </div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'search', label: 'Search' }, { id: 'hits', label: 'Hits' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'search' && <SearchTab query={query} setQuery={setQuery} db={db} setDb={setDb} engine={engine} setEngine={setEngine} onResults={(r) => { setResult(r); setTab('hits'); }} />}
        {tab === 'hits' && <HitsTab result={result} />}
      </Suspense>
      <Callout kind="warn">Exhaustive Smith-Waterman, no heuristics, so slower than BLAST on huge databases but more sensitive. E-values use published gapped BLOSUM62 parameters without edge-effect correction. Protein queries only. Results are research-grade and not clinical.</Callout>
    </div>
  );
}
