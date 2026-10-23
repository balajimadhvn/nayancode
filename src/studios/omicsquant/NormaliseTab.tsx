import { useMemo } from 'react';
import { Callout, Card, Field, Stat, fmt } from '@/ui/kit';
import { BarChart, cssVar } from '@/viz/charts';
import type { ImputeMethod, NormMethod, QuantMatrix } from './prep';
import type { OmicsOptions, OmicsView } from './OmicsQuantStudio';

const medians = (m: QuantMatrix | null) => {
  if (!m) return [];
  return m.samples.map((_, j) => {
    const v: number[] = [];
    for (let i = 0; i < m.ids.length; i++) { const x = m.values[i * m.samples.length + j]; if (!Number.isNaN(x)) v.push(x); }
    v.sort((a, b) => a - b);
    const h = v.length >> 1;
    return v.length ? (v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2) : NaN;
  });
};

export default function NormaliseTab({ view, options, setMinValid, setNorm, setMethod, setSeed, setPseudocount }: {
  view: OmicsView; options: OmicsOptions;
  setMinValid(n: number): void; setNorm(n: NormMethod): void; setMethod(n: ImputeMethod): void; setSeed(n: number): void; setPseudocount(b: boolean): void;
}) {
  const before = useMemo(() => medians(view.logged), [view.logged]);
  const after = useMemo(() => medians(view.normalised), [view.normalised]);
  const samples = view.raw?.samples ?? [];
  const levels = view.groups ? [...new Set(view.groups)] : [];
  const palette = [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d')];
  const colours = samples.map((_, j) => (view.groups ? palette[levels.indexOf(view.groups[j]) % palette.length] : cssVar('--chart-a')));
  const imputed = view.mask ? view.mask.reduce((a, v) => a + v, 0) : 0;
  const cells = view.prepared ? view.prepared.ids.length * view.prepared.samples.length : 0;
  let remaining = 0;
  if (view.prepared) for (const v of view.prepared.values) if (Number.isNaN(v)) remaining++;
  const filteredOut = view.logged && view.normalised ? view.logged.ids.length - view.normalised.ids.length : 0;

  if (!view.raw) return <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load an intensity matrix to set up normalisation and imputation.</div></Card>;
  if (view.error) return <Callout kind="err">{view.error}</Callout>;

  return <div className="split"><div className="stack">
    <Card title="1 · Transform and filter"><div className="stack" style={{ gap: 10 }}>
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={options.pseudocount} onChange={(e) => setPseudocount(e.target.checked)} />Add a pseudocount of 1 before log2</label>
      <Field label="Minimum observed values in a group"><input className="input" type="number" min={1} step={1} value={options.minValid} onChange={(e) => setMinValid(Math.max(1, Math.round(Number(e.target.value) || 1)))} /></Field>
      <div className="faint" style={{ fontSize: 12 }}>A feature is kept when at least one group has this many observed values. {view.groups ? `${filteredOut.toLocaleString()} feature(s) removed by this filter.` : 'Load a sample sheet to enable group filtering.'}</div>
    </div></Card>
    <Card title="2 · Normalisation"><div className="stack" style={{ gap: 10 }}>
      <Field label="Method"><select className="select" value={options.norm} onChange={(e) => setNorm(e.target.value as NormMethod)}>
        <option value="none">None</option><option value="median">Median centring</option><option value="quantile">Quantile</option>
      </select></Field>
      <div className="faint" style={{ fontSize: 12 }}>{options.norm === 'median' ? 'Subtracts each sample median of log2 values and adds back the grand median.' : options.norm === 'quantile' ? 'Rank-average quantile normalisation; tied values receive the averaged reference quantile and missing values are ignored.' : 'No between-sample adjustment; useful to inspect raw log2 intensities.'}</div>
    </div></Card>
    <Card title="3 · Imputation"><div className="stack" style={{ gap: 10 }}>
      <Field label="Method"><select className="select" value={options.method} onChange={(e) => setMethod(e.target.value as ImputeMethod)}>
        <option value="none">None</option><option value="minprob">MinProb (left-censored normal)</option><option value="knn">k-nearest neighbours (k = 10)</option><option value="halfmin">Half the feature minimum</option>
      </select></Field>
      <Field label="MinProb seed"><input className="input" type="number" min={1} step={1} value={options.seed} disabled={options.method !== 'minprob'} onChange={(e) => setSeed(Math.max(1, Math.round(Number(e.target.value) || 1)))} /></Field>
      <div className="faint" style={{ fontSize: 12 }}>{options.method === 'minprob' ? 'Draws missing values from N(μ, σ) with μ = 1 % quantile of observed values and σ = 0.3 × median feature SD (Perseus-like, seeded).' : options.method === 'knn' ? 'Averages the 10 nearest features (Euclidean, features with ≥ 70 % observed values).' : options.method === 'halfmin' ? 'Fills each feature with half of its minimum observed value.' : 'Missing cells stay missing; the differential test then excludes features that are not complete.'}</div>
    </div></Card>
  </div>
  <div className="stack">
    <div className="cols-2">
      <Stat label="Features kept" value={view.normalised?.ids.length.toLocaleString() ?? '—'} hint={view.logged ? `${view.logged.ids.length.toLocaleString()} before the group filter` : undefined} />
      <Stat label="Imputed cells" value={imputed.toLocaleString()} hint={`${fmt((100 * imputed) / Math.max(1, cells), 1)}% of the matrix`} />
    </div>
    {remaining > 0 && <Callout kind="warn">{remaining.toLocaleString()} cells are still missing. The differential test excludes features that are not complete; choose an imputation method to keep more features.</Callout>}
    <div className="cols-2">
      <Card title="Sample medians before" sub="log2 intensity"><BarChart labels={samples} values={before} colors={colours} yLabel="Median log2" fmt={(v) => fmt(v, 2)} /></Card>
      <Card title="Sample medians after" sub={options.norm === 'none' ? 'no normalisation' : options.norm}><BarChart labels={samples} values={after} colors={colours} yLabel="Median log2" fmt={(v) => fmt(v, 2)} /></Card>
    </div>
    {levels.length > 0 && <div className="legend">{levels.map((g, i) => <span key={g}><i style={{ background: palette[i % palette.length] }} />{g}</span>)}</div>}
  </div></div>;
}
