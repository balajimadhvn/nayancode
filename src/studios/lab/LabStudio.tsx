import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { BarChart, CurvePlot, cssVar } from '@/viz/charts';
import type { CurveSeries, CurveSpec } from '@/viz/figure';
import { curvePoints, fitDoseResponse, parseDoseResponse, type FitResult, type Fixed, type Model } from './doseResponse';
import { cohenH, effectAnova, effectT, logrankEvents, logrankPower, logrankSampleSize, powerAnova, powerProp, powerT, rnaseqCv, rnaseqEffect, rnaseqPower, rnaseqSampleSize, sampleSizeAnova, sampleSizeProp, sampleSizeT, type Alt, type TType } from './power';
import { ctToQuantity, geNorm, parsePlate, relativeQuantification, standardCurve, type GeNormResult, type PlateRow, type QpcrResult, type StdCurve } from './qpcr';

const TOOL_Q: ToolInfo = { id: 'lab.qpcr', name: 'qPCR relative quantification', version: '0.1.0', engine: 'TypeScript', citations: ['livak2001', 'pfaffl2001', 'vandesompele2002'], describe: (p) => `Relative expression was calculated by the ${p.method} method with reference gene(s) ${(p.refGenes as string[]).join(', ')}` };
const TOOL_D: ToolInfo = { id: 'lab.doseresponse', name: 'Dose–response fitting', version: '0.1.0', engine: 'TypeScript (Levenberg–Marquardt)', citations: ['marquardt1963', 'ritz2015', 'gottschalk2005'], describe: (p) => `${p.model} logistic curves were fitted by Levenberg–Marquardt least squares` };
const TOOL_P: ToolInfo = { id: 'lab.power', name: 'Power and sample size', version: '0.1.0', engine: 'TypeScript', citations: ['cohen1988', 'lenth1989', 'schoenfeld1981', 'hart2013'], describe: (p) => `Sample size / power was calculated for the ${p.test} design` };

type Tab = 'qpcr' | 'dose' | 'power';
const num = (s: string, d = NaN) => { const v = Number(s); return s.trim() !== '' && Number.isFinite(v) ? v : d; };
const palette = () => [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d'), '#3fb97a', '#b45fd1'];

// ---------------------------------------------------------------- demo data
function lcg(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
function demoPlate(): string {
  const r = lcg(11), lines = ['sample,group,gene,ct'], groups: [string, number, number][] = [['control', 0, 0], ['drugA', -1.6, 0.1], ['drugB', 0.9, -0.1]];
  for (const [g, dTp53, dMyc] of groups) for (let b = 1; b <= 4; b++) {
    const load = gauss(r) * 0.5, s = `${g}-${b}`;
    for (const [gene, base, shift] of [['GAPDH', 18, 0], ['ACTB', 17, 0], ['TP53', 25, dTp53], ['MYC', 27, dMyc]] as const) for (let t = 0; t < 3; t++) lines.push(`${s},${g},${gene},${(base + shift + load + gauss(r) * 0.12 + gauss(r) * 0.25 * (gene === 'TP53' || gene === 'MYC' ? 1 : 0.4)).toFixed(2)}`);
  }
  lines.push('drugA-4,drugA,TP53,27.9'); // one gross outlier to show the flag
  return lines.join('\n');
}
const LIVAK = 'sample,group,gene,ct,well\n' + (['brain', 'kidney'] as const).flatMap((s) => {
  const t = { brain: { m: [30.72, 30.34, 30.58, 30.34, 30.5, 30.43], g: [23.7, 23.56, 23.47, 23.65, 23.69, 23.68] }, kidney: { m: [27.06, 27.03, 27.03, 27.1, 26.99, 26.94], g: [22.76, 22.61, 22.62, 22.6, 22.61, 22.76] } }[s];
  return [...t.m.map((c, i) => `${s},${s},c-myc,${c},w${i}`), ...t.g.map((c, i) => `${s},${s},GAPDH,${c},w${i}`)];
}).join('\n');
const DEMO_STD = 'quantity,ct\n' + [1, 0.1, 0.01, 0.001, 0.0001].flatMap((q, i) => [0, 1, 2].map((k) => `${q},${(18.4 + 3.3 * i + [0.1, -0.08, 0.05][k]).toFixed(2)}`)).join('\n');
function demoDose(): string {
  const r = lcg(5), lines = ['compound,dose,response'], doses = Array.from({ length: 8 }, (_, i) => 1e-9 * 3 ** (i + 1) * 3);
  for (const [name, ic, h, top, bot] of [['Cmpd A', 2.5e-7, -1.1, 100, 4], ['Cmpd B', 3e-6, -0.8, 98, 10]] as const) { lines.push(`${name},0,${(top + gauss(r) * 2).toFixed(1)}`); for (const d of doses) for (let k = 0; k < 3; k++) lines.push(`${name},${d.toExponential(3)},${(bot + (top - bot) / (1 + Math.exp(-h * (Math.log(d) - Math.log(ic)))) + gauss(r) * 3).toFixed(1)}`); }
  return lines.join('\n');
}

export default function LabStudio() {
  const [tab, setTab] = useState<Tab>('qpcr');
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Lab Studio</h1><p>Bench calculators that run in your browser: qPCR relative quantification, dose–response curves, and power and sample size. Every method is checked against published worked examples or R (see the benchmarks).</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'qpcr', label: 'qPCR' }, { id: 'dose', label: 'Dose–response' }, { id: 'power', label: 'Power & sample size' }]} />
      {tab === 'qpcr' && <Qpcr />}{tab === 'dose' && <Dose />}{tab === 'power' && <Power />}
    </div>
  );
}

