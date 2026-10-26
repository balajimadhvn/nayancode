import { useMemo } from 'react';
import { Card, DataTable, Stat, downloadText, fmt } from '@/ui/kit';
import { CurvePlot, cssVar } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { parseXvg, type XvgData } from '@/studios/trajectory/xvg';
import type { MdRunResult } from './mdRun';

const COLORS = () => [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d')];
const safe = (text: string | undefined): XvgData | null => {
  if (!text) return null;
  try { return parseXvg(text); } catch { return null; }
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const statRows = (data: XvgData | null) => {
  if (!data) return [];
  return data.series.map((ys, i) => ({
    name: data.legends[i] || `Series ${i + 1}`,
    mean: mean(ys),
    min: Math.min(...ys),
    max: Math.max(...ys),
  }));
};

export default function NativeMdResults({ result, onSend, onDelete }: {
  result: MdRunResult;
  onSend(): void;
  onDelete(): void;
}) {
  const cols = COLORS();
  const rmsd = useMemo(() => safe(result.xvg['rmsd.xvg']), [result]);
  const rmsf = useMemo(() => safe(result.xvg['rmsf.xvg']), [result]);
  const gyrate = useMemo(() => safe(result.xvg['gyrate.xvg']), [result]);
  const energy = useMemo(() => safe(result.xvg['energy.xvg']), [result]);
  const s = result.summary;

  const plot = (data: XvgData | null): CurveSeries[] => {
    if (!data) return [];
    return data.series.map((ys, i) => ({
      name: data.legends[i] || `Series ${i + 1}`,
      color: cols[i % cols.length],
      curve: data.x.map((x, k) => ({ x, y: ys[k] })),
    }));
  };

  const downloads = [
    ['rmsd.xvg', result.xvg['rmsd.xvg']],
    ['rmsf.xvg', result.xvg['rmsf.xvg']],
    ['gyrate.xvg', result.xvg['gyrate.xvg']],
    ['energy.xvg', result.xvg['energy.xvg']],
    ['traj.pdb', result.trajPdb],
    ['em.log', result.emLog],
  ] as const;

  return (
    <div className="stack" data-testid="md-result">
      <Card title="Results" sub={`job ${result.job} · ${(result.elapsedMs / 60000).toFixed(1)} min`}>
        <div className="cols-3" style={{ gap: 8 }}>
          <div data-testid="md-em"><Stat label="Final EM potential" value={s.emPotential === null ? '–' : `${fmt(s.emPotential, 0)} kJ/mol`} hint="from em.log" /></div>
          <div data-testid="md-temperature"><Stat label="Mean temperature" value={s.meanTemperature === null ? '–' : `${fmt(s.meanTemperature, 1)} K`} hint="production stage" /></div>
          <div data-testid="md-density"><Stat label="Mean density" value={s.meanDensity === null ? '–' : `${fmt(s.meanDensity, 0)} kg/m³`} hint="production stage" /></div>
          <div data-testid="md-rmsd"><Stat label="Final backbone RMSD" value={s.finalRmsd === null ? '–' : `${fmt(s.finalRmsd, 3)} nm`} hint="after fit to the first frame" /></div>
          <div data-testid="md-models"><Stat label="Trajectory frames" value={String(s.models)} hint="MODEL records in traj.pdb" /></div>
          <Stat label="Atoms in input" value={fmt(s.atoms, 0)} hint="protein plus crystallographic waters" />
        </div>
        {s.nvtPsPerMin !== null && <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>Measured speed in the NVT stage: {fmt(s.nvtPsPerMin, 2)} ps/min for the {fmt(s.mdPs, 1)} ps production run. Short runs only show stability, not converged sampling.</div>}
      </Card>

      <div className="split">
        <Card title="Backbone RMSD"><CurvePlot spec={{ series: plot(rmsd), xLabel: 'Time (ps)', yLabel: 'RMSD (nm)', yMin: 0 }} height={240} exportName="native-md-rmsd" /></Card>
        <Card title="Root-mean-square fluctuation"><CurvePlot spec={{ series: plot(rmsf), xLabel: 'Residue', yLabel: 'RMSF (nm)' }} height={240} exportName="native-md-rmsf" /></Card>
      </div>
      <div className="split">
        <Card title="Radius of gyration"><CurvePlot spec={{ series: plot(gyrate), xLabel: 'Time (ps)', yLabel: 'Rg (nm)' }} height={240} exportName="native-md-rg" /></Card>
        <Card title="Production energy terms"><CurvePlot spec={{ series: plot(energy), xLabel: 'Time (ps)', yLabel: 'GROMACS units' }} height={240} exportName="native-md-energy" /></Card>
      </div>
      <Card title="Energy-term statistics" pad={false}>
        <DataTable rowKey={(r) => r.name} rows={statRows(energy)} limit={20} cols={[
          { key: 'name', label: 'Term' },
          { key: 'mean', label: 'Mean', num: true, render: (r) => fmt(r.mean, 3) },
          { key: 'min', label: 'Min', num: true, render: (r) => fmt(r.min, 3) },
          { key: 'max', label: 'Max', num: true, render: (r) => fmt(r.max, 3) },
        ]} />
      </Card>
      <Card title="Downloads"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {downloads.map(([name, text]) => <button key={name} className="btn sm" disabled={!text} onClick={() => downloadText(name, text)}>Download {name}</button>)}
      </div></Card>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={!result.trajPdb} onClick={onSend}>Send trajectory to Trajectory Studio</button>
        <button className="btn" onClick={onDelete}>Delete job on my computer</button>
      </div>
    </div>
  );
}
