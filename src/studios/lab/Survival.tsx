import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { coxPh, kmByGroup, logRank, parseSurvival, withGroupCovariate, type CoxFit, type KmCurve, type Subject } from './survival';

const TOOL: ToolInfo = { id: 'lab.survival', name: 'Survival analysis', version: '0.1.0', engine: 'TypeScript', citations: ['kaplan1958', 'mantel1966', 'cox1972', 'efron1977'], describe: (p) => `Survival was estimated by the Kaplan–Meier method${p.groups ? ` and compared with the log-rank test (${p.groups} groups)` : ''}${p.covariates ? `; hazard ratios came from a Cox proportional hazards model (Efron ties) with ${p.covariates}` : ''}.` };

const DEMO = 'time,event,group,age\n' + [
  [9, 1, 'Maintained', 61], [13, 1, 'Maintained', 55], [13, 0, 'Maintained', 48], [18, 1, 'Maintained', 66], [23, 1, 'Maintained', 52], [28, 0, 'Maintained', 59], [31, 1, 'Maintained', 63], [34, 1, 'Maintained', 45], [45, 0, 'Maintained', 70], [48, 1, 'Maintained', 57], [161, 0, 'Maintained', 41],
  [5, 1, 'Nonmaintained', 58], [5, 1, 'Nonmaintained', 64], [8, 1, 'Nonmaintained', 50], [8, 1, 'Nonmaintained', 69], [12, 1, 'Nonmaintained', 47], [16, 0, 'Nonmaintained', 62], [23, 1, 'Nonmaintained', 54], [27, 1, 'Nonmaintained', 60], [30, 1, 'Nonmaintained', 68], [33, 1, 'Nonmaintained', 43], [43, 1, 'Nonmaintained', 56], [45, 1, 'Nonmaintained', 51],
].map((r) => r.join(',')).join('\n');

const steps = (c: KmCurve, key: 'surv' | 'lo' | 'hi') => c.points.flatMap((p, i) => (i === 0 ? [{ x: 0, y: 1 }] : [{ x: p.time, y: c.points[i - 1][key] }, { x: p.time, y: p[key] }]));

