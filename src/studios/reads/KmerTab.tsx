import { useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { createRemote } from '@/compute/rpc';
import { Busy, Callout, Card, Field, Stat, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot } from '@/viz/charts';
import type { ReadsKernels, SpectrumResult } from './reads.worker';
import type { ReadsSource } from './ReadsStudio';

const remote = createRemote<ReadsKernels>(() => new Worker(new URL('./reads.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = {
  id: 'reads.kmer', name: 'Canonical k-mer spectrum', version: '0.1.0', engine: 'TypeScript streaming worker kernels',
  citations: ['edgar2015'],
  describe: (p) => `Canonical ${p.k}-mers were counted in up to ${p.reads} reads; the main coverage peak gave a genome-size estimate (repeats and heterozygosity bias it)`,
};

export default function KmerTab({ src }: { src: ReadsSource }) {
  const [k, setK] = useState(21), [maxReads, setMaxReads] = useState(20_000);
  const [res, setRes] = useState<SpectrumResult | null>(null);
  const { run, busy, progress, note, error } = useRunner();
  const go = () => void run({
    label: `k-mer spectrum · ${src.label}`, tool: TOOL, params: { k, reads: maxReads }, inputs: [{ name: src.label, data: src.label }],
    run: (h) => remote.spectrum({ file: src.files[0], demo: src.demo ?? undefined, k, maxReads }, { onProgress: h.onProgress }),
  }).then((r) => { if (r) setRes(r); });
  const points = res ? res.hist.filter(([c]) => c <= 500).map(([x, y]) => ({ x, y })) : [];
  return (
    <>
      <Card title="k-mer spectrum" sub="Canonical k-mers remove strand bias. Up to 20,000 reads are examined; the map is capped at 30 million distinct k-mers.">
        <div className="cols-2" style={{ gap: 10 }}>
          <Field label="k"><input className="input" type="number" min={5} max={51} value={k} onChange={(e) => setK(+e.target.value)} /></Field>
          <Field label="Reads to examine"><input className="input" type="number" value={maxReads} onChange={(e) => setMaxReads(+e.target.value)} /></Field>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy} onClick={go}>Run</button></div>
        {busy && <div style={{ marginTop: 10 }}><Busy progress={progress} note={note} /></div>}
        {error && <Callout kind="err">{error}</Callout>}
      </Card>
      {res && (
        <>
          <Card title="Coverage spectrum" sub="Distinct k-mers at each coverage; the tall right peak is the genomic coverage and the left shoulder is sequencing error.">
            <CurvePlot spec={{ series: [{ name: 'distinct k-mers', color: '--chart-a', points }], xLabel: 'coverage (reads)', yLabel: 'distinct k-mers', logY: true }} height={340} />
          </Card>
          <Card title="Genome-size estimate">
            <div className="cols-4">
              <Stat label="Distinct k-mers" value={res.distinct.toLocaleString()} />
              <Stat label="Total k-mers" value={res.totalKmers.toLocaleString()} />
              <Stat label="Coverage peak" value={res.estimate.peak.toLocaleString()} />
              <Stat label="Estimated size" value={`${fmt(res.estimate.genomeSize / 1e6, 2)} Mb`} />
            </div>
            {res.truncated && <Callout kind="warn">The k-mer table reached its 30 million-entry cap, so the estimate is based on a truncated spectrum and is a lower bound.</Callout>}
            <Callout>Estimate = (sum of coverage × distinct k-mers above the error valley) / peak coverage. Repeats, heterozygosity, contamination and uneven coverage bias this number; it is not an assembly or a clinical measurement.</Callout>
          </Card>
        </>
      )}
    </>
  );
}
