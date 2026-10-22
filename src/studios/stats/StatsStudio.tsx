import { lazy, Suspense, useState } from 'react';
import { Tabs } from '@/ui/kit';

type Tab = 'compare' | 'relations' | 'categorical' | 'multiple' | 'meta';
const Compare = lazy(() => import('./Compare'));
const Relationships = lazy(() => import('./Relationships'));
const Categorical = lazy(() => import('./Categorical'));
const MultipleTesting = lazy(() => import('./MultipleTesting'));
const MetaAnalysis = lazy(() => import('./MetaAnalysis'));

export default function StatsStudio() {
  const [tab, setTab] = useState<Tab>('compare');
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Statistics Studio</h1><p>Compare groups, fit relationships and contingency tables, correct for multiple testing, and pool studies in a meta-analysis with forest and funnel plots. Every statistic is checked against scipy or a published worked example.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[
        { id: 'compare', label: 'Compare groups' }, { id: 'relations', label: 'Relationships' }, { id: 'categorical', label: 'Categorical' },
        { id: 'multiple', label: 'Multiple testing' }, { id: 'meta', label: 'Meta-analysis' },
      ]} />
      <Suspense fallback={null}>
        {tab === 'compare' && <Compare />}{tab === 'relations' && <Relationships />}{tab === 'categorical' && <Categorical />}{tab === 'multiple' && <MultipleTesting />}{tab === 'meta' && <MetaAnalysis />}
      </Suspense>
    </div>
  );
}