// ================================================================ qPCR
function Qpcr() {
  const [text, setText] = useState(''), [refs, setRefs] = useState<string[]>([]), [control, setControl] = useState(''), [effs, setEffs] = useState<Record<string, string>>({});
  const [paired, setPaired] = useState(false), [equalVar, setEqualVar] = useState(false), [delta, setDelta] = useState('0.5'), [excl, setExcl] = useState(false), [gene, setGene] = useState('');
  const [res, setRes] = useState<{ q: QpcrResult; ge: GeNormResult | null } | null>(null), { run, error } = useRunner();
  const [stdText, setStdText] = useState(''), [std, setStd] = useState<StdCurve | null>(null), [stdErr, setStdErr] = useState('');
  const parsed = useMemo(() => { try { return text ? parsePlate(text) : null; } catch (e) { return { err: (e as Error).message }; } }, [text]);
  const ok = parsed && !('err' in parsed) ? parsed : null;
  const genes = useMemo(() => (ok ? [...new Set(ok.rows.map((r) => r.gene))] : []), [ok]), groups = useMemo(() => (ok ? [...new Set(ok.rows.map((r) => r.group))] : []), [ok]);
  const hasWells = !!ok?.rows.some((r) => r.well !== undefined), ctl = groups.includes(control) ? control : groups[0] ?? '';
  const load = (t: string, r: string[], c: string, p = false) => { setText(t); setRefs(r); setControl(c); setPaired(p); setRes(null); setGene(''); };
  const go = () => { if (!ok) return; const eff = Object.fromEntries(Object.entries(effs).map(([k, v]) => [k, num(v, 2)])); const method = Object.values(eff).some((e) => Math.abs(e - 2) > 1e-9) ? 'efficiency-corrected (Pfaffl)' : 'ΔΔCt (Livak)';
    void run({ label: `qPCR · ${genes.length} genes`, tool: TOOL_Q, params: { method, refGenes: refs, controlGroup: ctl, efficiency: eff, pairedWells: paired, equalVar, outlierDelta: num(delta, 0.5), excludeOutliers: excl }, inputs: [{ name: 'plate', data: text }],
      run: async () => {
        const q = relativeQuantification(ok.rows as PlateRow[], { refGenes: refs, controlGroup: ctl, efficiency: eff, pairedWells: paired, equalVar, delta: num(delta, 0.5), excludeOutliers: excl });
        let ge: GeNormResult | null = null;
        if (refs.length >= 3) { const samples = [...new Set(q.cells.map((c) => c.sample))].filter((s) => refs.every((g) => q.cells.some((c) => c.sample === s && c.gene === g))); const ct = refs.map((g) => samples.map((s) => q.cells.find((c) => c.sample === s && c.gene === g)!.mean)); ge = geNorm(ctToQuantity(ct, refs.map((g) => eff[g] ?? 2)), refs); }
        setRes({ q, ge }); setGene(q.genes[0]?.gene ?? ''); return q;
      }, summary: () => `Relative expression was calculated by the ${method} method, normalised to ${refs.join(' and ')}, with ${ctl} as calibrator` }); };
  const g = res?.q.genes.find((x) => x.gene === gene) ?? res?.q.genes[0], cols = palette();
  const runStd = () => { try { const lines = stdText.trim().split(/\r?\n/).slice(1).map((l) => l.split(/[,\t;]/).map(Number)); setStd(standardCurve(lines.map(([quantity, ct]) => ({ quantity, ct })))); setStdErr(''); } catch (e) { setStd(null); setStdErr((e as Error).message); } };
  const stdPts = useMemo(() => stdText.trim().split(/\r?\n/).slice(1).map((l) => l.split(/[,\t;]/).map(Number)).filter((p) => p[0] > 0 && Number.isFinite(p[1])).map(([x, y]) => ({ x: Math.log10(x), y })), [stdText]);
  return (
    <div className="split"><div className="stack">
      <Card title="1 · Plate data"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => load(t, [], '')} label={text ? 'Plate loaded' : 'Plate CSV (sample, group, gene, ct) or wide (sample, group, one column per gene)'} />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><button className="btn" onClick={() => load(demoPlate(), ['GAPDH', 'ACTB'], 'control')}>Load demo (2 reference genes)</button><button className="btn" onClick={() => load(LIVAK, ['GAPDH'], 'brain', true)}>Livak 2001 example</button></div>
        {parsed && 'err' in parsed && <Callout kind="err">{parsed.err}</Callout>}
        {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.rows.length} Ct values · {genes.length} genes · {groups.length} groups{ok.undetermined ? ` · ${ok.undetermined} undetermined wells skipped` : ''}</div>}
        <div className="faint" style={{ fontSize: 11.5 }}>Replicates are repeated rows. Each biological sample is one value of <code>sample</code>; technical replicates share it.</div>
      </div></Card>
      {ok && <Card title="2 · Design"><div className="stack" style={{ gap: 10 }}>
        <Field label="Reference genes (tick one or more; geometric mean)"><div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{genes.map((x) => <label key={x} className="row" style={{ gap: 4 }}><input type="checkbox" checked={refs.includes(x)} onChange={(e) => setRefs(e.target.checked ? [...refs, x] : refs.filter((r) => r !== x))} />{x}</label>)}</div></Field>
        <Field label="Control (calibrator) group"><select className="select" value={ctl} onChange={(e) => setControl(e.target.value)}>{groups.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Amplification efficiency per gene (2 = 100 %; leave 2 for plain Livak ΔΔCt)"><div className="cols-2" style={{ gap: 6 }}>{genes.map((x) => <div key={x} className="row" style={{ gap: 6 }}><span className="mono" style={{ width: 64 }}>{x}</span><input className="input" style={{ width: 80 }} value={effs[x] ?? '2'} onChange={(e) => setEffs({ ...effs, [x]: e.target.value })} /></div>)}</div></Field>
        <div className="cols-2" style={{ gap: 8 }}><Field label="Outlier threshold (cycles from median)"><input className="input" value={delta} onChange={(e) => setDelta(e.target.value)} /></Field>
          <Field label="Test"><select className="select" value={equalVar ? 'student' : 'welch'} onChange={(e) => setEqualVar(e.target.value === 'student')}><option value="welch">Welch t-test</option><option value="student">Student t-test</option></select></Field></div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={excl} onChange={(e) => setExcl(e.target.checked)} />Exclude flagged outliers (needs ≥ 3 replicates)</label>
        {hasWells && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={paired} onChange={(e) => setPaired(e.target.checked)} />Target and reference share wells (pair by well)</label>}
        <button className="btn primary" disabled={!refs.length} onClick={go}>Calculate</button>{error && <Callout kind="err">{error}</Callout>}
      </div></Card>}
      <Card title="Standard curve" sub="efficiency from a dilution series"><div className="stack" style={{ gap: 8 }}>
        <textarea className="input mono" rows={5} placeholder={'quantity,ct\n1,18.4\n0.1,21.7\n…'} value={stdText} onChange={(e) => setStdText(e.target.value)} style={{ fontSize: 12 }} />
        <div className="row" style={{ gap: 6 }}><button className="btn" onClick={() => setStdText(DEMO_STD)}>Demo</button><button className="btn primary" disabled={!stdText.trim()} onClick={runStd}>Fit</button></div>
        {stdErr && <Callout kind="err">{stdErr}</Callout>}
        {std && <div className="stack" style={{ gap: 6 }}><div className="cols-2"><Stat label="Efficiency" value={`${fmt(std.effPct, 1)} %`} hint={`E = 10^(−1/slope) = ${fmt(10 ** (-1 / std.slope), 3)}`} /><Stat label="R²" value={std.r2.toFixed(4)} /></div>
          <div className="faint mono" style={{ fontSize: 12 }}>Ct = {fmt(std.intercept, 2)} + ({fmt(std.slope, 3)}) × log10(quantity) · slope 95 % CI {fmt(std.slopeLo, 3)} to {fmt(std.slopeHi, 3)} · efficiency 95 % CI {fmt(std.effLoPct, 1)}–{fmt(std.effHiPct, 1)} %</div>
          {std.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}
          <CurvePlot height={240} exportName="standard-curve" spec={{ series: [{ name: 'Ct', color: cols[0], points: stdPts, curve: [Math.min(...stdPts.map((p) => p.x)), Math.max(...stdPts.map((p) => p.x))].map((x) => ({ x, y: std.intercept + std.slope * x })) }], xLabel: 'log10 quantity', yLabel: 'Ct' }} /></div>}
      </div></Card>
    </div>
    <div className="stack">{!res || !g ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load a plate (or a demo), choose reference genes and calculate.</div></Card> : <>
      {res.q.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}
      <Card title="Relative expression" sub={`${ctl} = 1 · normalised to ${refs.join(' + ')}`} actions={<select className="select" style={{ width: 130 }} value={g.gene} onChange={(e) => setGene(e.target.value)}>{res.q.genes.map((x) => <option key={x.gene}>{x.gene}</option>)}</select>}>
        <BarChart labels={g.groups.map((s) => s.group)} values={g.groups.map((s) => s.fold)} errors={g.groups.map((s) => s.foldSemHi - s.fold)} errorsLo={g.groups.map((s) => s.fold - s.foldSemLo)} dots={g.groups.map((s) => g.samples.filter((v) => v.group === s.group).map((v) => v.fold))}
          colors={g.groups.map((_, i) => cols[i % cols.length])} yLabel={`${g.gene} relative expression (2^−ΔΔCt)`} fmt={(v) => fmt(v, 2)} height={300} exportName={`qpcr-${g.gene}`} />
        <div className="faint" style={{ fontSize: 11.5 }}>Bars: fold change 2^−ΔΔCt of the group mean ΔCt; error bars: ± SEM of ΔCt back-transformed (asymmetric); dots: individual biological samples.{g.efficiency !== 2 ? ` ${g.gene} efficiency ${g.efficiency}.` : ''}</div>
        {g.anova && <div className="faint" style={{ marginTop: 6 }}>One-way ANOVA on ΔCt: F({g.anova.df1}, {g.anova.df2}) = {fmt(g.anova.F, 2)}, p = {sci(g.anova.p)}</div>}
        <DataTable rowKey={(r) => r.group} rows={g.groups} cols={[
          { key: 'group', label: 'Group' }, { key: 'n', label: 'n', num: true }, { key: 'x', label: 'ΔCt (mean ± SD)', num: true, render: (r) => `${fmt(r.meanX, 2)} ± ${fmt(r.sdX, 2)}` }, { key: 'dd', label: 'ΔΔCt', num: true, render: (r) => fmt(r.ddct, 2) },
          { key: 'fold', label: 'Fold change', num: true, render: (r) => fmt(r.fold, 2) }, { key: 'rng', label: 'Range 2^−(ΔΔCt ± SD)', num: true, render: (r) => `${fmt(r.foldLo, 2)}–${fmt(r.foldHi, 2)}` },
          { key: 'p', label: 'p', num: true, render: (r) => (r.p === undefined ? '–' : sci(r.p)) }, { key: 'pa', label: 'p (Holm)', num: true, render: (r) => (r.pAdj === undefined ? '–' : sci(r.pAdj)) }]} />
        <div className="row" style={{ marginTop: 8, gap: 6 }}><button className="btn sm" onClick={() => downloadText('qpcr_results.csv', toCsv(res.q.genes.flatMap((x) => x.groups.map((s) => ({ gene: x.gene, group: s.group, n: s.n, meanDeltaCt: s.meanX, sdDeltaCt: s.sdX, ddCt: s.ddct, fold: s.fold, fold_lo_sd: s.foldLo, fold_hi_sd: s.foldHi, p: s.p ?? '', p_holm: s.pAdj ?? '' })))), 'text/csv')}>Export CSV</button></div>
      </Card>
      {res.ge && <Card title="Reference-gene stability" sub="geNorm M (lower = more stable; below 0.5 is good for homogeneous samples)"><DataTable rowKey={(r) => r.g} rows={res.ge.ranking.map((n, i) => ({ g: n, rank: i + 1, M: res.ge!.steps[0].genes.includes(n) ? res.ge!.steps[0].M[res.ge!.steps[0].genes.indexOf(n)] : NaN }))} cols={[{ key: 'rank', label: 'Rank (best first)', num: true }, { key: 'g', label: 'Gene' }, { key: 'M', label: 'M (all genes)', num: true, render: (r) => fmt(r.M, 3) }]} />
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Pairwise variation V(n/n+1): {res.ge.steps.filter((s) => s.variation !== undefined).map((s) => `${s.genes.length}/${s.genes.length - 1}: ${fmt(s.variation!, 3)}`).join(' · ')} (below 0.15 means the extra gene is not needed).</div></Card>}
      <Card title="Technical replicates" sub={`${res.q.cells.filter((c) => c.note).length} of ${res.q.cells.length} sample × gene groups flagged`}><DataTable limit={60} rowKey={(r) => r.sample + r.gene} rows={[...res.q.cells].sort((a, b) => (b.note ? 1 : 0) - (a.note ? 1 : 0))} cols={[{ key: 'sample', label: 'Sample' }, { key: 'gene', label: 'Gene' }, { key: 'values', label: 'Ct values', render: (r) => r.values.map((v, i) => <span key={i} style={{ color: r.flagged[i] ? 'var(--danger)' : undefined, marginRight: 6 }}>{v.toFixed(2)}</span>) }, { key: 'mean', label: 'Mean', num: true, render: (r) => fmt(r.mean, 2) }, { key: 'sd', label: 'SD', num: true, render: (r) => fmt(r.sd, 2) }, { key: 'note', label: 'Flag' }]} /></Card>
    </>}</div></div>
  );
}

