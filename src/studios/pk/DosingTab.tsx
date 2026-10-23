import { useMemo, useState } from 'react';
import { Callout, Card, DataTable, Field, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { CurvePlot, cssVar } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { oneCmtIV, oneCmtOral, oneCmtInfusion, multipleDose, accumulationRatio, cssAvg, loadingDose, type OneCompartmentIVParams, type OneCompartmentOralParams, type OneCompartmentInfusionParams } from './models';

type ModelType = 'one-cmt-iv' | 'one-cmt-oral' | 'one-cmt-infusion';
const LABELS: Record<ModelType, string> = { 'one-cmt-iv': 'One-compartment IV bolus', 'one-cmt-oral': 'One-compartment oral (Bateman)', 'one-cmt-infusion': 'One-compartment IV infusion' };

export default function DosingTab() {
  const [model, setModel] = useState<ModelType>('one-cmt-iv');
  const [tau, setTau] = useState(12), [nDoses, setNDoses] = useState(5), [tMax, setTMax] = useState(72);
  const [logY, setLogY] = useState(true), [showSs, setShowSs] = useState(true);
  const [iv, setIv] = useState<OneCompartmentIVParams>({ dose: 100, V: 10, k: 0.1 });
  const [oral, setOral] = useState<OneCompartmentOralParams>({ dose: 100, F: 1, V: 10, k: 0.1, ka: 1 });
  const [inf, setInf] = useState<OneCompartmentInfusionParams>({ rate: 10, T: 5, V: 10, k: 0.1 });

  const { fn, k, V, F, dose } = useMemo(() => {
    if (model === 'one-cmt-iv') return { fn: (d: number, t: number) => oneCmtIV({ ...iv, dose: d }, t), k: iv.k, V: iv.V, F: 1, dose: iv.dose };
    if (model === 'one-cmt-oral') return { fn: (d: number, t: number) => oneCmtOral({ ...oral, dose: d }, t), k: oral.k, V: oral.V, F: oral.F, dose: oral.dose };
    return { fn: (_d: number, t: number) => oneCmtInfusion(inf, t), k: inf.k, V: inf.V, F: 1, dose: inf.rate * inf.T };
  }, [model, iv, oral, inf]);

  const curve = useMemo(() => {
    const times = Array.from({ length: 480 }, (_, i) => (i / 479) * tMax);
    return { times, conc: times.map((t) => multipleDose(fn, dose, tau, nDoses, t)) };
  }, [fn, dose, tau, nDoses, tMax]);

  const ss = useMemo(() => {
    if (!showSs) return null;
    const start = nDoses * tau, times = Array.from({ length: 240 }, (_, i) => start + (i / 239) * tau);
    return { times, conc: times.map((t) => multipleDose(fn, dose, tau, nDoses + 60, t)) };
  }, [showSs, fn, dose, tau, nDoses]);

  const series: CurveSeries[] = [{ name: `${nDoses} dose${nDoses > 1 ? 's' : ''} every ${fmt(tau, 1)} h`, color: cssVar('--chart-a'), curve: curve.times.map((t, i) => ({ x: t, y: curve.conc[i] })) }];
  if (ss) series.push({ name: 'Steady state (+60 doses)', color: cssVar('--chart-b'), curve: ss.times.map((t, i) => ({ x: t, y: ss.conc[i] })) });

  const CL = k * V, R = accumulationRatio(k, tau), avg = cssAvg(F, dose, CL, tau), ld = loadingDose(avg, V);
  const lastPeak = ss ? Math.max(...ss.conc) : Math.max(...curve.conc);
  const lastTrough = ss ? Math.min(...ss.conc) : Math.min(...curve.conc.slice(-48));
  const rows = Array.from({ length: nDoses }, (_, i) => {
    const t = (i + 1) * tau, pre = multipleDose(fn, dose, tau, i + 1, t - 1e-9), post = multipleDose(fn, dose, tau, i + 1, t);
    return { dose: i + 1, time: t, trough: pre, peakAfter: post };
  });

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Regimen"><div className="stack" style={{ gap: 10 }}>
        <Field label="Model"><select className="select" value={model} onChange={(e) => setModel(e.target.value as ModelType)}>{Object.entries(LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <div className="cols-2" style={{ gap: 8 }}>
          <Field label="Dosing interval τ"><input className="input" type="number" min="0.5" step="0.5" value={tau} onChange={(e) => setTau(Math.max(0.5, Number(e.target.value)))} /></Field>
          <Field label="Number of doses"><input className="input" type="number" min="1" max="200" value={nDoses} onChange={(e) => setNDoses(Math.max(1, Math.min(200, Math.round(Number(e.target.value)))))} /></Field>
        </div>
        <div className="cols-2" style={{ gap: 8 }}>
          <Field label="Simulate until (h)"><input className="input" type="number" min="1" value={tMax} onChange={(e) => setTMax(Math.max(1, Number(e.target.value)))} /></Field>
          <label className="row" style={{ gap: 6, alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={logY} onChange={(e) => setLogY(e.target.checked)} />Semi-log</label>
        </div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={showSs} onChange={(e) => setShowSs(e.target.checked)} />Show the steady-state interval (60 extra doses)</label>
      </div></Card>
      <Card title="2 · Parameters"><div className="stack" style={{ gap: 8 }}>
        {model === 'one-cmt-iv' && <>
          <Field label="Dose"><input className="input" type="number" min="1" value={iv.dose} onChange={(e) => setIv({ ...iv, dose: Number(e.target.value) })} /></Field>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="V"><input className="input" type="number" min="0.1" step="0.5" value={iv.V} onChange={(e) => setIv({ ...iv, V: Number(e.target.value) })} /></Field>
            <Field label="k"><input className="input" type="number" min="0.001" step="0.005" value={iv.k} onChange={(e) => setIv({ ...iv, k: Number(e.target.value) })} /></Field>
          </div>
        </>}
        {model === 'one-cmt-oral' && <>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Dose"><input className="input" type="number" min="1" value={oral.dose} onChange={(e) => setOral({ ...oral, dose: Number(e.target.value) })} /></Field>
            <Field label="F"><input className="input" type="number" min="0.05" max="1" step="0.05" value={oral.F} onChange={(e) => setOral({ ...oral, F: Number(e.target.value) })} /></Field>
          </div>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="V"><input className="input" type="number" min="0.1" step="0.5" value={oral.V} onChange={(e) => setOral({ ...oral, V: Number(e.target.value) })} /></Field>
            <Field label="k"><input className="input" type="number" min="0.001" step="0.005" value={oral.k} onChange={(e) => setOral({ ...oral, k: Number(e.target.value) })} /></Field>
          </div>
          <Field label="ka"><input className="input" type="number" min="0.001" step="0.05" value={oral.ka} onChange={(e) => setOral({ ...oral, ka: Number(e.target.value) })} /></Field>
        </>}
        {model === 'one-cmt-infusion' && <>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Rate"><input className="input" type="number" min="0.1" step="0.5" value={inf.rate} onChange={(e) => setInf({ ...inf, rate: Number(e.target.value) })} /></Field>
            <Field label="Duration T"><input className="input" type="number" min="0.1" step="0.5" value={inf.T} onChange={(e) => setInf({ ...inf, T: Number(e.target.value) })} /></Field>
          </div>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="V"><input className="input" type="number" min="0.1" step="0.5" value={inf.V} onChange={(e) => setInf({ ...inf, V: Number(e.target.value) })} /></Field>
            <Field label="k"><input className="input" type="number" min="0.001" step="0.005" value={inf.k} onChange={(e) => setInf({ ...inf, k: Number(e.target.value) })} /></Field>
          </div>
        </>}
      </div></Card>
      <Callout kind="warn">Superposition is exact only for linear PK (constant CL and V). It is not valid for saturable elimination or time-varying clearance. Loading dose is the amount that would give Css,avg immediately as an IV bolus.</Callout>
    </div>
    <div className="stack">
      <div className="cols-3">
        <Stat label="Accumulation ratio R" value={fmt(R, 3)} hint="R = 1/(1 − e^(−kτ))" />
        <Stat label="Css,avg" value={fmt(avg, 3)} hint="F·D/(CL·τ)" />
        <Stat label="Loading dose" value={fmt(ld, 3)} hint="Css,avg·V" />
      </div>
      <Card title={`Multiple-dose profile: ${LABELS[model]}`} sub={ss ? `steady-state peak ${fmt(lastPeak, 3)}, trough ${fmt(lastTrough, 3)}` : undefined}>
        <CurvePlot spec={{ series, xLabel: 'Time', yLabel: 'Concentration', yMin: 0, logY }} height={360} exportName="pk-dosing" />
      </Card>
      <Card title="Trough and peak after each dose"><DataTable rowKey={(r) => String(r.dose)} rows={rows} cols={[
        { key: 'dose', label: 'Dose #', num: true }, { key: 'time', label: 'Time', num: true, render: (r) => fmt(r.time, 2) },
        { key: 'trough', label: 'Pre-dose (trough)', num: true, render: (r) => fmt(r.trough, 4) }, { key: 'peakAfter', label: 'Immediately after', num: true, render: (r) => fmt(r.peakAfter, 4) },
      ]} />
        <div className="row" style={{ padding: 10 }}><button className="btn sm" onClick={() => downloadText('multiple_dose.csv', toCsv(curve.times.map((t, i) => ({ time: t, conc: curve.conc[i] }))), 'text/csv')}>Export profile CSV</button></div>
      </Card>
      <Callout><div>Fluctuation at steady state: {(Math.max(...(ss?.conc ?? curve.conc)) / Math.max(1e-12, avg) * 100).toFixed(0)} % of Css,avg at the peak. Use the NCA or Simulate tabs to check the underlying single-dose parameters.</div></Callout>
    </div></div>
  );
}