export default function Survival() {
  const [text, setText] = useState(''), [showCi, setShowCi] = useState(true), [cov, setCov] = useState<string[]>([]), [useGroup, setUseGroup] = useState(true);
  const [res, setRes] = useState<{ km: KmCurve[]; lr: ReturnType<typeof logRank> | null; cox: CoxFit | null; coxErr: string } | null>(null), { run, error } = useRunner();
  const parsed = useMemo(() => { try { return text ? parseSurvival(text) : null; } catch (e) { return { err: (e as Error).message }; } }, [text]);
  const ok = parsed && !('err' in parsed) ? parsed : null;
  const groups = useMemo(() => (ok ? [...new Set(ok.subjects.map((s) => s.group ?? 'all'))] : []), [ok]);
  const cols = [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d'), '#3fb97a', '#b45fd1'];
  const go = () => {
    if (!ok) return;
    void run({
      label: `Survival · ${ok.subjects.length} subjects`, tool: TOOL, params: { groups: groups.length > 1 ? groups.length : 0, covariates: [...(useGroup && groups.length === 2 ? ['group'] : []), ...cov].join(', ') }, inputs: [{ name: 'survival table', data: text }],
      run: async () => {
        const km = kmByGroup(ok.subjects);
        const lr = groups.length > 1 ? logRank(ok.subjects) : null;
        let cox: CoxFit | null = null, coxErr = '';
        const useG = useGroup && groups.length === 2, idx = cov.map((c) => ok.covariates.indexOf(c));
        if (useG || cov.length) {
          try {
            let subj: Subject[] = ok.subjects.map((s) => ({ ...s, x: idx.map((i) => s.x![i]) })); const names = [...cov];
            if (useG) { const g = withGroupCovariate(subj); subj = g.subjects; names.push(g.name); }
            cox = coxPh(subj, names);
          } catch (e) { coxErr = (e as Error).message; }
        }
        setRes({ km, lr, cox, coxErr }); return { km: km.length };
      },
      summary: () => `Survival was estimated by the Kaplan–Meier method${res?.lr ? ' and groups were compared with the log-rank test' : ''}`,
    });
  };
  const series: CurveSeries[] = res ? res.km.map((c, i) => ({ name: `${c.group} (n=${c.n})`, color: cols[i % cols.length], curve: steps(c, 'surv'), band: showCi ? steps(c, 'lo').map((p, j) => ({ x: p.x, lo: p.y, hi: steps(c, 'hi')[j].y })) : undefined })) : [];
  return (
    <div className="split"><div className="stack">
      <Card title="1 · Survival table"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setText(t); setRes(null); setCov([]); }} label={text ? 'Table loaded' : 'CSV/TSV with time, event (1 = event, 0 = censored), optional group and numeric covariates'} />
        <div className="row" style={{ gap: 6 }}><button className="btn" onClick={() => { setText(DEMO); setRes(null); setCov([]); }}>Load demo (leukaemia, 23 patients)</button></div>
        {parsed && 'err' in parsed && <Callout kind="err">{parsed.err}</Callout>}
        {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.subjects.length} subjects · {ok.subjects.filter((s) => s.event === 1).length} events · {groups.length} group{groups.length > 1 ? 's' : ''}{ok.skipped ? ` · ${ok.skipped} rows skipped (bad time or event)` : ''}</div>}
      </div></Card>
      {ok && <Card title="2 · Model"><div className="stack" style={{ gap: 10 }}>
        {groups.length === 2 && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={useGroup} onChange={(e) => setUseGroup(e.target.checked)} />Include group in the Cox model</label>}
        {ok.covariates.length > 0 && <Field label="Cox covariates (numeric columns)"><div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{ok.covariates.map((c) => <label key={c} className="row" style={{ gap: 4 }}><input type="checkbox" checked={cov.includes(c)} onChange={() => setCov(cov.includes(c) ? cov.filter((x) => x !== c) : [...cov, c])} />{c}</label>)}</div></Field>}
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={showCi} onChange={(e) => setShowCi(e.target.checked)} />Show 95 % confidence bands</label>
        <button className="btn primary" onClick={go}>Analyse</button>{error && <Callout kind="err">{error}</Callout>}
      </div></Card>}
      <Callout><div>Kaplan–Meier with Greenwood log–log intervals, the log-rank test and Cox regression with Efron ties reproduce R <code>survival</code> on its <code>aml</code> example. Check proportional hazards (Schoenfeld residuals) in R before reporting a hazard ratio from your own data.</div></Callout>
    </div>
    <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load a survival table (or the demo) and analyse.</div></Card> : <>
      <div className="cols-3">{res.lr ? <Stat label="Log-rank p" value={sci(res.lr.p)} hint={`χ² = ${fmt(res.lr.chisq, 2)} on ${res.lr.df} df`} /> : <Stat label="Groups" value="1" />}{res.km.slice(0, 2).map((c) => <Stat key={c.group} label={`Median, ${c.group}`} value={Number.isFinite(c.median) ? fmt(c.median, 1) : 'not reached'} hint={`95 % CI ${fmt(c.medianLo, 1)} to ${Number.isFinite(c.medianHi) ? fmt(c.medianHi, 1) : 'not reached'}`} />)}</div>
      <Card title="Kaplan–Meier curves" sub={showCi ? '95 % log–log bands' : undefined}><CurvePlot spec={{ series, xLabel: 'Time', yLabel: 'Survival probability', yMin: 0, yMax: 1 }} height={340} exportName="kaplan-meier" /></Card>
      <Card title="Groups"><DataTable rowKey={(r) => r.group} rows={res.km} cols={[{ key: 'group', label: 'Group' }, { key: 'n', label: 'n', num: true }, { key: 'events', label: 'Events', num: true }, { key: 'median', label: 'Median', num: true, render: (r) => (Number.isFinite(r.median) ? fmt(r.median, 1) : 'NR') }, { key: 'ci', label: '95 % CI', num: true, render: (r) => `${fmt(r.medianLo, 1)} to ${Number.isFinite(r.medianHi) ? fmt(r.medianHi, 1) : 'NR'}` }]} />
        {res.lr && <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>Log-rank χ² = {fmt(res.lr.chisq, 3)} on {res.lr.df} df, p = {sci(res.lr.p)}. Observed / expected events: {res.lr.groups.map((g, i) => `${g} ${res.lr!.observed[i]} / ${fmt(res.lr!.expected[i], 1)}`).join(' · ')}.</div>}
        <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => downloadText('km_table.csv', toCsv(res.km.flatMap((c) => c.points.slice(1).map((p) => ({ group: c.group, time: p.time, at_risk: p.atRisk, events: p.events, censored: p.censored, survival: p.surv, lower95: p.lo, upper95: p.hi })))), 'text/csv')}>Download KM table (CSV)</button></div></Card>
      {res.coxErr && <Callout kind="warn">{res.coxErr}</Callout>}
      {res.cox && <Card title="Cox proportional hazards" sub={`${res.cox.n} subjects · ${res.cox.events} events`}>
        <DataTable rowKey={(r) => r.name} rows={res.cox.coefs} cols={[{ key: 'name', label: 'Covariate' }, { key: 'hr', label: 'Hazard ratio', num: true, render: (r) => fmt(r.hr, 3) }, { key: 'ci', label: '95 % CI', num: true, render: (r) => `${fmt(r.hrLo, 3)} to ${fmt(r.hrHi, 3)}` }, { key: 'coef', label: 'log HR', num: true, render: (r) => fmt(r.coef, 4) }, { key: 'se', label: 'SE', num: true, render: (r) => fmt(r.se, 4) }, { key: 'p', label: 'p', num: true, render: (r) => sci(r.p) }]} />
        <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>Likelihood-ratio test χ² = {fmt(res.cox.lrt, 2)}, p = {sci(res.cox.lrtP)} · Wald p = {sci(res.cox.waldP)} · concordance (Harrell C) = {fmt(res.cox.concordance, 3)}{res.cox.converged ? '' : ' · did not fully converge'}. A hazard ratio above 1 means higher hazard of the event.</div>
      </Card>}
    </>}</div></div>
  );
}
