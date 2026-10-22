import { useMemo, useState } from 'react';
import { Callout, Card, DataTable, Stat, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { Scatter, cssVar } from '@/viz/charts';
import { linearRegression, numericColumn, parseDelimited, pearson, spearman } from './tests';

const DEMO = 'x,y\n' + Array.from({ length: 20 }, (_, i) => { const x = i * 0.5; return `${x},${(2 + 0.7 * x + Math.sin(i * 2.3) * 0.5).toFixed(4)}`; }).join('\n');

export default function Relationships() {
  const [text, setText] = useState(''), [xCol, setX] = useState(''), [yCol, setY] = useState('');
  const parsed = useMemo(() => {
    try { const t = parseDelimited(text); return { t, err: '' }; } catch (e) { return { t: null, err: (e as Error).message }; }
  }, [text]);
  const t = parsed.t, cols = t ? t.header : [];
  const xName = cols.includes(xCol) ? xCol : cols[0] ?? '', yName = cols.includes(yCol) ? yCol : cols[1] ?? '';
  type Rel = { p: ReturnType<typeof pearson>; s: ReturnType<typeof spearman>; r: ReturnType<typeof linearRegression>; X: number[]; Y: number[] } | { err: string };
  const res = useMemo<Rel | null>(() => {
    if (!t || !xName || !yName || xName === yName) return null;
    try {
      const x = numericColumn(t, xName), y = numericColumn(t, yName);
      const n = Math.min(x.length, y.length);
      const X = x.slice(0, n), Y = y.slice(0, n);
      return { p: pearson(X, Y), s: spearman(X, Y), r: linearRegression(X, Y), X, Y };
    } catch (e) { return { err: (e as Error).message }; }
  }, [t, xName, yName]);
  const good = res && !('err' in res) ? res : null;
  const lines = good ? (() => {
    const xs = [Math.min(...good.X), Math.max(...good.X)];
    return xs.map((x) => ({ x, y: good.r.intercept + good.r.slope * x }));
  })() : null;
  return (
    <div className="split"><div className="stack">
      <Card title="1 · Two numeric columns"><div className="stack" style={{ gap: 10 }}>
        <textarea className="input mono" rows={8} style={{ fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'x,y\n1,2.1\n2,3.4'} />
        <button className="btn" onClick={() => setText(DEMO)}>Load demo (linear with noise)</button>
        {parsed.err && <Callout kind="err">{parsed.err}</Callout>}
        {t && t.rows.length > 0 && <div className="cols-2" style={{ gap: 8 }}>
          <label className="field">X<select className="select" value={xName} onChange={(e) => setX(e.target.value)}>{cols.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field">Y<select className="select" value={yName} onChange={(e) => setY(e.target.value)}>{cols.map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>}
        {res && 'err' in res && <Callout kind="err">{res.err}</Callout>}
      </div></Card>
      <Callout kind="warn">Check assumptions before trusting a p-value. Statistics Studio does not replace a statistician for a clinical or regulatory analysis.</Callout>
    </div>
    <div className="stack">
      {!good && <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Paste two numeric columns (or the demo).</div></Card>}
      {good && <>
        <div className="cols-3">
          <Stat label="Pearson r" value={fmt(good.p.r, 4)} hint={`t = ${fmt(good.p.t, 3)} on ${good.p.df} df, p = ${sci(good.p.p)}`} />
          <Stat label="Spearman ρ" value={fmt(good.s.rho, 4)} hint={`p = ${sci(good.s.p)}`} />
          <Stat label="R² (regression)" value={fmt(good.r.r2, 4)} hint={`adjusted R² = ${fmt(good.r.adjR2, 4)}`} />
        </div>
        <Card title="Scatter with the least-squares line">
          <Scatter points={good.X.map((x, i) => ({ x, y: good.Y[i], cat: 1, label: String(i + 1) }))} colors={[cssVar('--chart-a'), cssVar('--chart-a')]} xLabel={xName} yLabel={yName} height={340} />
          {lines && <div className="faint mono" style={{ fontSize: 12 }}>y = {fmt(good.r.intercept, 4)} + {fmt(good.r.slope, 4)}·x · slope 95 % CI {fmt(good.r.ci95[0], 4)} to {fmt(good.r.ci95[1], 4)}</div>}
        </Card>
        <Card title="Inference" pad={false}>
          <DataTable rowKey={(r) => r.term} rows={[
            { term: 'Pearson r', est: good.p.r, lo: good.p.lo, hi: good.p.hi, p: good.p.p },
            { term: 'Spearman ρ', est: good.s.rho, lo: NaN, hi: NaN, p: good.s.p },
            { term: 'Slope', est: good.r.slope, lo: good.r.ci95[0], hi: good.r.ci95[1], p: good.r.p },
            { term: 'Intercept', est: good.r.intercept, lo: NaN, hi: NaN, p: NaN },
          ]} cols={[
            { key: 'term', label: 'Statistic' }, { key: 'est', label: 'Estimate', num: true, render: (r) => fmt(r.est, 4) },
            { key: 'ci', label: '95 % CI', num: true, render: (r) => (Number.isFinite(r.lo) ? `${fmt(r.lo, 4)} – ${fmt(r.hi, 4)}` : '–') },
            { key: 'p', label: 'p', num: true, render: (r) => (Number.isFinite(r.p) ? sci(r.p) : '–') }]} />
          <div className="row" style={{ padding: 10 }}><button className="btn sm" onClick={() => downloadText('correlation.csv', toCsv(good.X.map((x, i) => ({ x, y: good.Y[i], fitted: good.r.intercept + good.r.slope * x }))), 'text/csv')}>Export data and fit (CSV)</button></div>
        </Card>
        <Card title="Interpretation"><div className="faint" style={{ fontSize: 12 }}>Pearson r measures linear association and is sensitive to outliers; Spearman ρ uses ranks. A correlation is not causation, and a p-value says nothing about effect size: report r and its interval.</div></Card>
      </>}
    </div></div>
  );
}
