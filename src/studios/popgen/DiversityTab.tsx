import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { demoAlignment } from './demo';
import { diversityStats, parseAlignedFasta, slidingDiversity, type DiversityStats, type WindowStats } from './diversity';

const TOOL: ToolInfo = {
  id: 'popgen.diversity', name: 'Sequence diversity', version: '0.1.0', engine: 'TypeScript', citations: ['tajima1989'],
  describe: (p) => `Segregating sites, mean pairwise differences π, Watterson's θW and Tajima's D for ${p.sequences} aligned sequences (${p.sites} sites), with a sliding window of ${p.window} bp.`,
};

interface Out { stats: DiversityStats; windows: WindowStats[] }

export default function DiversityTab() {
  const [text, setText] = useState('');
  const [window, setWindow] = useState('100');
  const [step, setStep] = useState('25');
  const [out, setOut] = useState<Out | null>(null);
  const { run, busy, error } = useRunner();

  const parsed = useMemo(() => {
    try { const records = text ? parseAlignedFasta(text) : []; return records.length ? records : null; } catch (e) { return { err: (e as Error).message }; }
  }, [text]);
  const ok = parsed && !('err' in parsed) ? parsed : null;
  const errMsg = parsed && 'err' in parsed ? parsed.err : null;

  const go = () => {
    if (!ok) return;
    const w = Math.max(1, Math.floor(Number(window) || 100)), s = Math.max(1, Math.floor(Number(step) || 25));
    void run({
      label: `Diversity · ${ok.length} sequences`, tool: TOOL, params: { sequences: ok.length, sites: ok[0].seq.length, window: w, step: s },
      inputs: [{ name: 'aligned FASTA', data: text }],
      run: async () => {
        const stats = diversityStats(ok.map((r) => r.seq));
        setOut({ stats, windows: slidingDiversity(ok.map((r) => r.seq), w, s) });
        return { S: stats.S, D: stats.D };
      },
      summary: () => 'Segregating sites, π, θW, Tajima’s D and sliding-window summaries',
    });
  };

  const piSeries: CurveSeries[] = out ? [{ name: 'π', color: cssVar('--chart-a'), points: out.windows.map((w) => ({ x: (w.start + w.end) / 2, y: w.pi })) }] : [];
  const dSeries: CurveSeries[] = out ? [{ name: "Tajima's D", color: cssVar('--chart-b'), points: out.windows.filter((w) => w.D !== null).map((w) => ({ x: (w.start + w.end) / 2, y: w.D as number })) }] : [];

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Aligned FASTA"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t) => { setText(t); setOut(null); }} label={text ? 'Alignment loaded' : 'Aligned FASTA (same length, gaps and N allowed)'} />
        <button className="btn" onClick={() => { setText(demoAlignment().text); setOut(null); }}>Load demo alignment</button>
        {errMsg && <Callout kind="err">{errMsg}</Callout>}
        {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.length} sequences · {ok[0].seq.length} sites</div>}
      </div></Card>
      {ok && <Card title="2 · Windows"><div className="cols-2" style={{ gap: 8 }}>
        <Field label="Window (bp)"><input className="input" value={window} onChange={(e) => setWindow(e.target.value)} /></Field>
        <Field label="Step (bp)"><input className="input" value={step} onChange={(e) => setStep(e.target.value)} /></Field>
        <button className="btn primary" disabled={busy} onClick={go} style={{ gridColumn: '1 / -1' }}>{busy ? 'Running…' : 'Summarise'}</button>
        {error && <Callout kind="err">{error}</Callout>}
      </div></Card>}
    </div>
    <div className="stack">
      {!out ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load an aligned FASTA (or the demo) and summarise diversity.</div></Card> : <>
        <div className="cols-4">
          <Stat label="Segregating sites" value={out.stats.S} hint="columns with ≥ 2 alleles" />
          <Stat label="π" value={fmt(out.stats.pi, 5)} hint="mean pairwise differences per site" />
          <Stat label="θW" value={fmt(out.stats.thetaW, 5)} hint="Watterson's estimator" />
          <Stat label="Tajima's D" value={out.stats.D === null ? '—' : fmt(out.stats.D, 3)} hint="null when S = 0" />
        </div>
        <Card title="Sliding-window π" sub={`${out.stats.usableSites} usable sites of ${out.stats.sites}`}>
          <CurvePlot spec={{ series: piSeries, xLabel: 'Position (bp)', yLabel: 'π', yMin: 0 }} height={280} exportName="popgen-pi-windows" />
        </Card>
        {dSeries[0]?.points?.length ? <Card title="Sliding-window Tajima's D">
          <CurvePlot spec={{ series: dSeries, xLabel: 'Position (bp)', yLabel: "Tajima's D" }} height={280} exportName="popgen-tajima-windows" />
        </Card> : null}
        <Card title="Windows" pad={false}>
          <DataTable rowKey={(w) => `${w.start}-${w.end}`} rows={out.windows} cols={[
            { key: 'start', label: 'Start', num: true },
            { key: 'end', label: 'End', num: true },
            { key: 'S', label: 'S', num: true },
            { key: 'pi', label: 'π', num: true, render: (w) => fmt(w.pi, 5) },
            { key: 'D', label: "Tajima's D", num: true, render: (w) => (w.D === null ? '—' : fmt(w.D, 3)) },
            { key: 'usable', label: 'usable sites', num: true, render: (w) => w.usableSites },
          ]} />
          <div className="row" style={{ padding: 10 }}>
            <button className="btn sm" onClick={() => downloadText('popgen_diversity_windows.csv', toCsv(out.windows.map((w) => ({ start: w.start, end: w.end, S: w.S, pi: w.pi, D: w.D ?? '', usable_sites: w.usableSites }))), 'text/csv')}>Export CSV</button>
          </div>
        </Card>
      </>}
    </div></div>
  );
}
