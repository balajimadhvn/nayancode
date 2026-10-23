import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { nca, parseProfiles, summarise, terminalPhase, type NcaOptions, type NcaResult, type Profile } from './nca';

const TOOL: ToolInfo = {
  id: 'pk.nca', name: 'Non-compartmental analysis', version: '0.1.0', engine: 'TypeScript', citations: ['gibaldi1982', 'yeh1978'],
  describe: (p) => `Non-compartmental analysis used the ${p.trapezoid} trapezoidal rule with the terminal rate constant chosen by adjusted R²; the dose was ${p.dose} given by the ${p.route} route.`,
};

const COLS = ['--chart-a', '--chart-b', '--chart-c', '--chart-d'];
const ivProfile = () => {
  const times = [0, 0.25, 0.5, 1, 2, 4, 6, 8, 12, 16, 24, 36, 48];
  return 'time,conc\n' + times.map((t) => `${t},${(10 * Math.exp(-0.1 * t)).toFixed(6)}`).join('\n');
};
const oralProfile = () => {
  const times = [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 8, 12, 16, 24, 36, 48];
  return 'time,conc\n' + times.map((t) => `${t},${((100 * 1) / (10 * 0.9) * (Math.exp(-0.1 * t) - Math.exp(-t))).toFixed(6)}`).join('\n');
};

interface Out { profiles: Profile[]; results: { profile: Profile; result: NcaResult }[] }

