import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, Stat, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { ScenePlot } from '@/viz/charts';
import { buildForest, buildFunnel } from '@/viz/figure';
import { BCG, eggerTest, hedgesG, leaveOneOut, logOddsRatio, logRiskRatio, metaAnalysis, riskDifference, type Effect, type Method } from './meta';
import { parseDelimited } from './tests';

const TOOL: ToolInfo = { id: 'stats.meta', name: 'Meta-analysis', version: '0.1.0', engine: 'TypeScript', citations: ['dersimonian1986', 'viechtbauer2005', 'egger1997', 'hedges1981', 'colditz1994'], describe: (p) => `Studies were pooled with a ${p.method} random-effects/fixed-effect meta-analysis after heterogeneity assessment (I², Q); Egger's test examined small-study effects` };

const DEMO = 'study,a,b,c,d\n' + BCG.map((s) => `${s.study},${s.a},${s.b},${s.c},${s.d}`).join('\n');
type Measure = 'RR' | 'OR' | 'RD' | 'SMD';

function readStudies(text: string, measure: Measure): { names: string[]; effects: Effect[]; note: string } {
  const t = parseDelimited(text);
  const h = t.header.map((x) => x.toLowerCase());
  const gi = (re: RegExp) => h.findIndex((x) => re.test(x));
  const si = gi(/^study$|name|trial/);
  const names = t.rows.map((r, i) => r[si >= 0 ? si : 0] || `Study ${i + 1}`);
  const num = (r: string[], re: RegExp, fallback: number) => { const i = gi(re); return i >= 0 ? Number(r[i]) : fallback; };
  let note = '';
  let effects: Effect[];
  if (gi(/^a$/) >= 0 && gi(/^b$/) >= 0 && gi(/^c$/) >= 0 && gi(/^d$/) >= 0) {
    effects = t.rows.map((r) => {
      const a = num(r, /^a$/, 0), b = num(r, /^b$/, 0), c = num(r, /^c$/, 0), d = num(r, /^d$/, 0);
      if (measure === 'OR') { const e = logOddsRatio(a, b, c, d); if (e.corrected) note = 'At least one study had a zero cell; 0.5 was added to every cell of that study.'; return e; }
      if (measure === 'RD') return riskDifference(a, b, c, d);
      return logRiskRatio(a, b, c, d);
    });
  } else if (gi(/m1|mean1/) >= 0 && gi(/sd1/) >= 0 && gi(/n1/) >= 0) {
    effects = t.rows.map((r) => hedgesG(num(r, /m1|mean1/, 0), num(r, /sd1/, 0), num(r, /n1/, 0), num(r, /m2|mean2/, 0), num(r, /sd2/, 0), num(r, /n2/, 0)));
    note = 'Means are pooled as Hedges\' g (standardised mean difference).';
  } else if (gi(/^yi$/) >= 0 && gi(/^vi$/) >= 0) {
    effects = t.rows.map((r) => ({ yi: num(r, /^yi$/, NaN), vi: num(r, /^vi$/, NaN) }));
    note = 'Generic effect sizes were used as supplied.';
  } else throw new Error('Columns must be study,a,b,c,d or study,m1,sd1,n1,m2,sd2,n2 or study,yi,vi.');
  const keep = effects.map((e, i) => ({ e, i })).filter(({ e }) => Number.isFinite(e.yi) && Number.isFinite(e.vi) && e.vi > 0);
  return { names: keep.map(({ i }) => names[i]), effects: keep.map(({ e }) => e), note };
}

