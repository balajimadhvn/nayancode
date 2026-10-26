import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { Flagstat } from '../genome/mapping';
import { Callout, Tabs } from '@/ui/kit';

export interface AlignmentHand {
  sam: string;
  label: string;
  refName: string;
  refLength: number;
  flag: Flagstat | null;
  bam?: Uint8Array;
  bai?: Uint8Array;
}

export const COUNTS_NOTE = 'Read counting follows featureCounts-style unique assignment; peak calling follows the MACS local-lambda model. Results can differ slightly from the original tools. Always inspect peaks in a genome browser.';

const AlignTab = lazy(() => import('./AlignTab'));
const GeneCountsTab = lazy(() => import('./GeneCountsTab'));
const PeaksTab = lazy(() => import('./PeaksTab'));

type Tab = 'align' | 'genes' | 'peaks';
const L = ({ children }: { children: ReactNode }) => <Suspense fallback={<div className="faint" style={{ padding: 24 }}>Loading tab…</div>}>{children}</Suspense>;

export default function CountsStudio() {
  const [tab, setTab] = useState<Tab>('align');
  const [alignment, setAlignment] = useState<AlignmentHand | null>(null);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Counts &amp; Peaks Studio</h1><p>Align reads, count them per gene for RNA-seq, and call MACS-style enriched regions for ChIP-seq, ATAC-seq and CUT&amp;Tag. Everything runs in your browser; your files are not uploaded.</p></div></div>
      <Callout>{COUNTS_NOTE}</Callout>
      <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'align', label: 'Align' }, { id: 'genes', label: 'Gene counts' }, { id: 'peaks', label: 'Peaks' }]} />
      <L>
        {tab === 'align' && <AlignTab alignment={alignment} setAlignment={setAlignment} onUse={(t) => setTab(t)} />}
        {tab === 'genes' && <GeneCountsTab alignment={alignment} />}
        {tab === 'peaks' && <PeaksTab alignment={alignment} />}
      </L>
    </div>
  );
}
