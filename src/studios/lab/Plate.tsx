import { useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { analysePlate, demoPlate, type CurveModel, type PlateResult } from './plate';

const TOOL: ToolInfo = { id: 'lab.plate', name: 'Plate reader / ELISA', version: '0.1.0', engine: 'TypeScript (Levenberg–Marquardt)', citations: ['marquardt1963', 'gottschalk2005'], describe: (p) => `Plates were blank-corrected and unknowns were back-calculated from a ${p.model} standard curve` };

export default function Plate() {
  const [plate, setPlate] = useState(''), [layout, setLayout] = useState(''), [model, setModel] = useState<CurveModel>('4PL');
  const [res, setRes] = useState<PlateResult | null>(null), [err, setErr] = useState(''), { run, error } = useRunner();
  const cols = [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c')];

  const compute = (p = plate, l = layout) => {
    try { setRes(analysePlate(p, l, { model })); setErr(''); } catch (e) { setRes(null); setErr((e as Error).message); }
  };
  const demo = () => { const d = demoPlate(); setPlate(d.plate); setLayout(d.layout); compute(d.plate, d.layout); };
  const go = () => void run({ label: 'Plate reader · standard curve', tool: TOOL, params: { model }, inputs: [{ name: 'plate', data: plate }, { name: 'layout', data: layout }], run: async () => { compute(); return res?.unknowns.length ?? 0; },
    summary: () => `Unknowns were back-calculated from a ${model} standard curve after blank subtraction` });
  const stdPts = res ? res.replicates.filter((r) => r.kind === 'std' && Number.isFinite(r.concentration)).map((r) => ({ x: r.concentration!, y: r.mean })).sort((a, b) => a.x - b.x) : [];
  const curve = res && stdPts.length ? Array.from({ length: 120 }, (_, i) => { const x = Math.exp(Math.log(stdPts[0].x / 2) + ((Math.log(stdPts[stdPts.length - 1].x * 2) - Math.log(stdPts[0].x / 2)) * i) / 119); return { x, y: res.curve.at(x) }; }) : undefined;
  const series: CurveSeries[] = stdPts.length ? [{ name: 'Standards', color: cols[0], points: stdPts, curve }] : [];

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Plate and layout"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setPlate(t); setRes(null); }} label={plate ? 'Plate loaded' : 'Plate CSV of raw absorbances (8×12 or 16×24)'} />
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setLayout(t); setRes(null); }} label={layout ? 'Layout loaded' : 'Layout CSV, same shape: blank, std:<conc>, unk:<name>[:<dilution>]'} />
        <button className="btn" onClick={demo}>Load demo plate</button>
        <textarea className="input mono" rows={3} style={{ fontSize: 11 }} value={plate} onChange={(e) => { setPlate(e.target.value); setRes(null); }} placeholder="plate CSV" />
        <textarea className="input mono" rows={3} style={{ fontSize: 11 }} value={layout} onChange={(e) => { setLayout(e.target.value); setRes(null); }} placeholder="layout CSV" />
        {err && <Callout kind="err">{err}</Callout>}
      </div></Card>
      <Card title="2 · Standard curve"><div className="stack" style={{ gap: 10 }}>
        <Field label="Model"><select className="select" value={model} onChange={(e) => { setModel(e.target.value as CurveModel); setRes(null); }}><option value="4PL">4PL (default)</option><option value="5PL">5PL</option><option value="linear">Linear</option></select></Field>
        <button className="btn primary" disabled={!plate || !layout} onClick={go}>Analyse plate</button>{error && <Callout kind="err">{error}</Callout>}
      </div></Card>
      <Callout><div>The blank mean is subtracted from every well. LOD = mean(blank) + 3·SD and LOQ = mean(blank) + 10·SD, converted to concentration through the standard curve. Unknowns outside the standard range are extrapolations.</div></Callout>
    </div>
    <div className="stack">
      {!res && !err && <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Drop a plate and its layout (or the demo) and analyse.</div></Card>}
      {res && <>
        {res.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}
        <div className="cols-3">
          <Stat label="Standard curve" value={`${res.curve.model} · R² ${fmt(res.curve.r2, 4)}`} hint={res.curve.note} />
          <Stat label="LOD (concentration)" value={Number.isFinite(res.lod) ? sci(res.lod) : '–'} hint={`blank ${fmt(res.blank.mean, 4)} ± ${fmt(res.blank.sd, 4)} (n = ${res.blank.n})`} />
          <Stat label="LOQ (concentration)" value={Number.isFinite(res.loq) ? sci(res.loq) : '–'} hint="10 × blank SD above the blank mean" />
        </div>
        <Card title="Standard curve" sub={`${res.curve.model} · blank-corrected`}>
          {series.length > 0 && <CurvePlot spec={{ series, xLabel: 'Concentration', yLabel: 'Blank-corrected absorbance', logX: true }} height={280} exportName="plate-standard-curve" />}
          <DataTable rowKey={(r) => r.label} rows={res.replicates.filter((r) => r.kind === 'std').sort((a, b) => (a.concentration ?? 0) - (b.concentration ?? 0))} cols={[
            { key: 'concentration', label: 'Standard', num: true, render: (r) => fmt(r.concentration ?? NaN, 4) }, { key: 'n', label: 'n', num: true },
            { key: 'mean', label: 'Mean A', num: true, render: (r) => fmt(r.mean, 4) }, { key: 'sd', label: 'SD', num: true, render: (r) => fmt(r.sd, 4) }, { key: 'cv', label: 'CV %', num: true, render: (r) => fmt(r.cv, 1) }]} />
          <div className="faint mono" style={{ marginTop: 6, fontSize: 12 }}>{res.curve.params.map((p) => `${p.name} = ${fmt(p.value, 4)}${Number.isFinite(p.se) ? ` ± ${fmt(p.se, 3)}` : ''}`).join(' · ')}</div>
        </Card>
        <Card title="Unknowns" pad={false}>
          <DataTable rowKey={(r) => r.label} rows={res.unknowns} cols={[
            { key: 'name', label: 'Sample' }, { key: 'dilution', label: 'Dilution', num: true, render: (r) => fmt(r.dilution ?? 1, 2) },
            { key: 'mean', label: 'Mean A', num: true, render: (r) => fmt(r.mean, 4) }, { key: 'cv', label: 'CV %', num: true, render: (r) => fmt(r.cv, 1) },
            { key: 'concRaw', label: 'Measured', num: true, render: (r) => (Number.isFinite(r.concRaw) ? sci(r.concRaw) : '–') },
            { key: 'conc', label: '× dilution', num: true, render: (r) => (Number.isFinite(r.conc) ? sci(r.conc) : '–') },
            { key: 'flag', label: 'Flag', render: (r) => [r.outOfRange ? 'extrapolated' : '', r.belowLod ? 'below LOD' : ''].filter(Boolean).join(', ') }]} />
          <div className="row" style={{ padding: 10 }}><button className="btn sm" onClick={() => downloadText('plate_results.csv', toCsv(res.unknowns.map((u) => ({ sample: u.name, dilution: u.dilution ?? 1, mean_absorbance: u.mean, sd: u.sd, cv_percent: u.cv, concentration_measured: u.concRaw, concentration_dilution_corrected: u.conc, extrapolated: u.outOfRange, below_lod: u.belowLod }))), 'text/csv')}>Export results (CSV)</button></div>
        </Card>
      </>}
    </div></div>
  );
}