// ================================================================ dose–response
interface DrRow { name: string; fit?: FitResult; err?: string; pts: { x: number; y: number }[] }
function Dose() {
  const [text, setText] = useState(''), [model, setModel] = useState<Model>('4PL'), [fixTop, setFixTop] = useState(''), [fixBot, setFixBot] = useState(''), [fixHill, setFixHill] = useState(''), [logX, setLogX] = useState(true);
  const [res, setRes] = useState<DrRow[] | null>(null), { run, error } = useRunner(), cols = palette();
  const parsed = useMemo(() => { try { return text ? parseDoseResponse(text) : null; } catch (e) { return { err: (e as Error).message }; } }, [text]);
  const ok = parsed && !('err' in parsed) ? parsed : null;
  const go = () => { if (!ok) return; const fixed: Fixed = {}; if (fixTop.trim()) fixed.top = num(fixTop); if (fixBot.trim()) fixed.bottom = num(fixBot); if (fixHill.trim()) fixed.hill = num(fixHill);
    void run({ label: `Dose–response · ${ok.groups.size} curve(s)`, tool: TOOL_D, params: { model, fixed }, inputs: [{ name: 'doseresponse', data: text }],
      run: async () => { const out = [...ok.groups].map(([name, pts]) => { try { return { name, pts, fit: fitDoseResponse(pts, model, fixed) }; } catch (e) { return { name, pts, err: (e as Error).message }; } }); setRes(out); return out; },
      summary: () => `${model} dose–response curves were fitted by Levenberg–Marquardt${Object.keys(fixed).length ? ` with ${Object.entries(fixed).map(([k, v]) => `${k} fixed at ${v}`).join(', ')}` : ''}; IC50 confidence intervals are 95 % Wald (t) intervals` }); };
  const spec: CurveSpec | null = useMemo(() => {
    if (!res) return null; const all = res.flatMap((r) => r.pts.map((p) => p.x)).filter((x) => x > 0), lo = Math.min(...all) / 2, hi = Math.max(...all) * 2;
    const series: CurveSeries[] = res.map((r, i) => ({ name: r.name, color: cols[i % cols.length], points: logX ? r.pts.filter((p) => p.x > 0) : r.pts, curve: r.fit ? curvePoints(r.fit, lo, hi) : undefined }));
    return { series, xLabel: 'Dose', yLabel: 'Response', logX, vlines: res.flatMap((r, i) => (r.fit ? [{ x: r.fit.x50, color: cols[i % cols.length] }] : [])) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, logX]);
  return (
    <div className="split"><div className="stack">
      <Card title="1 · Data"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setText(t); setRes(null); }} label={text ? 'Data loaded' : 'CSV: [compound,] dose, response (replicates as repeated rows)'} />
        <button className="btn" onClick={() => { setText(demoDose()); setRes(null); }}>Load demo (two compounds, 3 replicates)</button>
        {parsed && 'err' in parsed && <Callout kind="err">{parsed.err}</Callout>}
        {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.groups.size} curve(s): {[...ok.groups].map(([n, p]) => `${n} (${p.length} points)`).join(', ')} {ok.note}</div>}
        <div className="faint" style={{ fontSize: 11.5 }}>Dose 0 rows are kept as the zero-dose asymptote (as in R drc) but cannot be shown on a log axis.</div>
      </div></Card>
      <Card title="2 · Model"><div className="stack" style={{ gap: 10 }}>
        <Field label="Logistic model"><select className="select" value={model} onChange={(e) => setModel(e.target.value as Model)}><option value="4PL">4PL (symmetric)</option><option value="5PL">5PL (asymmetric)</option></select></Field>
        <div className="cols-2" style={{ gap: 8 }}><Field label="Fix top (optional)"><input className="input" placeholder="e.g. 100" value={fixTop} onChange={(e) => setFixTop(e.target.value)} /></Field><Field label="Fix bottom (optional)"><input className="input" placeholder="e.g. 0" value={fixBot} onChange={(e) => setFixBot(e.target.value)} /></Field></div>
        <Field label="Fix Hill slope (optional; negative = falling curve)"><input className="input" value={fixHill} onChange={(e) => setFixHill(e.target.value)} /></Field>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={logX} onChange={(e) => setLogX(e.target.checked)} />Log dose axis</label>
        <button className="btn primary" disabled={!ok} onClick={go}>Fit curves</button>{error && <Callout kind="err">{error}</Callout>}
      </div></Card>
    </div>
    <div className="stack">{!res || !spec ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load dose–response data (or the demo) and fit.</div></Card> : <>
      <Card title="Dose–response curves" sub={`${model} · dashed lines mark the IC50 of each curve`}><CurvePlot spec={spec} height={380} exportName="dose-response" /></Card>
      <Card title="Fit results" pad={false}><DataTable<DrRow> rowKey={(r) => r.name} rows={res} cols={[
        { key: 'name', label: 'Curve' }, { key: 'n', label: 'n', num: true, render: (r) => r.fit?.n ?? '–' },
        { key: 'ic', label: model === '5PL' ? 'IC50 (midpoint)' : 'IC50 / EC50', num: true, render: (r) => (r.fit ? sci3(r.fit.x50) : r.err) },
        { key: 'ci', label: '95 % CI', num: true, render: (r) => (r.fit ? `${sci3(model === '5PL' ? r.fit.x50Lo : r.fit.ec50LogLo)} – ${sci3(model === '5PL' ? r.fit.x50Hi : r.fit.ec50LogHi)}` : '') },
        { key: 'wald', label: 'Wald CI (linear)', num: true, render: (r) => (r.fit ? `${sci3(r.fit.ec50Lo)} – ${sci3(r.fit.ec50Hi)}` : '') },
        { key: 'h', label: 'Hill slope', num: true, render: (r) => (r.fit ? `${fmt(r.fit.hill, 2)} ± ${fmt(r.fit.params[3].se, 2)}` : '') }, { key: 'top', label: 'Top', num: true, render: (r) => (r.fit ? fmt(r.fit.top, 1) : '') }, { key: 'bot', label: 'Bottom', num: true, render: (r) => (r.fit ? fmt(r.fit.bottom, 1) : '') },
        ...(model === '5PL' ? [{ key: 'asym', label: 'Asymmetry', num: true, render: (r: DrRow) => (r.fit ? fmt(r.fit.asym, 2) : '') }] : []), { key: 'r2', label: 'R²', num: true, render: (r) => (r.fit ? r.fit.r2.toFixed(4) : '') }]} />
        <div className="faint" style={{ padding: 10, fontSize: 12 }}>IC50 here is the dose at the midpoint response. The 95 % CI is asymmetric on the log scale (t interval on ln EC50); the linear Wald interval matches R drc's confint(). Hill slope is negative for falling curves.</div></Card>
      {res.flatMap((r) => (r.fit?.warnings ?? []).map((w) => <Callout key={r.name + w} kind="warn"><b>{r.name}:</b> {w}</Callout>))}
      <div className="row"><button className="btn sm" onClick={() => downloadText('dose_response_fits.csv', toCsv(res.filter((r) => r.fit).map((r) => ({ curve: r.name, model, n: r.fit!.n, ic50: r.fit!.x50, ec50_param: r.fit!.ec50, ec50_ci_lo: r.fit!.ec50LogLo, ec50_ci_hi: r.fit!.ec50LogHi, hill: r.fit!.hill, top: r.fit!.top, bottom: r.fit!.bottom, asym: r.fit!.asym, r2: r.fit!.r2, rss: r.fit!.rss }))), 'text/csv')}>Export CSV</button></div>
    </>}</div></div>
  );
}
const sci3 = (v: number) => (!Number.isFinite(v) ? '–' : v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e5) ? v.toExponential(2) : String(+v.toPrecision(3)));

