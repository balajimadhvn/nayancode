import { lazy, Suspense, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';

const FrequenciesTab = lazy(() => import('./FrequenciesTab'));
const FstTab = lazy(() => import('./FstTab'));
const StructureTab = lazy(() => import('./StructureTab'));
const DiversityTab = lazy(() => import('./DiversityTab'));

type Tab = 'frequencies' | 'fst' | 'structure' | 'diversity';

export default function PopulationGeneticsStudio() {
  const [tab, setTab] = useState<Tab>('frequencies');
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Population Genetics Studio</h1><p>Allele frequencies, Hardy–Weinberg equilibrium and LD; Weir–Cockerham Fst; genotype PCA and ADMIXTURE-style ancestry by EM; and Tajima's D for aligned sequences. All calculations run in your browser.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[
        { id: 'frequencies', label: 'Frequencies & HWE' },
        { id: 'fst', label: 'Differentiation (Fst)' },
        { id: 'structure', label: 'Structure (PCA & admixture)' },
        { id: 'diversity', label: 'Sequence diversity' },
      ]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'frequencies' && <FrequenciesTab />}
        {tab === 'fst' && <FstTab />}
        {tab === 'structure' && <StructureTab />}
        {tab === 'diversity' && <DiversityTab />}
      </Suspense>
      <Callout kind="warn">Exploratory population-genetic summaries. Fst and admixture depend on sampling and sample size; use PLINK/ADMIXTURE/STRUCTURE for publication analyses of large panels.</Callout>
    </div>
  );
}