export default function NcaTab() {
  const [text, setText] = useState('');
  const [dose, setDose] = useState('100');
  const [route, setRoute] = useState<'iv' | 'extravascular'>('iv');
  const [trapezoid, setTrapezoid] = useState<'linear-up-log-down' | 'linear'>('linear-up-log-down');
  const [lambdaMode, setLambdaMode] = useState('auto');
  const [loq, setLoq] = useState('');
  const [blq, setBlq] = useState(false);
  const [logY, setLogY] = useState(true);
  const [showLambda, setShowLambda] = useState(true);
  const [out, setOut] = useState<Out | null>(null);
  const { run, busy, error } = useRunner();

  const parsed = useMemo(() => { try { return text ? parseProfiles(text) : null; } catch (e) { return { err: (e as Error).message }; } }, [text]);
  const ok = parsed && !('err' in parsed) ? parsed : null;
  const errMsg = parsed && 'err' in parsed ? parsed.err : null;

  const go = () => {
    if (!ok) return;
    const opt: NcaOptions = {
      dose: Number(dose), route, trapezoid,
      lambdaPoints: lambdaMode === 'auto' ? 'auto' : Number(lambdaMode),
      loq: loq.trim() ? Number(loq) : undefined, blqAsZero: blq,
    };
    void run({
      label: `NCA · ${ok.length} profile${ok.length > 1 ? 's' : ''}`, tool: TOOL, params: { dose: opt.dose, route, trapezoid, lambdaPoints: opt.lambdaPoints },
      inputs: [{ name: 'concentration-time table', data: text }],
      run: async () => {
        const results = ok.map((profile) => ({ profile, result: nca(profile.time, profile.conc, opt) }));
        setOut({ profiles: ok, results });
        return { n: results.length };
      },
      summary: () => `Non-compartmental analysis of ${ok.length} profile(s)${ok.length > 1 ? ' with mean, SD and geometric mean across subjects' : ''}`,
    });
  };

  const series: CurveSeries[] = useMemo(() => {
    if (!out) return [];
    const s: CurveSeries[] = out.profiles.map((p, i) => ({
      name: p.name, color: cssVar(COLS[i % COLS.length]), points: p.time.map((t, j) => ({ x: t, y: p.conc[j] })),
    }));
    if (showLambda) {
      out.results.forEach((r, i) => {
        const tp = terminalPhase(r.profile.time, r.profile.conc, { dose: Number(dose), route, trapezoid, lambdaPoints: lambdaMode === 'auto' ? 'auto' : Number(lambdaMode) });
        if (!tp) return;
        const pts = r.profile.time.map((t, j) => ({ t, c: r.profile.conc[j] })).filter((q) => q.t >= tp.from && q.c > 0);
        s.push({ name: `${r.profile.name} · λz window`, color: cssVar(COLS[i % COLS.length]), points: pts.map((q) => ({ x: q.t, y: q.c })) });
      });
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [out, showLambda, dose, route, trapezoid, lambdaMode]);

  const key = (r: NcaResult) => r.cmax + ':' + r.tlast + ':' + r.aucLast;
  const summaryRows = out && out.results.length > 1 ? (['cmax', 'aucLast', 'aucInf', 'halfLife', 'cl', 'vz', 'mrt'] as const).map((k) => {
    const vals = out.results.map((r) => r.result[k]).filter((v): v is number => v !== null && Number.isFinite(v));
    const s = summarise(vals);
    return { metric: k, ...s };
  }) : [];

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Concentration–time table"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setText(t); setOut(null); }} label={text ? 'Table loaded' : 'CSV/TSV: time, conc, optional subject column (or one concentration column per subject)'} />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => { setText(ivProfile()); setRoute('iv'); setOut(null); }}>Load IV demo</button>
          <button className="btn" onClick={() => { setText(oralProfile()); setRoute('extravascular'); setOut(null); }}>Load oral demo</button>
        </div>
        {errMsg && <Callout kind="err">{errMsg}</Callout>}
        {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.length} profile(s) · {ok.reduce((a, p) => a + p.time.length, 0)} samples</div>}
      </div></Card>
      {ok && <Card title="2 · Options"><div className="stack" style={{ gap: 10 }}>
        <div className="cols-2" style={{ gap: 8 }}>
          <Field label="Dose"><input className="input" value={dose} onChange={(e) => setDose(e.target.value)} /></Field>
          <Field label="Route"><select className="select" value={route} onChange={(e) => setRoute(e.target.value as 'iv' | 'extravascular')}><option value="iv">IV</option><option value="extravascular">Extravascular</option></select></Field>
        </div>
        <div className="cols-2" style={{ gap: 8 }}>
          <Field label="Trapezoid"><select className="select" value={trapezoid} onChange={(e) => setTrapezoid(e.target.value as 'linear-up-log-down' | 'linear')}><option value="linear-up-log-down">Linear-up / log-down</option><option value="linear">Linear</option></select></Field>
          <Field label="Terminal points"><select className="select" value={lambdaMode} onChange={(e) => setLambdaMode(e.target.value)}><option value="auto">Auto (best adjusted R²)</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></Field>
        </div>
        <div className="cols-2" style={{ gap: 8 }}>
          <Field label="LOQ (optional)"><input className="input" placeholder="e.g. 0.05" value={loq} onChange={(e) => setLoq(e.target.value)} /></Field>
          <label className="row" style={{ gap: 6, alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={blq} onChange={(e) => setBlq(e.target.checked)} />Treat values below LOQ as zero</label>
        </div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={logY} onChange={(e) => setLogY(e.target.checked)} />Semi-log plot</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={showLambda} onChange={(e) => setShowLambda(e.target.checked)} />Highlight the λz window</label>
        <button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Running…' : 'Analyse'}</button>
        {error && <Callout kind="err">{error}</Callout>}
      </div></Card>}
    </div>
    <div className="stack">
      {!out ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load a concentration–time table (or a demo) and analyse.</div></Card> : <>
        <div className="cols-3">
          <Stat label="Profiles" value={out.results.length} />
          <Stat label="AUCinf (geo mean)" value={fmt(summarise(out.results.map((r) => r.result.aucInf ?? NaN)).geoMean, 2)} hint="across subjects" />
          <Stat label="t½ (geo mean)" value={fmt(summarise(out.results.map((r) => r.result.halfLife ?? NaN)).geoMean, 2)} hint="terminal half-life" />
        </div>
        <Card title="Concentration–time profiles" sub={showLambda ? 'large dots mark the λz regression window' : undefined}>
          <CurvePlot spec={{ series, xLabel: 'Time', yLabel: 'Concentration', yMin: 0, logY }} height={360} exportName="pk-nca-profiles" />
        </Card>
        <Card title="NCA results" pad={false}>
          <DataTable rowKey={(r) => r.profile.name + key(r.result)} rows={out.results} cols={[
            { key: 'name', label: 'Profile', render: (r) => r.profile.name },
            { key: 'n', label: 'n', num: true, render: (r) => r.result.nPoints },
            { key: 'cmax', label: 'Cmax', num: true, render: (r) => fmt(r.result.cmax, 3) },
            { key: 'tmax', label: 'Tmax', num: true, render: (r) => fmt(r.result.tmax, 2) },
            { key: 'aucLast', label: 'AUClast', num: true, render: (r) => fmt(r.result.aucLast, 3) },
            { key: 'aucInf', label: 'AUCinf', num: true, render: (r) => fmt(r.result.aucInf ?? NaN, 3) },
            { key: 'extrap', label: 'AUC %extrap', num: true, render: (r) => fmt(r.result.aucExtrapPct ?? NaN, 1) },
            { key: 'lz', label: 'λz', num: true, render: (r) => fmt(r.result.lambdaZ ?? NaN, 4) },
            { key: 'thalf', label: 't½', num: true, render: (r) => fmt(r.result.halfLife ?? NaN, 2) },
            { key: 'cl', label: route === 'iv' ? 'CL' : 'CL/F', num: true, render: (r) => fmt(r.result.cl ?? NaN, 3) },
            { key: 'vz', label: route === 'iv' ? 'Vz' : 'Vz/F', num: true, render: (r) => fmt(r.result.vz ?? NaN, 3) },
            { key: 'mrt', label: 'MRTinf', num: true, render: (r) => fmt(r.result.mrt ?? NaN, 2) },
          ]} />
          <div className="row" style={{ padding: 10 }}>
            <button className="btn sm" onClick={() => downloadText('nca_results.csv', toCsv(out.results.map(({ profile, result: r }) => ({ profile: profile.name, n: r.nPoints, cmax: r.cmax, tmax: r.tmax, clast: r.clast, tlast: r.tlast, auc_last: r.aucLast, lambda_z: r.lambdaZ ?? '', half_life: r.halfLife ?? '', n_lambda: r.nPointsLambda, r2_adj: r.r2adj ?? '', auc_inf: r.aucInf ?? '', auc_extrap_pct: r.aucExtrapPct ?? '', aumc_last: r.aumcLast, aumc_inf: r.aumcInf ?? '', mrt: r.mrt ?? '', clearance: r.cl ?? '', vz: r.vz ?? '' }))), 'text/csv')}>Export CSV</button>
          </div>
        </Card>
        {summaryRows.length > 0 && <Card title="Across-subject summary"><DataTable rowKey={(r) => r.metric} rows={summaryRows} cols={[
          { key: 'metric', label: 'Metric' }, { key: 'n', label: 'n', num: true },
          { key: 'mean', label: 'Mean', num: true, render: (r) => fmt(r.mean, 3) }, { key: 'sd', label: 'SD', num: true, render: (r) => fmt(r.sd, 3) },
          { key: 'cv', label: 'CV %', num: true, render: (r) => fmt((r.sd / r.mean) * 100, 1) }, { key: 'geo', label: 'Geometric mean', num: true, render: (r) => fmt(r.geoMean, 3) },
        ]} /></Card>}
        {out.results.flatMap(({ profile, result }) => result.warnings.map((w) => <Callout key={profile.name + w} kind="warn"><b>{profile.name}:</b> {w}</Callout>))}
        <Callout><div>Educational and research tool. NCA results depend on sampling; this is not a validated clinical pharmacology package (use Phoenix WinNonlin, PKNCA or NONMEM for regulated work). AUCinf uses the last measured concentration, so ensure the terminal phase is adequately sampled.</div></Callout>
      </>}
    </div></div>
  );
}
