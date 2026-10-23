import { useMemo, useState } from 'react';
import { Callout, Card, Field, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { CurvePlot, cssVar } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { oneCmtIV, oneCmtOral, oneCmtInfusion, twoCmtIV, type OneCompartmentIVParams, type OneCompartmentOralParams, type OneCompartmentInfusionParams, type TwoCompartmentIVParams } from './models';

type ModelType = 'one-cmt-iv' | 'one-cmt-oral' | 'one-cmt-infusion' | 'two-cmt-iv';

const LABELS: Record<ModelType, string> = {
  'one-cmt-iv': 'One-compartment IV bolus',
  'one-cmt-oral': 'One-compartment oral (Bateman)',
  'one-cmt-infusion': 'One-compartment IV infusion',
  'two-cmt-iv': 'Two-compartment IV bolus',
};

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange(v: number): void }) {
  return (
    <Field label={`${label} — ${fmt(value, 3)}`}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%' }} />
    </Field>
  );
}

export default function SimulateTab() {
  const [model, setModel] = useState<ModelType>('one-cmt-iv');
  const [tMax, setTMax] = useState(48);
  const nPoints = 240;
  const [logY, setLogY] = useState(true);
  const [iv, setIv] = useState<OneCompartmentIVParams>({ dose: 100, V: 10, k: 0.1 });
  const [oral, setOral] = useState<OneCompartmentOralParams>({ dose: 100, F: 1, V: 10, k: 0.1, ka: 1 });
  const [inf, setInf] = useState<OneCompartmentInfusionParams>({ rate: 10, T: 5, V: 10, k: 0.1 });
  const [two, setTwo] = useState<TwoCompartmentIVParams>({ dose: 100, V1: 10, k10: 0.1, k12: 0.5, k21: 0.3 });

  const curve = useMemo(() => {
    const times = Array.from({ length: nPoints }, (_, i) => (i / (nPoints - 1)) * tMax);
    const fn = model === 'one-cmt-iv' ? (t: number) => oneCmtIV(iv, t)
      : model === 'one-cmt-oral' ? (t: number) => oneCmtOral(oral, t)
        : model === 'one-cmt-infusion' ? (t: number) => oneCmtInfusion(inf, t)
          : (t: number) => twoCmtIV(two, t);
    const conc = times.map(fn);
    const cmax = Math.max(...conc), tmax = times[conc.indexOf(cmax)];
    const auc = times.reduce((a, t, i) => (i === 0 ? 0 : a + ((conc[i - 1] + conc[i]) / 2) * (t - times[i - 1])), 0);
    return { times, conc, cmax, tmax, auc };
  }, [model, tMax, nPoints, iv, oral, inf, two]);

  const series: CurveSeries[] = [{ name: LABELS[model], color: cssVar('--chart-a'), curve: curve.times.map((t, i) => ({ x: t, y: curve.conc[i] })) }];

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Model"><div className="stack" style={{ gap: 10 }}>
        <Field label="Compartment model"><select className="select" value={model} onChange={(e) => setModel(e.target.value as ModelType)}>{Object.entries(LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <div className="cols-2" style={{ gap: 8 }}>
          <Field label="Time range"><input className="input" type="number" min="1" value={tMax} onChange={(e) => setTMax(Math.max(1, Number(e.target.value)))} /></Field>
          <label className="row" style={{ gap: 6, alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={logY} onChange={(e) => setLogY(e.target.checked)} />Semi-log plot</label>
        </div>
      </div></Card>
      <Card title="2 · Parameters" sub="drag the sliders; the curve updates live"><div className="stack" style={{ gap: 8 }}>
        {model === 'one-cmt-iv' && <>
          <Slider label="Dose" value={iv.dose} min={1} max={500} step={1} onChange={(v) => setIv({ ...iv, dose: v })} />
          <Slider label="V" value={iv.V} min={1} max={100} step={0.5} onChange={(v) => setIv({ ...iv, V: v })} />
          <Slider label="k" value={iv.k} min={0.005} max={1} step={0.005} onChange={(v) => setIv({ ...iv, k: v })} />
          <div className="faint" style={{ fontSize: 12 }}>C(t) = (D/V)·e^(−kt) · CL = k·V = {fmt(iv.k * iv.V, 3)} · t½ = {fmt(Math.LN2 / iv.k, 2)}</div>
        </>}
        {model === 'one-cmt-oral' && <>
          <Slider label="Dose" value={oral.dose} min={1} max={500} step={1} onChange={(v) => setOral({ ...oral, dose: v })} />
          <Slider label="F" value={oral.F} min={0.05} max={1} step={0.05} onChange={(v) => setOral({ ...oral, F: v })} />
          <Slider label="V" value={oral.V} min={1} max={100} step={0.5} onChange={(v) => setOral({ ...oral, V: v })} />
          <Slider label="k" value={oral.k} min={0.005} max={1} step={0.005} onChange={(v) => setOral({ ...oral, k: v })} />
          <Slider label="ka" value={oral.ka} min={0.05} max={3} step={0.05} onChange={(v) => setOral({ ...oral, ka: v })} />
          <div className="faint" style={{ fontSize: 12 }}>C(t) = D·F·ka/[V(ka−k)]·(e^(−kt) − e^(−ka·t)); ka ≈ k uses the limit.</div>
        </>}
        {model === 'one-cmt-infusion' && <>
          <Slider label="Infusion rate" value={inf.rate} min={0.5} max={50} step={0.5} onChange={(v) => setInf({ ...inf, rate: v })} />
          <Slider label="Duration T" value={inf.T} min={0.5} max={48} step={0.5} onChange={(v) => setInf({ ...inf, T: v })} />
          <Slider label="V" value={inf.V} min={1} max={100} step={0.5} onChange={(v) => setInf({ ...inf, V: v })} />
          <Slider label="k" value={inf.k} min={0.005} max={1} step={0.005} onChange={(v) => setInf({ ...inf, k: v })} />
          <div className="faint" style={{ fontSize: 12 }}>During: C = R/(Vk)(1−e^(−kt)); after: C(T)·e^(−k(t−T)).</div>
        </>}
        {model === 'two-cmt-iv' && <>
          <Slider label="Dose" value={two.dose} min={1} max={500} step={1} onChange={(v) => setTwo({ ...two, dose: v })} />
          <Slider label="V1" value={two.V1} min={1} max={100} step={0.5} onChange={(v) => setTwo({ ...two, V1: v })} />
          <Slider label="k10" value={two.k10} min={0.005} max={1} step={0.005} onChange={(v) => setTwo({ ...two, k10: v })} />
          <Slider label="k12" value={two.k12} min={0.005} max={2} step={0.005} onChange={(v) => setTwo({ ...two, k12: v })} />
          <Slider label="k21" value={two.k21} min={0.005} max={2} step={0.005} onChange={(v) => setTwo({ ...two, k21: v })} />
          <div className="faint" style={{ fontSize: 12 }}>C(t) = A·e^(−αt) + B·e^(−βt); α and β solve x² − (k10+k12+k21)x + k10·k21 = 0.</div>
        </>}
      </div></Card>
    </div>
    <div className="stack">
      <div className="cols-3"><Stat label="Cmax" value={fmt(curve.cmax, 3)} /><Stat label="Tmax" value={fmt(curve.tmax, 3)} hint="from the simulated grid" /><Stat label="AUC (trapezoid)" value={fmt(curve.auc, 2)} hint="over the simulated range" /></div>
      <Card title={`Concentration–time: ${LABELS[model]}`}><CurvePlot spec={{ series, xLabel: 'Time', yLabel: 'Concentration', yMin: 0, logY }} height={380} exportName="pk-simulate" /></Card>
      <div className="row"><button className="btn sm" onClick={() => downloadText('pk_simulation.csv', toCsv(curve.times.map((t, i) => ({ time: t, conc: curve.conc[i] }))), 'text/csv')}>Export CSV</button></div>
      <Callout><div>Closed-form forward simulation, not a fit. Parameters are yours to choose; nothing is estimated from data here. Superposition on the next tab assumes linear PK.</div></Callout>
    </div></div>
  );
}
