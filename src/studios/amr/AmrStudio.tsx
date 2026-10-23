import { lazy, Suspense, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import type { AmrLibrary, AmrScreenResult } from './amr.worker';
import { remote, TOOL } from './remote';

const ScreenTab = lazy(() => import('./ScreenTab'));
const ResultsTab = lazy(() => import('./ResultsTab'));
const LibraryTab = lazy(() => import('./LibraryTab'));

type Tab = 'screen' | 'results' | 'library';
const WARNING = 'Nucleotide screening against the NCBI reference gene set. It finds acquired resistance genes in assembled DNA; it does not detect point mutations or predict phenotypes. Use AMRFinderPlus or ResFinder for clinical or surveillance reporting.';

export default function AmrStudio() {
  const [tab, setTab] = useState<Tab>('screen');
  const [file, setFile] = useState<File | null>(null);
  const [minIdentity, setMinIdentity] = useState(0.9);
  const [minCoverage, setMinCoverage] = useState(0.6);
  const [res, setRes] = useState<AmrScreenResult | null>(null);
  const [lib, setLib] = useState<AmrLibrary | null>(null);
  const { run, busy, progress, note, error, cancel } = useRunner();

  const thresholds = () => ({ minIdentity, minCoverage });
  const jobParams = () => ({ ...thresholds(), minSeeds: 6, k: 15 });
  const show = (r: AmrScreenResult | undefined) => { if (r) { setRes(r); setTab('results'); } };
  const brief = (r: AmrScreenResult) => `${r.hits.length} resistance-gene hit(s) in ${r.contigs.length} sequence(s) at ≥ ${Math.round(r.minIdentity * 100)} % identity and ≥ ${Math.round(r.minCoverage * 100)} % reference coverage, against ${r.references.toLocaleString()} reference genes (AMRFinderPlus database ${r.version})`;

  const screen = () => {
    if (!file) return;
    void run({
      label: `AMR screening · ${file.name}`, tool: TOOL, params: jobParams(),
      inputs: [{ name: 'assembly', data: `${file.name} (${file.size.toLocaleString()} bytes)` }],
      run: (h) => remote.screenAssembly({ source: { file }, ...thresholds() }, { onProgress: h.onProgress, signal: h.signal }),
      summary: brief,
    }).then(show);
  };

  const demo = (which: 'synthetic' | 'ecoli') => void run({
    label: `AMR screening · ${which === 'ecoli' ? 'E. coli K-12 demo' : 'synthetic demo contig'}`, tool: TOOL, params: jobParams(),
    inputs: [{ name: 'assembly', data: which === 'ecoli' ? 'bundled genome NC_000913.3 (Escherichia coli K-12 MG1655)' : 'synthetic 20 kb contig with five planted reference genes' }],
    run: (h) => remote.demo({ which, ...thresholds() }, { onProgress: h.onProgress, signal: h.signal }),
    summary: brief,
  }).then(show);

  const loadLibrary = () => void run({
    label: 'AMR reference library', tool: TOOL, params: { database: 'AMRFinderPlus reference genes' }, inputs: [],
    run: (h) => remote.library(undefined, { onProgress: h.onProgress, signal: h.signal }),
    summary: (r) => `Listed the ${r.rows.length.toLocaleString()} nucleotide reference genes of AMRFinderPlus database ${r.version} (${r.classes.length} drug classes); no assembly was screened.`,
  }).then((r) => r && setLib(r));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>AMR Studio</h1><p>Screen assembled contigs and draft bacterial genomes against the NCBI AMRFinderPlus reference gene set. Seeds, alignments and drug classes are all computed in your browser; the assembly never leaves the page.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'screen', label: 'Screen assembly' }, { id: 'results', label: 'Results' }, { id: 'library', label: 'Gene library' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'screen' && <ScreenTab file={file} setFile={setFile} minIdentity={minIdentity} setMinIdentity={setMinIdentity} minCoverage={minCoverage} setMinCoverage={setMinCoverage} busy={busy} progress={progress} note={note} error={error} cancel={cancel} screen={screen} demo={demo} />}
        {tab === 'results' && <ResultsTab res={res} />}
        {tab === 'library' && <LibraryTab lib={lib} busy={busy} progress={progress} note={note} error={error} load={loadLibrary} />}
      </Suspense>
      <Callout kind="warn">{WARNING}</Callout>
    </div>
  );
}
