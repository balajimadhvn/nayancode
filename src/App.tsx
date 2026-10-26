import { Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { lazyRetry } from '@/core/lazy';
import { STUDIOS } from '@/core/studios';

const Shell = lazyRetry(() => import('@/ui/Shell').then((m) => ({ default: m.Shell })));
const Overview = lazyRetry(() => import('@/pages/Overview'));
const Licenses = lazyRetry(() => import('@/pages/Licenses'));
const Report = lazyRetry(() => import('@/pages/Report'));
const Atlas = lazyRetry(() => import('@/pages/Atlas'));
const ImportWizard = lazyRetry(() => import('@/pages/ImportWizard'));
const live: Record<string, ReturnType<typeof lazyRetry<() => React.JSX.Element>>> = {
  sequence: lazyRetry(() => import('@/studios/sequence/SequenceStudio')),
  expression: lazyRetry(() => import('@/studios/expression/ExpressionStudio')),
  chemistry: lazyRetry(() => import('@/studios/chemistry/ChemistryStudio')),
  structure: lazyRetry(() => import('@/studios/structure/StructureStudio')),
  docking: lazyRetry(() => import('@/studios/docking/DockingStudio')),
  phylo: lazyRetry(() => import('@/studios/phylo/PhyloStudio')),
  genome: lazyRetry(() => import('@/studios/genome/GenomeStudio')),
  variant: lazyRetry(() => import('@/studios/variants/VariantStudio')),
  singlecell: lazyRetry(() => import('@/studios/singlecell/SingleCellStudio')),
  microbiome: lazyRetry(() => import('@/studios/microbiome/MicrobiomeStudio')),
  lab: lazyRetry(() => import('@/studios/lab/LabStudio')),
  stats: lazyRetry(() => import('@/studios/stats/StatsStudio')),
  plasmid: lazyRetry(() => import('@/studios/plasmid/PlasmidStudio')),
  biologics: lazyRetry(() => import('@/studios/biologics/BiologicsStudio')),
  pk: lazyRetry(() => import('@/studios/pk/PKStudio')),
  trajectory: lazyRetry(() => import('@/studios/trajectory/TrajectoryStudio')),
  peptide: lazyRetry(() => import('@/studios/peptide/PeptideStudio')),
  popgen: lazyRetry(() => import('@/studios/popgen/PopulationGeneticsStudio')),
  omicsquant: lazyRetry(() => import('@/studios/omicsquant/OmicsQuantStudio')),
  amr: lazyRetry(() => import('@/studios/amr/AmrStudio')),
  crispr: lazyRetry(() => import('@/studios/crispr/CrisprStudio')),
  primer: lazyRetry(() => import('@/studios/primer/PrimerStudio')),
  enrich: lazyRetry(() => import('@/studios/enrich/EnrichStudio')),
  protocol: lazyRetry(() => import('@/studios/protocol/ProtocolStudio')),
  sanger: lazyRetry(() => import('@/studios/sanger/SangerStudio')),
  imagecount: lazyRetry(() => import('@/studios/imagecount/ImageCountStudio')),
  flow: lazyRetry(() => import('@/studios/flow/FlowStudio')),
  dynamics: lazyRetry(() => import('@/studios/dynamics/DynamicsStudio')),
  search: lazyRetry(() => import('@/studios/search/SearchStudio')),
  reads: lazyRetry(() => import('@/studios/reads/ReadsStudio')),
  amplicon: lazyRetry(() => import('@/studios/amplicon/AmpliconStudio')),
};

const Loading = () => <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', color: 'var(--text-faint)' }}>Loading…</div>;
const L = ({ children }: { children: ReactNode }) => <Suspense fallback={<Loading />}>{children}</Suspense>;

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <Routes>
        <Route element={<L><Shell /></L>}>
          <Route path="/" element={<L><Overview /></L>} />
          <Route path="/workbench" element={<Navigate to="/" replace />} />
          <Route path="/licenses" element={<L><Licenses /></L>} />
          <Route path="/report" element={<L><Report /></L>} />
          <Route path="/atlas" element={<L><Atlas /></L>} />
          <Route path="/import" element={<L><ImportWizard /></L>} />
          {STUDIOS.map((s) => { const C = live[s.id]; return <Route key={s.id} path={s.path} element={<C />} />; })}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
