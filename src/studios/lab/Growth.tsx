import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { demoGrowth, fitGrowth, gompertz, logisticGrowth, parseGrowth, type GrowthSeriesResult } from './growth';

const TOOL: ToolInfo = { id: 'lab.growth', name: 'Growth curves', version: '0.1.0', engine: 'TypeScript (Levenberg–Marquardt)', citations: ['zwietering1990'], describe: (p) => `Growth curves were fitted with the modified Gompertz and logistic models (Zwietering et al. 1990) on ln(OD/OD0)${p.best ? `; ${p.best} described the curves best by AIC` : ''}` };

export default function Growth() {
  const [text, setText] = useState(''), [blank, setBlank] = useState(''), [od0, setOd0] = useState(''), [res, setRes] = useState<{ t: number[]; rows: GrowthSeriesResult[]; err: string } | null>(null);
  const { run, error } = useRunner(), cols = [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d')];
  const parsed = useMemo(() => { try { return text ? parseGrowth(text) : null; } catch (e) { return { err: (e as Error).message }; } }, [text]);
  const ok = parsed && !('err' in parsed) ? parsed : null;

  const compute = (data: string) => {
    try {
      const p = parseGrowth(data), b = Number(blank);
      const rows = p.series.map((s) => {
        const od = s.od.map((v) => (Number.isFinite(b) && blank.trim() !== '' ? v - b : v));
        const fit = fitGrowth(p.t, od, od0.trim() ? Number(od0) : undefined);
        return { ...fit, name: s.name };
      });
      setRes({ t: p.t, rows, err: '' });
    } catch (e) { setRes({ t: [], rows: [], err: (e as Error).message }); }
  };
  const demo = () => { const d = demoGrowth(); setText(d); compute(d); };
  const go = () => void run({ label: 'Growth curves', tool: TOOL, params: { series: ok?.series.length ?? 0, best: res?.rows.map((r) => r.name + ':' + r.best).join(', ') ?? '' }, inputs: [{ name: 'growth', data: text }], run: async () => { compute(text); return ok?.series.length ?? 0; },
    summary: () => `Growth curves were fitted with the modified Gompertz and logistic models on ln(OD/OD0)` });

  const series: CurveSeries[] = res && ok && !res.err ? res.rows.map((r, i) => {
    const b = Number(blank), useBlank = blank.trim() !== '' && Number.isFinite(b);
    const s = ok.series.find((x) => x.name === r.name);
    const base = od0.trim() ? Number(od0) : Math.min(...(s?.od ?? []).filter((v) => v > 0));
    const pts = (s?.od ?? []).map((v, j) => ({ x: ok.t[j], y: Math.log((useBlank ? v - b : v) / base) })).filter((q) => Number.isFinite(q.y));
    const fit = r.best === 'gompertz' ? r.gompertz : r.logistic;
    const f = r.best === 'gompertz' ? gompertz : logisticGrowth;
    return { name: r.name, color: cols[i % cols.length], points: pts, curve: ok.t.map((t) => ({ x: t, y: f(fit.A, fit.mu, fit.lambda, t) })) };
  }) : [];

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Growth data"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setText(t); setRes(null); }} label={text ? 'Data loaded' : 'CSV: time, then one OD column per well/strain'} />
        <button className="btn" onClick={demo}>Load demo (two strains)</button>
        <textarea className="input mono" rows={5} style={{ fontSize: 11 }} value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} placeholder={'time,WT,mut\n0,0.05,0.05\n0.5,0.06,0.055'} />
        {parsed && 'err' in parsed && <Callout kind="err">{parsed.err}</Callout>}
        {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.t.length} time points · {ok.series.length} curve(s){ok.skipped ? ` · ${ok.skipped} bad rows skipped` : ''}</div>}
      </div></Card>
      <Card title="2 · Options"><div className="stack" style={{ gap: 10 }}>
        <Field label="Blank OD (optional, subtracted from every reading)"><input className="input" value={blank} onChange={(e) => setBlank(e.target.value)} placeholder="e.g. 0.04" /></Field>
        <Field label="OD0 (optional; default = first positive reading)"><input className="input" value={od0} onChange={(e) => setOd0(e.target.value)} /></Field>
        <button className="btn primary" disabled={!ok} onClick={go}>Fit curves</button>{error && <Callout kind="err">{error}</Callout>}
      </div></Card>
      <Callout><div>Both models are fitted to y = ln(OD/OD0); the model-free μmax is the steepest slope of a 4-point sliding log-linear regression. Doubling time = ln 2 / μ.</div></Callout>
    </div>
    <div className="stack">
      {res?.err && <Callout kind="err">{res.err}</Callout>}
      {!res && <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load a growth table (or the demo) and fit.</div></Card>}
      {res && !res.err && <>
        {res.rows.some((r) => r.gompertz.warning) && <Callout kind="warn">{res.rows.filter((r) => r.gompertz.warning).map((r) => r.name).join(', ')}: no growth detected in at least one curve.</Callout>}
        <div className="cols-3">{res.rows.map((r) => <Stat key={r.name} label={`Doubling time · ${r.name}`} value={Number.isFinite((r.best === 'gompertz' ? r.gompertz : r.logistic).doublingTime) ? `${fmt((r.best === 'gompertz' ? r.gompertz : r.logistic).doublingTime, 2)} h` : '–'} hint={`${r.best} model; μ = ${fmt((r.best === 'gompertz' ? r.gompertz : r.logistic).mu, 3)} per time unit`} />)}</div>
        <Card title="Fitted curves" sub="ln(OD/OD0) with the better model per curve">
          <CurvePlot spec={{ series, xLabel: 'Time', yLabel: 'ln(OD/OD0)' }} height={320} exportName="growth-curves" />
        </Card>
        <Card title="Parameters" pad={false}>
          <DataTable rowKey={(r) => r.name} rows={res.rows} cols={[
            { key: 'name', label: 'Curve' }, { key: 'best', label: 'Best model' },
            { key: 'mu', label: 'μ (best)', num: true, render: (r) => fmt((r.best === 'gompertz' ? r.gompertz : r.logistic).mu, 4) },
            { key: 'lam', label: 'λ (best)', num: true, render: (r) => fmt((r.best === 'gompertz' ? r.gompertz : r.logistic).lambda, 3) },
            { key: 'A', label: 'A (best)', num: true, render: (r) => fmt((r.best === 'gompertz' ? r.gompertz : r.logistic).A, 3) },
            { key: 'free', label: 'Model-free μmax', num: true, render: (r) => fmt(r.free.mu, 4) },
            { key: 'win', label: 'Window', num: true, render: (r) => `${fmt(r.free.window[0], 1)}–${fmt(r.free.window[1], 1)}` },
            { key: 'gAIC', label: 'AIC Gompertz', num: true, render: (r) => fmt(r.gompertz.aic, 2) }, { key: 'lAIC', label: 'AIC logistic', num: true, render: (r) => fmt(r.logistic.aic, 2) }]} />
          <div className="row" style={{ padding: 10 }}><button className="btn sm" onClick={() => downloadText('growth_fits.csv', toCsv(res.rows.flatMap((r) => [{ curve: r.name, model: 'gompertz', A: r.gompertz.A, mu: r.gompertz.mu, lambda: r.gompertz.lambda, doubling_time: r.gompertz.doublingTime, aic: r.gompertz.aic }, { curve: r.name, model: 'logistic', A: r.logistic.A, mu: r.logistic.mu, lambda: r.logistic.lambda, doubling_time: r.logistic.doublingTime, aic: r.logistic.aic }, { curve: r.name, model: 'model-free', A: NaN, mu: r.free.mu, lambda: NaN, doubling_time: r.free.doublingTime, aic: NaN }])), 'text/csv')}>Export fits (CSV)</button></div>
        </Card>
      </>}
    </div></div>
  );
}
