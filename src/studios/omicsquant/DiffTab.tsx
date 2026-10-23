import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, Stat, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { Scatter, cssVar, type Pt } from '@/viz/charts';
import { differential, type DiffResult } from './prep';
import type { OmicsOptions, OmicsView } from './OmicsQuantStudio';

const TOOL: ToolInfo = {
  id: 'omicsquant.differential', name: 'Differential abundance', version: '0.1.0',
  engine: 'TypeScript; limma-style empirical-Bayes moderated t and Benjamini–Hochberg FDR',
  citations: ['smyth2004', 'benjamini1995', 'cox2014', 'lazar2016', 'bolstad2003'],
  describe: (p) => `Log2 intensities were ${p.normalisation === 'median' ? 'median-centred' : p.normalisation === 'quantile' ? 'quantile-normalised' : 'not normalised'}${p.pseudocount ? ' (pseudocount 1 before log2)' : ''}; missing values were ${p.imputation === 'none' ? 'left missing and incomplete features excluded' : `imputed with ${p.imputation}`}; ${p.contrast} was tested with an empirical-Bayes moderated t-statistic, and p-values were adjusted by Benjamini–Hochberg.`,
};

export default function DiffTab({ view, options, matrixText, sheetText, truth }: {
  view: OmicsView; options: OmicsOptions; matrixText: string; sheetText: string; truth: Set<string> | null;
}) {
  const levels = view.groups ? [...new Set(view.groups)] : [];
  const [num, setNum] = useState(''), [den, setDen] = useState('');
  const A = levels.includes(num) ? num : (levels.length > 1 ? levels[levels.length - 1] : '');
  const B = levels.includes(den) && den !== A ? den : (levels.find((l) => l !== A) ?? '');
  const [res, setRes] = useState<DiffResult | null>(null);
  const { run, busy, error } = useRunner();

  const go = () => {
    if (!view.prepared || !view.groups || !A || !B) return;
    const contrast = { numerator: A, denominator: B };
    void run({
      label: `Differential abundance · ${A} vs ${B}`, tool: TOOL,
      params: { contrast: `${A} vs ${B}`, normalisation: options.norm, imputation: options.method, pseudocount: options.pseudocount },
      inputs: [{ name: 'intensity matrix', data: matrixText }, { name: 'sample sheet', data: sheetText }],
      run: async () => {
        const r = differential(view.prepared!, view.groups!, contrast, { imputed: view.mask ?? undefined });
        setRes(r);
        return { tested: r.tested };
      },
      summary: () => `${A} vs ${B} with ${options.norm} normalisation and ${options.method} imputation`,
    });
  };

  const volcano: Pt[] = useMemo(() => (res ? res.rows.map((r) => ({ x: r.logFC, y: -Math.log10(Math.max(r.p, 1e-300)), cat: r.sig === 'ns' ? 0 : r.sig === 'up' ? 1 : 2, label: r.id })) : []), [res]);
  const rows = useMemo(() => (res ? [...res.rows].sort((a, b) => a.p - b.p) : []), [res]);
  const up = res ? res.rows.filter((r) => r.sig === 'up').length : 0;
  const down = res ? res.rows.filter((r) => r.sig === 'down').length : 0;
  const truthStats = truth && res ? (() => {
    const tested = res.rows.filter((r) => truth.has(r.id));
    const tp = tested.filter((r) => r.fdr <= 0.05).length;
    const fp = res.rows.filter((r) => !truth.has(r.id) && r.fdr <= 0.05).length;
    return { tested: tested.length, tp, fp };
  })() : null;
  const colours = [cssVar('--chart-c'), cssVar('--chart-b'), cssVar('--chart-a')];
  const exportCsv = () => {
    if (!res) return;
    downloadText('differential_abundance.csv', toCsv(res.rows.map((r) => ({ feature: r.id, log2FC: r.logFC, mean_log2: r.avg, t: r.t, p: r.p, fdr: r.fdr, call: r.sig, observed_A: r.nA, observed_B: r.nB }))), 'text/csv');
  };

  if (!view.raw) return <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load an intensity matrix and sample sheet first.</div></Card>;
  if (view.error || view.sheetError) return <Callout kind="err">{view.error ?? view.sheetError}</Callout>;
  if (levels.length < 2) return <Callout kind="warn">The differential test needs a sample sheet with at least two groups.</Callout>;

  return <div className="split"><div className="stack">
    <Card title="1 · Contrast"><div className="stack" style={{ gap: 10 }}>
      <div className="cols-2" style={{ gap: 8 }}>
        <Field label="Numerator (positive logFC)"><select className="select" value={A} onChange={(e) => setNum(e.target.value)}>{levels.map((l) => <option key={l} value={l}>{l}</option>)}</select></Field>
        <Field label="Denominator"><select className="select" value={B} onChange={(e) => setDen(e.target.value)}>{levels.filter((l) => l !== A).map((l) => <option key={l} value={l}>{l}</option>)}</select></Field>
      </div>
      <div className="faint" style={{ fontSize: 12 }}>{view.prepared?.ids.length.toLocaleString()} features · {options.norm} normalisation · {options.method} imputation. Imputed cells enter the moderated fit with a small weight.</div>
      <button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Testing…' : 'Run differential test'}</button>
      {error && <Callout kind="err">{error}</Callout>}
    </div></Card>
    <Callout>Moderated t-test (limma-style empirical Bayes) with Benjamini–Hochberg FDR. Features with fewer than two observed values in either group before imputation are excluded. For label-free DIA/DDA quantification, start from the vendor or DIA-NN output matrix.</Callout>
  </div>
  <div className="stack">
    {!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Choose a contrast and run the test.</div></Card> : <>
      <div className="cols-4">
        <Stat label="Features tested" value={res.tested.toLocaleString()} hint={`${res.excluded} excluded`} />
        <Stat label="Up" value={<span style={{ color: colours[1] }}>{up.toLocaleString()}</span>} hint={`positive in ${A}`} />
        <Stat label="Down" value={<span style={{ color: colours[2] }}>{down.toLocaleString()}</span>} hint={`negative in ${A}`} />
        <Stat label="Prior df (EB)" value={Number.isFinite(res.priorDf) ? fmt(res.priorDf, 1) : '∞'} hint="variance shrinkage" />
      </div>
      {truthStats && <Callout><b style={{ color: 'var(--text)' }}>Spiked features:</b>&nbsp;{truthStats.tp}/{truthStats.tested} tested spiked features recovered at FDR 0.05 ({fmt((100 * truthStats.tp) / Math.max(1, truthStats.tested), 0)}%) · {truthStats.fp} false positive{truthStats.fp === 1 ? '' : 's'}</Callout>}
      <Card title="Volcano" sub={`${A} vs ${B} · ${options.norm} · ${options.method}`}><Scatter points={volcano} colors={colours} names={['not significant', `up in ${A}`, `down in ${A}`]} xLabel="log2 fold change" yLabel="-log10 p" labelScore={(q) => Math.abs(q.x) * q.y} labelDefault={10} exportName="omics-volcano" height={380} /></Card>
      <Card title="Differential abundance results" pad={false} actions={<button className="btn sm" onClick={exportCsv}>Export CSV</button>}>
        <DataTable rowKey={(r, i) => r.id + '#' + i} rows={rows} cols={[
          { key: 'id', label: 'Feature', sort: (r) => r.id },
          { key: 'logFC', label: 'log2FC', num: true, render: (r) => fmt(r.logFC, 3), sort: (r) => r.logFC },
          { key: 'avg', label: 'Mean log2', num: true, render: (r) => fmt(r.avg, 2), sort: (r) => r.avg },
          { key: 't', label: 't', num: true, render: (r) => fmt(r.t, 2), sort: (r) => r.t },
          { key: 'p', label: 'p-value', num: true, render: (r) => sci(r.p), sort: (r) => r.p },
          { key: 'fdr', label: 'FDR', num: true, render: (r) => sci(r.fdr), sort: (r) => r.fdr },
          { key: 'sig', label: 'Call', render: (r) => <span className={`badge ${r.sig === 'ns' ? 'planned' : r.sig === 'up' ? 'building' : 'live'}`}>{r.sig}</span> },
        ]} />
      </Card>
    </>}
  </div></div>;
}
