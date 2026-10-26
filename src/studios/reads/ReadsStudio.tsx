import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { FastqRecord } from './fastq';
import { syntheticFastq } from './sim';
import { Callout, Card, Tabs } from '@/ui/kit';

export interface ReadsSource { files: File[]; label: string; demo: FastqRecord[] | null }

const InspectTab = lazy(() => import('./InspectTab'));
const TrimTab = lazy(() => import('./TrimTab'));
const MergeTab = lazy(() => import('./MergeTab'));
const PairsToolsTab = lazy(() => import('./PairsToolsTab'));
const KmerTab = lazy(() => import('./KmerTab'));

type Tab = 'inspect' | 'trim' | 'merge' | 'tools' | 'kmer';
const L = ({ children }: { children: ReactNode }) => <Suspense fallback={<div className="faint" style={{ padding: 24 }}>Loading tab…</div>}>{children}</Suspense>;

export default function ReadsStudio() {
  const [src, setSrc] = useState<ReadsSource | null>(null);
  const [tab, setTab] = useState<Tab>('inspect');

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const arr = [...files].slice(0, 2);
    setSrc({ files: arr, label: arr.length === 2 ? `${arr[0].name} + ${arr[1].name} (paired-end)` : arr[0].name, demo: null });
    setTab('inspect');
  };
  const demo = () => {
    const rows = syntheticFastq(20_000, 12);
    setSrc({ files: [], label: 'SYNTHETIC demo (20,000 reads)', demo: rows });
    setTab('inspect');
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Reads Studio</h1><p>Stream FASTQ from your disk to inspect, trim and filter, merge pairs, deduplicate, subsample, demultiplex and count k-mers. No upload, no server.</p></div></div>
      <Card title="1 · Data">
        <div className="stack" style={{ gap: 10 }}>
          <label className="dropzone">
            <input type="file" multiple accept=".fastq,.fq,.fastq.gz,.fq.gz,.gz" hidden onChange={(e) => onFiles(e.target.files)} />
            {src ? `Loaded: ${src.label}` : 'Choose one FASTQ(.gz), or two for paired-end'}
            <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Sequences and qualities are read in your browser. Nothing is uploaded.</div>
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={demo}>Load SYNTHETIC demo (20,000 reads)</button>
            {src && <button className="btn" onClick={() => setSrc(null)}>Clear</button>}
          </div>
          <div className="faint" style={{ fontSize: 11.5 }}>{src?.demo ? 'Synthetic reads: random sequence content with planted adapters, poly-G tails and a quality drop-off. Not a real sample.' : src?.files.length === 2 ? 'Paired-end mode: ids must match after stripping /1 and /2.' : src ? 'Single-end mode.' : 'A gzip file is detected from its first two bytes.'}</div>
        </div>
      </Card>
      <Callout>Streams from your disk in your browser; nothing is uploaded. A 5 GB FASTQ is possible in Chrome or Edge using Save-to-disk; other browsers keep output in memory. Results are for research use.</Callout>
      <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'inspect', label: 'Inspect' }, { id: 'trim', label: 'Trim & filter' }, { id: 'merge', label: 'Merge & deduplicate' }, { id: 'tools', label: 'Subsample & demultiplex' }, { id: 'kmer', label: 'k-mer spectrum' }]} />
      {!src ? <Card><div className="faint" style={{ padding: '30px 6px', textAlign: 'center' }}>Load a FASTQ file or the SYNTHETIC demo to begin.</div></Card> : (
        <L>
          {tab === 'inspect' && <InspectTab src={src} />}
          {tab === 'trim' && <TrimTab src={src} />}
          {tab === 'merge' && <MergeTab src={src} />}
          {tab === 'tools' && <PairsToolsTab src={src} />}
          {tab === 'kmer' && <KmerTab src={src} />}
        </L>
      )}
    </div>
  );
}
