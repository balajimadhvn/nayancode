import { useState } from 'react';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, Stat, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, Histogram } from '@/viz/charts';
import type { ReadsKernels } from './reads.worker';
import type { StatsSummary } from './stats';
import type { ReadsSource } from './ReadsStudio';

const remote = createRemote<ReadsKernels>(() => new Worker(new URL('./reads.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = {
  id: 'reads.inspect', name: 'FASTQ inspection', version: '0.1.0', engine: 'TypeScript streaming worker kernels',
  citations: ['chen2018', 'ewing1998'],
  describe: (p) => `The first ${p.reads} reads were profiled for length, GC, per-position quality, N content and adapter contamination; files were read locally and not uploaded`,
};

export default function InspectTab({ src }: { src: ReadsSource }) {
  const { run, busy, progress, note, error } = useRunner();
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const go = () => void run({
    label: `FASTQ inspection · ${src.label}`, tool: TOOL, params: { reads: src.demo ? src.demo.length : 100_000 },
    inputs: [{ name: src.label, data: src.label }],
    run: (h) => remote.inspect({ file: src.files[0], demo: src.demo ?? undefined, maxReads: 100_000 }, { onProgress: h.onProgress }),
  }).then((r) => { if (r) setStats(r); });
  return (
    <>
      <Card title="Inspect" sub="The first 100,000 reads are streamed and profiled; nothing is stored." actions={<button className="btn primary" disabled={busy} onClick={go}>Run</button>}>
        {busy && <Busy progress={progress} note={note} />}
        {error && <Callout kind="err">{error}</Callout>}
        {stats && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="cols-4">
              <Stat label="Reads" value={stats.reads.toLocaleString()} />
              <Stat label="Bases" value={stats.bases.toLocaleString()} />
              <Stat label="Mean length" value={`${fmt(stats.meanLength, 1)} bp`} />
              <Stat label="GC" value={`${fmt(stats.gcPct, 1)}%`} />
            </div>
            <div className="cols-4">
              <Stat label="Q20 bases" value={`${fmt(stats.q20Pct, 1)}%`} />
              <Stat label="Q30 bases" value={`${fmt(stats.q30Pct, 1)}%`} />
              <Stat label="N bases" value={stats.nCount.toLocaleString()} />
              <Stat label="Adapter hits" value={`${fmt(stats.adapterHitPct, 1)}%`} />
            </div>
            {stats.adapterHitPct > 1 && <Callout>Adapter sequence is present in about {fmt(stats.adapterHitPct, 1)}% of reads. Use the Trim &amp; filter tab to remove it.</Callout>}
          </div>
        )}
      </Card>
      {stats && (
        <>
          <Card title="Mean quality by read position" sub="Phred score; positions beyond the longest read are omitted.">
            <CurvePlot spec={{ series: [{ name: 'mean Q', color: '--chart-a', points: stats.posMean.map((y, i) => ({ x: i + 1, y })) }], xLabel: 'position (bp)', yLabel: 'mean Phred score' }} />
          </Card>
          <Card title="Read length distribution">
            <Histogram values={stats.lengthHist.flatMap((b) => Array(Math.min(2000, b.count)).fill(b.length))} label="read length (bp)" bins={40} color="--chart-c" />
          </Card>
        </>
      )}
    </>
  );
}