// ================================================================ power
type PTest = 't2' | 'tp' | 'anova' | 'prop' | 'logrank' | 'rna';
const TESTS: [PTest, string][] = [['t2', 'Two-sample t-test'], ['tp', 'Paired / one-sample t-test'], ['anova', 'One-way ANOVA'], ['prop', 'Two proportions'], ['logrank', 'Log-rank (survival)'], ['rna', 'RNA-seq differential expression']];
function Power() {
  const [test, setTest] = useState<PTest>('t2'), [solve, setSolve] = useState<'n' | 'power' | 'effect'>('n'), { run } = useRunner();
  const [alpha, setAlpha] = useState('0.05'), [powr, setPowr] = useState('0.8'), [n, setN] = useState('20'), [alt, setAlt] = useState<Alt>('two.sided');
  const [diff, setDiff] = useState('5'), [sdv, setSdv] = useState('8'), [k, setK] = useState('3'), [f, setF] = useState('0.25'), [p1, setP1] = useState('0.5'), [p2, setP2] = useState('0.3');
  const [hr, setHr] = useState('0.65'), [alloc, setAlloc] = useState('0.5'), [med, setMed] = useState('12'), [acc, setAcc] = useState('12'), [fu, setFu] = useState('12'), [events, setEvents] = useState('100');
  const [depth, setDepth] = useState('20'), [cv, setCv] = useState('0.4'), [fc, setFc] = useState('2');
  const a = num(alpha, 0.05), pw = num(powr, 0.8), nn = num(n, 20), d = num(diff) / num(sdv), kk = Math.round(num(k, 3)), ff = num(f), h = cohenH(num(p1), num(p2)), HR = num(hr), al = num(alloc, 0.5);
  const type: TType = test === 'tp' ? 'paired' : 'two.sample';
  const calc = useMemo(() => {
    try {
      const out: { label: string; value: string; note?: string }[] = []; let curve: { x: number; y: number }[][] = [], names: string[] = [], xLabel = 'Sample size per group', mark: number | undefined;
      const scales = [0.75, 1, 1.25], grid = (hi: number, pts = 60, lo = 2) => Array.from({ length: pts }, (_, i) => lo + ((hi - lo) * i) / (pts - 1));
      if (test === 't2' || test === 'tp') {
        const eff = solve === 'effect' ? effectT(nn, pw, a, type, alt) : d;
        const nSolved = solve === 'n' ? sampleSizeT(eff, pw, a, type, alt) : nn;
        if (solve === 'n') out.push({ label: `n per ${test === 't2' ? 'group' : 'pair'}`, value: String(Math.ceil(nSolved)), note: `exact ${fmt(nSolved, 2)}; total ${test === 't2' ? 2 * Math.ceil(nSolved) : Math.ceil(nSolved)}` });
        if (solve === 'power') out.push({ label: 'Power', value: fmt(powerT(nn, eff, a, type, alt) * 100, 1) + ' %' });
        if (solve === 'effect') out.push({ label: "Cohen's d", value: fmt(eff, 3), note: `detectable difference ${fmt(eff * num(sdv), 2)} at SD ${sdv}` });
        mark = nSolved; xLabel = test === 't2' ? 'n per group' : 'n pairs'; const hi = Math.max(10, Math.ceil(nSolved * 2));
        curve = scales.map((s) => grid(hi).map((x) => ({ x, y: powerT(x, eff * s, a, type, alt) }))); names = scales.map((s) => `d = ${fmt(eff * s, 2)}`);
      } else if (test === 'anova') {
        const eff = solve === 'effect' ? effectAnova(kk, nn, pw, a) : ff, nSolved = solve === 'n' ? sampleSizeAnova(kk, eff, pw, a) : nn;
        if (solve === 'n') out.push({ label: 'n per group', value: String(Math.ceil(nSolved)), note: `exact ${fmt(nSolved, 2)}; total ${kk * Math.ceil(nSolved)}` });
        if (solve === 'power') out.push({ label: 'Power', value: fmt(powerAnova(kk, nn, eff, a) * 100, 1) + ' %' });
        if (solve === 'effect') out.push({ label: "Cohen's f", value: fmt(eff, 3), note: 'small 0.1 · medium 0.25 · large 0.4' });
        mark = nSolved; const hi = Math.max(10, Math.ceil(nSolved * 2)); curve = scales.map((s) => grid(hi).map((x) => ({ x, y: powerAnova(kk, x, eff * s, a) }))); names = scales.map((s) => `f = ${fmt(eff * s, 2)}`);
      } else if (test === 'prop') {
        const nSolved = solve === 'n' ? sampleSizeProp(h, pw, a, alt) : nn;
        out.push({ label: "Cohen's h", value: fmt(h, 3), note: 'arcsine effect size, as in R pwr.2p.test' });
        if (solve === 'n') out.push({ label: 'n per group', value: String(Math.ceil(nSolved)), note: `exact ${fmt(nSolved, 2)}; total ${2 * Math.ceil(nSolved)}` });
        if (solve === 'power') out.push({ label: 'Power', value: fmt(powerProp(nn, h, a, alt) * 100, 1) + ' %' });
        mark = nSolved; const hi = Math.max(10, Math.ceil(nSolved * 2)); curve = scales.map((s) => grid(hi).map((x) => ({ x, y: powerProp(x, h * s, a, alt) }))); names = scales.map((s) => `h = ${fmt(h * s, 2)}`);
      } else if (test === 'logrank') {
        xLabel = 'Events';
        if (solve === 'n') { const ev = logrankEvents(HR, pw, a, al); out.push({ label: 'Events required', value: String(Math.ceil(ev)), note: 'Schoenfeld: (z_α/2 + z_β)² / (p₁p₂ ln²HR)' }); mark = ev;
          if ([med, acc, fu].every((v) => num(v) > 0)) { const plan = logrankSampleSize(HR, num(med), num(acc), num(fu), pw, a, al); out.push({ label: 'Total subjects', value: String(Math.ceil(plan.n)), note: `control ${Math.ceil(plan.nControl)} · treatment ${Math.ceil(plan.nTreat)}; event probability ${fmt(plan.pEventControl * 100, 0)} % / ${fmt(plan.pEventTreat * 100, 0)} % (exponential, uniform accrual)` }); } }
        else out.push({ label: 'Power', value: fmt(logrankPower(num(events), HR, a, al) * 100, 1) + ' %' });
        const hi = Math.max(40, Math.ceil((mark ?? num(events)) * 2)); curve = [0.8, 1, 1.25].map((s) => grid(hi, 60, 5).map((x) => ({ x, y: logrankPower(x, Math.exp(Math.log(HR) * s), a, al) }))); names = [0.8, 1, 1.25].map((s) => `HR = ${fmt(Math.exp(Math.log(HR) * s), 2)}`);
      } else {
        const D = num(depth), C = num(cv), E = num(fc);
        if (solve === 'n') { const v = rnaseqSampleSize(D, C, E, pw, a); out.push({ label: 'n per group', value: String(Math.ceil(v)), note: `exact ${fmt(v, 2)}; Hart et al. 2013` }); mark = v; }
        if (solve === 'power') out.push({ label: 'Power', value: fmt(rnaseqPower(D, nn, C, E, a) * 100, 1) + ' %' });
        if (solve === 'effect') out.push({ label: 'Detectable fold change', value: fmt(rnaseqEffect(D, nn, C, pw, a), 3) });
        const cvOk = rnaseqCv(D, nn, E, pw, a); if (solve === 'n' || solve === 'power') out.push({ label: 'Largest CV at this n', value: fmt(cvOk, 3), note: 'biological coefficient of variation you can tolerate' });
        const hi = Math.max(6, Math.ceil((mark ?? nn) * 2)); curve = [0.75, 1, 1.25].map((s) => grid(hi).map((x) => ({ x, y: rnaseqPower(D, x, C, 2 ** (Math.log2(E) * s), a) }))); names = [0.75, 1, 1.25].map((s) => `${fmt(2 ** (Math.log2(E) * s), 2)}-fold`);
      }
      return { out, curve, names, xLabel, mark, err: '' };
    } catch (e) { return { out: [], curve: [] as { x: number; y: number }[][], names: [] as string[], xLabel: '', mark: undefined, err: (e as Error).message }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test, solve, a, pw, nn, alt, diff, sdv, k, f, p1, p2, hr, alloc, med, acc, fu, events, depth, cv, fc]);
  const cols = palette();
  const spec: CurveSpec = { series: calc.curve.map((c, i) => ({ name: calc.names[i], color: cols[i % cols.length], curve: c })), xLabel: calc.xLabel, yLabel: 'Power', yMin: 0, yMax: 1, hlines: [pw], vlines: calc.mark !== undefined && Number.isFinite(calc.mark) ? [{ x: calc.mark, label: `n = ${Math.ceil(calc.mark)}` }] : [] };
  const record = () => void run({ label: `Power · ${TESTS.find((t) => t[0] === test)![1]}`, tool: TOOL_P, params: { test, solve, alpha: a, power: pw, n: nn, alternative: alt }, inputs: [], run: async () => calc, summary: () => `${calc.out.map((o) => `${o.label} ${o.value}`).join(', ')} (${TESTS.find((t) => t[0] === test)![1]}, α = ${a}, power ${pw})` });
  const Num = ({ label, v, set, ph }: { label: string; v: string; set(s: string): void; ph?: string }) => <Field label={label}><input className="input" value={v} placeholder={ph} onChange={(e) => set(e.target.value)} /></Field>;
  const canEffect = test === 't2' || test === 'tp' || test === 'anova' || test === 'rna';
  return (
    <div className="split"><div className="stack">
      <Card title="Design"><div className="stack" style={{ gap: 10 }}>
        <Field label="Test"><select className="select" value={test} onChange={(e) => { setTest(e.target.value as PTest); setSolve('n'); }}>{TESTS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field>
        <Field label="Solve for"><select className="select" value={solve} onChange={(e) => setSolve(e.target.value as 'n' | 'power' | 'effect')}><option value="n">{test === 'logrank' ? 'Events and subjects' : 'Sample size'}</option><option value="power">Power</option>{canEffect && <option value="effect">Detectable effect</option>}</select></Field>
        <div className="cols-2" style={{ gap: 8 }}><Num label="Significance α" v={alpha} set={setAlpha} />{solve !== 'power' ? <Num label="Power" v={powr} set={setPowr} /> : test === 'logrank' ? <Num label="Events" v={events} set={setEvents} /> : <Num label="n per group" v={n} set={setN} />}</div>
        {solve === 'effect' && <Num label="n per group" v={n} set={setN} />}
        {(test === 't2' || test === 'tp') && solve !== 'effect' && <div className="cols-2" style={{ gap: 8 }}><Num label="Mean difference" v={diff} set={setDiff} /><Num label="SD (within group)" v={sdv} set={setSdv} /></div>}
        {(test === 't2' || test === 'tp') && solve === 'effect' && <Num label="SD (to express the effect in your units)" v={sdv} set={setSdv} />}
        {(test === 't2' || test === 'tp') && solve !== 'effect' && <div className="faint" style={{ fontSize: 12 }}>Cohen's d = {fmt(d, 3)}</div>}
        {test === 'anova' && <div className="cols-2" style={{ gap: 8 }}><Num label="Groups" v={k} set={setK} />{solve !== 'effect' && <Num label="Effect size f" v={f} set={setF} ph="0.25" />}</div>}
        {test === 'prop' && <div className="cols-2" style={{ gap: 8 }}><Num label="Proportion, group 1" v={p1} set={setP1} /><Num label="Proportion, group 2" v={p2} set={setP2} /></div>}
        {test === 'logrank' && <><div className="cols-2" style={{ gap: 8 }}><Num label="Hazard ratio" v={hr} set={setHr} /><Num label="Fraction in treatment arm" v={alloc} set={setAlloc} /></div>
          {solve === 'n' && <div className="cols-2" style={{ gap: 8 }}><Num label="Control median survival" v={med} set={setMed} /><Num label="Accrual time" v={acc} set={setAcc} /><Num label="Follow-up after accrual" v={fu} set={setFu} /></div>}</>}
        {test === 'rna' && <div className="cols-2" style={{ gap: 8 }}><Num label="Read depth per gene" v={depth} set={setDepth} /><Num label="Biological CV" v={cv} set={setCv} />{solve !== 'effect' && <Num label="Fold change" v={fc} set={setFc} />}</div>}
        {test !== 'anova' && test !== 'logrank' && test !== 'rna' && <Field label="Alternative"><select className="select" value={alt} onChange={(e) => setAlt(e.target.value as Alt)}><option value="two.sided">Two-sided</option><option value="greater">One-sided (greater)</option><option value="less">One-sided (less)</option></select></Field>}
        <button className="btn" onClick={record}>Add to methods log</button>
      </div></Card>
      <Callout><div>Equal group sizes are assumed. t-test, ANOVA and proportion results reproduce R <code>pwr</code>; RNA-seq reproduces <code>RNASeqPower::rnapower</code>; log-rank events follow Schoenfeld (<code>gsDesign::nEvents</code>). Treat any result as a planning estimate, and round n up.</div></Callout>
    </div>
    <div className="stack">
      {calc.err ? <Callout kind="err">{calc.err}</Callout> : <div className="cols-3">{calc.out.map((o) => <Stat key={o.label} label={o.label} value={o.value} hint={o.note} />)}</div>}
      {calc.out.map((o) => o.note && <div key={o.label} className="faint" style={{ fontSize: 12 }}>{o.label}: {o.note}</div>)}
      {!calc.err && <Card title="Power curves" sub="dashed horizontal line = target power"><CurvePlot spec={spec} height={340} exportName="power-curve" /></Card>}
    </div></div>
  );
}

