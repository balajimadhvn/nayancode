import { useEffect, useRef } from 'react';
import { Callout, Card, DataTable, Stat, downloadBlob, downloadText, fmt, toCsv, type Col } from '@/ui/kit';
import type { FcsFile } from './fcs';
import type { GateNode, GateStat } from './gate';
import DensityPlot from './DensityPlot';

interface Props {
  parsed: FcsFile | null;
  transformed: Record<string, Float64Array>;
  stats: GateStat[];
  gates: GateNode[];
  channels: string[];
  setChannels(c: string[]): void;
  gx: string; gy: string;
}

const EMPTY = new Float64Array(0);

/** Statistics tab: per-gate counts and per-channel median/mean/CV, CSV export and a PNG plot. */
export default function StatisticsTab({ parsed, transformed, stats, gates, channels, setChannels, gx, gy }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!parsed) return;
    const names = new Set(parsed.params.map((p) => p.name));
    if (channels.some((c) => !names.has(c))) setChannels(channels.filter((c) => names.has(c)));
  }, [parsed, channels, setChannels]);

  if (!parsed) return <Card title="Statistics"><div className="faint" style={{ padding: 24, textAlign: 'center' }}>Load an FCS file in the Data tab first.</div></Card>;

  const toggle = (name: string) => setChannels(channels.includes(name) ? channels.filter((c) => c !== name) : [...channels, name]);
  const selected = parsed.params.filter((p) => channels.includes(p.name));
  const total = parsed.tot;

  const cols: Col<GateStat>[] = [
    { key: 'name', label: 'Gate', render: (g) => g.name },
    { key: 'count', label: 'Events', num: true, sort: (g) => g.count, render: (g) => fmt(g.count, 0) },
    { key: 'pp', label: '% parent', num: true, sort: (g) => g.percentParent, render: (g) => `${fmt(g.percentParent, 1)} %` },
    { key: 'pt', label: '% total', num: true, sort: (g) => g.percentTotal, render: (g) => `${fmt(g.percentTotal, 2)} %` },
    ...selected.flatMap((p) => [
      { key: `med-${p.name}`, label: `Median ${p.name}`, num: true, sort: (g: GateStat) => g.channels[p.name]?.median ?? 0, render: (g: GateStat) => fmt(g.channels[p.name]?.median ?? 0, 1) },
      { key: `mean-${p.name}`, label: `Mean ${p.name}`, num: true, sort: (g: GateStat) => g.channels[p.name]?.mean ?? 0, render: (g: GateStat) => fmt(g.channels[p.name]?.mean ?? 0, 1) },
      { key: `cv-${p.name}`, label: `CV% ${p.name}`, num: true, sort: (g: GateStat) => g.channels[p.name]?.cv ?? 0, render: (g: GateStat) => `${fmt(g.channels[p.name]?.cv ?? 0, 1)} %` },
    ]),
  ];

  const csv = () => {
    const rows = stats.map((g) => {
      const row: Record<string, string | number> = {
        gate: g.name, type: g.type, parent: g.parent ?? '',
        count: g.count, percent_parent: Number(g.percentParent.toFixed(4)), percent_total: Number(g.percentTotal.toFixed(4)),
      };
      for (const p of selected) {
        const s = g.channels[p.name];
        row[`median_${p.name}`] = s ? Number(s.median.toFixed(4)) : '';
        row[`mean_${p.name}`] = s ? Number(s.mean.toFixed(4)) : '';
        row[`cv_${p.name}`] = s ? Number(s.cv.toFixed(4)) : '';
      }
      return row;
    });
    downloadText('flow-statistics.csv', toCsv(rows), 'text/csv');
  };

  const png = () => {
    const el = canvas.current;
    if (!el) return;
    el.toBlob((blob) => { if (blob) downloadBlob('flow-density.png', blob); }, 'image/png');
  };

  return (
    <div className="stack">
      <div className="cols-4">
        <Stat label="Events" value={fmt(total, 0)} hint="all acquired events" />
        <Stat label="Gates" value={fmt(stats.length, 0)} hint={`${stats.filter((s) => s.parent).length} nested`} />
        <Stat label="Channels" value={fmt(selected.length, 0)} hint="statistics columns" />
        <Stat label="In first gate" value={stats[0] ? fmt(stats[0].count, 0) : '—'} hint={stats[0]?.name ?? 'no gate yet'} />
      </div>

      <Card title="Channels" sub="Median, mean and CV% are computed on the compensated, untransformed values of the events in each gate.">
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          {parsed.params.map((p) => <label key={p.name} className="row" style={{ gap: 5, fontSize: 13 }}>
            <input type="checkbox" checked={channels.includes(p.name)} onChange={() => toggle(p.name)} /> <span className="mono">{p.name}</span>
          </label>)}
        </div>
        {!selected.length && <Callout>Choose at least one channel to add statistics columns.</Callout>}
      </Card>

      <Card title="Gate statistics" sub="Counts are parent-aware; % parent uses the parent gate count or all events for a root gate." pad={false} actions={
        <button className="btn sm" onClick={csv} disabled={!stats.length}>Download CSV</button>
      }>
        {!stats.length ? <div className="faint" style={{ padding: 20, textAlign: 'center' }}>No gates yet. Add a gate on the Gating tab.</div> : (
          <DataTable rows={stats} rowKey={(g) => g.id} cols={cols} />
        )}
      </Card>

      <Card title="Density plot" sub={`${gx} vs ${gy}, transformed`} actions={
        <button className="btn sm" onClick={png} disabled={!parsed}>Export PNG</button>
      }>
        <DensityPlot canvasRef={canvas} x={transformed[gx] ?? EMPTY} y={transformed[gy] ?? EMPTY} xLabel={gx} yLabel={gy}
          gates={gates.filter((g) => g.gate.x === gx && g.gate.y === gy).map((g) => ({ name: g.name, gate: g.gate }))} />
      </Card>
    </div>
  );
}
