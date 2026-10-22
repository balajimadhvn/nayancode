import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { catalyticEfficiency, demoInhibition, demoKinetics, fitInhibition, fitKinetics, kcat, linearisations, michaelisMenten, parseKinetics, type InhibitionModel, type KineticsFit, type SingleModel } from './kinetics';

const TOOL: ToolInfo = { id: 'lab.kinetics', name: 'Enzyme kinetics', version: '0.1.0', engine: 'TypeScript (Levenberg–Marquardt)', citations: ['michaelis1913', 'cleland1963', 'marquardt1963'], describe: (p) => `Initial-rate enzyme kinetics were fitted by non-linear least squares (${p.model})${p.inhibitor ? `; inhibitor type was compared by AIC (best: ${p.best})` : ''}` };

const SINGLE: [SingleModel, string][] = [['mm', 'Michaelis–Menten'], ['substrate', 'Substrate inhibition'], ['hill', 'Hill']];
const INHIB: [InhibitionModel, string][] = [['competitive', 'Competitive'], ['noncompetitive', 'Non-competitive'], ['uncompetitive', 'Uncompetitive'], ['mixed', 'Mixed']];

export default function Kinetics() {
  const [text, setText] = useState(''), [model, setModel] = useState<SingleModel>('mm'), [inhModel, setInhModel] = useState<InhibitionModel>('competitive');
  const [enzyme, setEnzyme] = useState(''), [res, setRes] = useState<{ single: KineticsFit | null; inh: KineticsFit[]; err: string; data: string } | null>(null);
  const { run, error } = useRunner(), cols = [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d')];
  const parsed = useMemo(() => { try { return text ? parseKinetics(text) : null; } catch (e) { return { err: (e as Error).message }; } }, [text]);
  const ok = parsed && !('err' in parsed) ? parsed : null;

  const compute = (data: string) => {
    let p: ReturnType<typeof parseKinetics>;
    try { p = parseKinetics(data); } catch (e) { setRes({ single: null, inh: [], err: (e as Error).message, data }); return; }
    const s: KineticsFit[] = [];
    const zeros = p.rows.filter((r) => r.I === 0);
    if (zeros.length >= 4) {
      try { s.push(fitKinetics(zeros.map((r) => r.S), zeros.map((r) => r.v), model)); } catch (e) { setRes({ single: null, inh: [], err: (e as Error).message, data }); return; }
    }
    const fits: KineticsFit[] = [];
    if (p.hasInhibitor) for (const m of INHIB.map(([id]) => id)) { try { fits.push(fitInhibition(p.rows, m)); } catch { /* model needs more rows */ } }
    setRes({ single: s[0] ?? null, inh: fits, err: s.length || fits.length ? '' : 'Not enough rows for the selected model.', data });
  };

  const go = () => {
    if (!ok) return;
    void run({ label: `Enzyme kinetics · ${ok.rows.length} points`, tool: TOOL, params: { model, inhibitor: ok.hasInhibitor ? inhModel : '', best: '' }, inputs: [{ name: 'kinetics', data: text }], run: async () => { compute(text); return ok.rows.length; },
      summary: () => `Initial-rate kinetics were fitted by non-linear least squares (${SINGLE.find((s) => s[0] === model)![1]})` });
  };
  const demo = (data: string) => { setText(data); compute(data); };
  const fitted = res?.single && res.data ? (() => {
    const p = parseKinetics(res.data), zeros = p.rows.filter((r) => r.I === 0), S = zeros.map((r) => r.S).sort((a, b) => a - b);
    const lo = Math.min(...S) / 2, hi = Math.max(...S) * 2;
    return Array.from({ length: 120 }, (_, i) => { const x = Math.exp(Math.log(lo) + ((Math.log(hi) - Math.log(lo)) * i) / 119); return { x, y: res.single!.model === 'hill' ? (res.single!.vmax * x ** res.single!.params[2].value) / (res.single!.km ** res.single!.params[2].value + x ** res.single!.params[2].value) : michaelisMenten([res.single!.vmax, res.single!.km], x) }; });
  })() : undefined;
  const points = ok ? ok.rows.filter((r) => r.I === 0).map((r) => ({ x: r.S, y: r.v })) : [];
  const series: CurveSeries[] = points.length ? [{ name: 'Initial rates', color: cols[0], points, curve: fitted }] : [];
  const e = Number(enzyme);
  const best = res?.inh.length ? res.inh.reduce((a, b) => (b.aic < a.aic ? b : a)) : null;
  const lin = res?.single && res.data ? (() => { const p = parseKinetics(res.data); return linearisations(p.rows.filter((r) => r.I === 0).map((r) => r.S), p.rows.filter((r) => r.I === 0).map((r) => r.v)); })() : [];

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Initial-rate data"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setText(t); setRes(null); }} label={text ? 'Data loaded' : 'CSV: S,v (single substrate) or S,I,v (inhibitor series)'} />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => demo(demoKinetics())}>Load demo (Michaelis–Menten, 3 replicates)</button>
          <button className="btn" onClick={() => demo(demoInhibition())}>Load demo (inhibitor series)</button>
        </div>
        <textarea className="input mono" rows={6} style={{ fontSize: 12 }} value={text} onChange={(e2) => { setText(e2.target.value); setRes(null); }} placeholder={'S,v\n0.5,9.1\n1,16.7\n2,28.6'} />
        {parsed && 'err' in parsed && <Callout kind="err">{parsed.err}</Callout>}
        {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.rows.length} points{ok.hasInhibitor ? ` · ${new Set(ok.rows.map((r) => r.I)).size} inhibitor concentrations` : ''}{ok.skipped ? ` · ${ok.skipped} rows skipped` : ''}. Rows with I = 0 are used for the single-substrate fit.</div>}
      </div></Card>
      <Card title="2 · Model"><div className="stack" style={{ gap: 10 }}>
        <Field label="Single-substrate model"><select className="select" value={model} onChange={(ev) => setModel(ev.target.value as SingleModel)}>{SINGLE.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field>
        {ok?.hasInhibitor && <Field label="Inhibition model"><select className="select" value={inhModel} onChange={(ev) => setInhModel(ev.target.value as InhibitionModel)}>{INHIB.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field>}
        <Field label="Enzyme concentration [E] (optional, for kcat)"><input className="input" value={enzyme} onChange={(ev) => setEnzyme(ev.target.value)} placeholder="same unit as Vmax" /></Field>
        <button className="btn primary" disabled={!ok} onClick={go}>Fit</button>{error && <Callout kind="err">{error}</Callout>}
      </div></Card>
      <Callout><div>Initial-rate data only. Check that substrate depletion is below 10 % and that rates are linear in time.</div></Callout>
    </div>
    <div className="stack">
      {res?.err && <Callout kind="err">{res.err}</Callout>}
      {!res && <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load initial-rate data (or a demo) and fit.</div></Card>}
      {res?.single && <div className="cols-3">
        <Stat label="Vmax" value={fmt(res.single.vmax, 3)} hint={`95 % CI ${fmt(res.single.params[0].lo, 3)} to ${fmt(res.single.params[0].hi, 3)}`} />
        <Stat label="Km" value={fmt(res.single.km, 3)} hint={`95 % CI ${fmt(res.single.params[1].lo, 3)} to ${fmt(res.single.params[1].hi, 3)}`} />
        {res.single.model === 'hill' ? <Stat label="Hill n" value={fmt(res.single.params[2].value, 3)} /> : res.single.model === 'substrate' ? <Stat label="Ksi" value={fmt(res.single.params[2].value, 3)} /> : <Stat label="R²" value={fmt(res.single.r2, 4)} />}
      </div>}
      {res?.single && e > 0 && <div className="cols-3"><Stat label="kcat" value={`${sci(kcat(res.single.vmax, e))} /time`} hint={`Vmax/[E] with [E] = ${e}`} /><Stat label="kcat/Km" value={sci(catalyticEfficiency(res.single.vmax, res.single.km, e))} hint="specificity constant (inverse time · concentration)" /></div>}
      {res?.single && <Card title="Fit" sub={`${res.single.label} · n = ${res.single.n}`}>
        {series.length > 0 && <CurvePlot spec={{ series, xLabel: '[S]', yLabel: 'Initial rate v', logX: true }} height={300} exportName="enzyme-kinetics" />}
        <DataTable rowKey={(r) => r.name} rows={res.single.params} cols={[{ key: 'name', label: 'Parameter' }, { key: 'value', label: 'Estimate', num: true, render: (r) => fmt(r.value, 4) }, { key: 'se', label: 'SE', num: true, render: (r) => fmt(r.se, 4) }, { key: 'ci', label: '95 % CI', num: true, render: (r) => `${fmt(r.lo, 3)} – ${fmt(r.hi, 3)}` }]} />
        <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => downloadText('kinetics_fit.csv', toCsv(res.single!.params.map((p) => ({ model: res.single!.model, parameter: p.name, estimate: p.value, se: p.se, ci_lo: p.lo, ci_hi: p.hi }))), 'text/csv')}>Export fit (CSV)</button></div>
      </Card>}
      {lin.length > 0 && <Card title="Linearised forms (display only)" sub="linear transforms distort errors; the non-linear fit above is preferred">
        <DataTable rowKey={(r) => r.kind} rows={lin} cols={[{ key: 'kind', label: 'Plot' }, { key: 'slope', label: 'Slope', num: true, render: (r) => fmt(r.slope, 4) }, { key: 'intercept', label: 'Intercept', num: true, render: (r) => fmt(r.intercept, 4) }, { key: 'r2', label: 'R²', num: true, render: (r) => fmt(r.r2, 4) }, { key: 'vmax', label: 'Vmax', num: true, render: (r) => fmt(r.vmax, 3) }, { key: 'km', label: 'Km', num: true, render: (r) => fmt(r.km, 3) }]} />
      </Card>}
      {res && res.inh.length > 0 && <Card title="Inhibition type (global fit)" sub="AIC comparison; lower is better">
        <DataTable rowKey={(r) => r.model} rows={[...res.inh].sort((a, b) => a.aic - b.aic)} cols={[
          { key: 'label', label: 'Model' }, { key: 'vmax', label: 'Vmax', num: true, render: (r) => fmt(r.vmax, 3) }, { key: 'km', label: 'Km', num: true, render: (r) => fmt(r.km, 3) },
          { key: 'ki', label: 'Ki', num: true, render: (r) => fmt(r.ki, 4) }, { key: 'rss', label: 'RSS', num: true, render: (r) => sci(r.rss) }, { key: 'aic', label: 'AIC', num: true, render: (r) => fmt(r.aic, 2) },
          { key: 'best', label: '', render: (r) => (r === best ? '← best' : '') }]} />
        {best && <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>The data are best described by {best.label.toLowerCase()} (Ki = {fmt(best.ki, 4)}). AIC differences below about 2 are not meaningful.</div>}
      </Card>}
    </div></div>
  );
}