export default function MetaAnalysis() {
  const [text, setText] = useState(''), [measure, setMeasure] = useState<Measure>('RR'), [method, setMethod] = useState<Method>('DL');
  const [res, setRes] = useState<null | { names: string[]; effects: Effect[]; note: string; meta: ReturnType<typeof metaAnalysis>; egger: ReturnType<typeof eggerTest> | null; loo: ReturnType<typeof leaveOneOut> | null; err: string }>(null);
  const { run, error } = useRunner();

  const compute = (data = text, m = measure, mm = method) => {
    try {
      const s = readStudies(data, m);
      if (s.effects.length < 2) throw new Error('Need at least two complete studies.');
      const meta = metaAnalysis(s.effects.map((e) => e.yi), s.effects.map((e) => e.vi), mm);
      const egger = s.effects.length >= 3 ? eggerTest(s.effects.map((e) => e.yi), s.effects.map((e) => e.vi)) : null;
      const loo = s.effects.length >= 3 ? leaveOneOut(s.effects.map((e) => e.yi), s.effects.map((e) => e.vi), mm) : null;
      setRes({ ...s, meta, egger, loo, err: '' });
    } catch (e) { setRes({ names: [], effects: [], note: '', meta: null as never, egger: null, loo: null, err: (e as Error).message }); }
  };
  const demo = () => { setText(DEMO); compute(DEMO, 'RR', 'DL'); };
  const go = () => void run({ label: `Meta-analysis · ${method}`, tool: TOOL, params: { method, measure, studies: res?.names.length ?? 0 }, inputs: [{ name: 'studies', data: text }], run: async () => { compute(); return res?.names.length ?? 0; },
    summary: () => `Studies were pooled with the ${method} model (${measure})` });

  const forest = useMemo(() => {
    if (!res || res.err || !res.meta) return null;
    const labels = res.names, est = res.effects.map((e) => e.yi), lo = res.effects.map((e) => e.yi - 1.96 * Math.sqrt(e.vi)), hi = res.effects.map((e) => e.yi + 1.96 * Math.sqrt(e.vi));
    return buildForest({ labels, est, lo, hi, weight: res.meta.weights, pooled: { est: res.meta.estimate, lo: res.meta.ci95[0], hi: res.meta.ci95[1], label: 'Pooled' }, xLabel: `${measure === 'SMD' ? 'Hedges g' : `log ${measure}`}` }, { widthMm: 150, heightMm: 40 + 7 * labels.length, fontPt: 9, palette: 'shown', theme: 'light', title: '', xLabel: '', yLabel: '', labelTopN: 0, dpi: 300 });
  }, [res, measure]);
  const funnel = useMemo(() => {
    if (!res || res.err || !res.meta) return null;
    return buildFunnel({ yi: res.effects.map((e) => e.yi), se: res.effects.map((e) => Math.sqrt(e.vi)), centre: res.meta.estimate, xLabel: `${measure === 'SMD' ? 'Hedges g' : `log ${measure}`}` }, { widthMm: 110, heightMm: 90, fontPt: 9, palette: 'shown', theme: 'light', title: '', xLabel: '', yLabel: '', labelTopN: 0, dpi: 300 });
  }, [res, measure]);

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Studies"><div className="stack" style={{ gap: 10 }}>
        <textarea className="input mono" rows={9} style={{ fontSize: 11.5 }} value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} placeholder={'study,a,b,c,d\nTrial 1,4,119,11,128'} />
        <button className="btn" onClick={demo}>Load demo (BCG vaccine, 13 trials)</button>
        <div className="faint" style={{ fontSize: 11.5 }}>Accepted columns: <code>study,a,b,c,d</code> (events / non-events), <code>study,m1,sd1,n1,m2,sd2,n2</code>, or <code>study,yi,vi</code>.</div>
      </div></Card>
      <Card title="2 · Model"><div className="stack" style={{ gap: 10 }}>
        <Field label="Effect measure (count or mean data)"><select className="select" value={measure} onChange={(e) => { setMeasure(e.target.value as Measure); setRes(null); }}><option value="RR">Risk ratio (log)</option><option value="OR">Odds ratio (log)</option><option value="RD">Risk difference</option><option value="SMD">Hedges g (means)</option></select></Field>
        <Field label="Pooling"><select className="select" value={method} onChange={(e) => { setMethod(e.target.value as Method); setRes(null); }}><option value="DL">DerSimonian–Laird (random)</option><option value="REML">REML (random)</option><option value="PM">Paule–Mandel (random)</option><option value="FE">Fixed effect</option></select></Field>
        <button className="btn primary" disabled={!text.trim()} onClick={go}>Run meta-analysis</button>{error && <Callout kind="err">{error}</Callout>}
      </div></Card>
      <Callout kind="warn">Check assumptions before trusting a p-value. Statistics Studio does not replace a statistician for a clinical or regulatory analysis.</Callout>
    </div>
    <div className="stack">
      {!res && <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load the BCG demo or paste studies and run.</div></Card>}
      {res?.err && <Callout kind="err">{res.err}</Callout>}
      {res && !res.err && res.meta && <>
        {res.note && <Callout kind="warn">{res.note}</Callout>}
        <div className="cols-3">
          <Stat label="Pooled effect" value={fmt(res.meta.estimate, 2)} hint={`95 % CI ${fmt(res.meta.ci95[0], 2)} to ${fmt(res.meta.ci95[1], 2)} (${method})`} />
          <Stat label="Heterogeneity I²" value={`${fmt(res.meta.I2, 1)} %`} hint={`Q = ${fmt(res.meta.Q, 2)} on ${res.meta.Qdf} df, p = ${sci(res.meta.Qp)}`} />
          <Stat label="τ²" value={fmt(res.meta.tau2, 4)} hint={`${res.meta.k} studies · ${method} estimate of the between-study variance`} />
        </div>
        {forest && <Card title="Forest plot" sub="squares are sized by weight; the diamond is the pooled estimate"><ScenePlot scene={forest} build={(o) => buildForest({ labels: res.names, est: res.effects.map((e) => e.yi), lo: res.effects.map((e) => e.yi - 1.96 * Math.sqrt(e.vi)), hi: res.effects.map((e) => e.yi + 1.96 * Math.sqrt(e.vi)), weight: res.meta.weights, pooled: { est: res.meta.estimate, lo: res.meta.ci95[0], hi: res.meta.ci95[1], label: 'Pooled' }, xLabel: measure === 'SMD' ? 'Hedges g' : `log ${measure}` }, o)} height={380} name="forest" defaults={{ xLabel: measure === 'SMD' ? 'Hedges g' : `log ${measure}` }} /></Card>}
        <div className="cols-2">
          {funnel && <Card title="Funnel plot" sub="precise studies at the top"><ScenePlot scene={funnel} build={(o) => buildFunnel({ yi: res.effects.map((e) => e.yi), se: res.effects.map((e) => Math.sqrt(e.vi)), centre: res.meta.estimate, xLabel: measure === 'SMD' ? 'Hedges g' : `log ${measure}` }, o)} height={280} name="funnel" defaults={{ xLabel: measure === 'SMD' ? 'Hedges g' : `log ${measure}`, yLabel: 'Standard error' }} /></Card>}
          <Card title="Small-study effects">
            {res.egger ? <DataTable rowKey={(r) => r.term} rows={[{ term: 'Egger intercept', v: res.egger.intercept, p: res.egger.p }]} cols={[{ key: 'term', label: 'Test' }, { key: 'v', label: 'Intercept', num: true, render: (r) => fmt(r.v, 3) }, { key: 'p', label: 'p', num: true, render: (r) => sci(r.p) }]} /> : <div className="faint">Egger's test needs at least 3 studies.</div>}
            <div className="faint" style={{ marginTop: 6, fontSize: 11.5 }}>Egger regresses the standardised effect on precision; a non-zero intercept suggests funnel-plot asymmetry (publication bias or genuine small-study effects).</div>
            {res.meta.predictionInterval && <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>95 % prediction interval {fmt(res.meta.predictionInterval[0], 2)} to {fmt(res.meta.predictionInterval[1], 2)} — where a future study's true effect may lie.</div>}
          </Card>
        </div>
        <Card title="Studies" pad={false}>
          <DataTable rowKey={(r) => r.name} rows={res.names.map((name, i) => ({ name, yi: res.effects[i].yi, vi: res.effects[i].vi, w: res.meta.weights[i] }))} cols={[
            { key: 'name', label: 'Study' }, { key: 'yi', label: measure === 'SMD' ? 'g' : `log ${measure}`, num: true, render: (r) => fmt(r.yi, 4) },
            { key: 'se', label: 'SE', num: true, render: (r) => fmt(Math.sqrt(r.vi), 4) }, { key: 'w', label: 'Weight %', num: true, render: (r) => fmt((100 * r.w) / res.meta.weights.reduce((a, b) => a + b, 0), 1) }]} />
          <div className="row" style={{ padding: 10 }}><button className="btn sm" onClick={() => downloadText('meta_analysis_studies.csv', toCsv(res.names.map((name, i) => ({ study: name, yi: res.effects[i].yi, vi: res.effects[i].vi, weight: res.meta.weights[i] }))), 'text/csv')}>Export studies (CSV)</button></div>
        </Card>
        {res.loo && <Card title="Leave-one-out" sub={`${method} estimate without each study`} pad={false}>
          <DataTable rowKey={(r) => res.names[r.omitted]} rows={res.loo} cols={[
            { key: 'omitted', label: 'Omitted', render: (r) => res.names[r.omitted] }, { key: 'estimate', label: 'Estimate', num: true, render: (r) => fmt(r.estimate, 3) },
            { key: 'ci', label: '95 % CI', num: true, render: (r) => `${fmt(r.ci95[0], 3)} to ${fmt(r.ci95[1], 3)}` }, { key: 'tau2', label: 'τ²', num: true, render: (r) => fmt(r.tau2, 4) }, { key: 'i2', label: 'I² %', num: true, render: (r) => fmt(r.I2, 1) }]} />
        </Card>}
      </>}
    </div></div>
  );
}
