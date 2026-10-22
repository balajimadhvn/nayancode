import { useMemo, useState } from 'react';
import { Callout, Card, DataTable, Stat, downloadText, sci, toCsv } from '@/ui/kit';
import { benjaminiHochberg, bonferroni, holm } from './tests';

const DEMO = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216].join('\n');

export default function MultipleTesting() {
  const [text, setText] = useState('');
  const p = useMemo(() => text.split(/[\s,;]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v) && v >= 0 && v <= 1), [text]);
  const rows = useMemo(() => {
    if (!p.length) return [];
    const b = bonferroni(p), h = holm(p), bh = benjaminiHochberg(p);
    return p.map((v, i) => ({ i: i + 1, p: v, bonf: b[i], holm: h[i], bh: bh[i] }));
  }, [p]);
  const significant = (key: 'bonf' | 'holm' | 'bh') => rows.filter((r) => r[key] < 0.05).length;
  return (
    <div className="split"><div className="stack">
      <Card title="1 · p-values"><div className="stack" style={{ gap: 10 }}>
        <textarea className="input mono" rows={10} style={{ fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'One p-value per line (or comma separated)'} />
        <div className="row" style={{ gap: 6 }}><button className="btn" onClick={() => setText(DEMO)}>Load demo (10 p-values)</button><button className="btn" onClick={() => setText('')}>Clear</button></div>
        <div className="faint" style={{ fontSize: 12 }}>{p.length} valid p-value(s){text.trim() && p.length === 0 ? ' — nothing between 0 and 1 was found.' : ''}</div>
      </div></Card>
      <Callout kind="warn">Check assumptions before trusting a p-value. Statistics Studio does not replace a statistician for a clinical or regulatory analysis.</Callout>
    </div>
    <div className="stack">
      {!rows.length ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Paste p-values to adjust.</div></Card> : <>
        <div className="cols-3">
          <Stat label="Bonferroni < 0.05" value={String(significant('bonf'))} hint="controls the family-wise error rate (conservative)" />
          <Stat label="Holm < 0.05" value={String(significant('holm'))} hint="family-wise error rate; uniformly more powerful than Bonferroni" />
          <Stat label="BH FDR < 0.05" value={String(significant('bh'))} hint="expected false-discovery proportion" />
        </div>
        <Card title="Adjusted p-values" pad={false}>
          <DataTable rowKey={(r) => String(r.i)} rows={rows} cols={[
            { key: 'i', label: '#', num: true }, { key: 'p', label: 'p', num: true, render: (r) => sci(r.p) },
            { key: 'bonf', label: 'Bonferroni', num: true, render: (r) => sci(r.bonf) }, { key: 'holm', label: 'Holm', num: true, render: (r) => sci(r.holm) },
            { key: 'bh', label: 'Benjamini–Hochberg', num: true, render: (r) => sci(r.bh) },
            { key: 'sig', label: 'BH < 0.05', render: (r) => (r.bh < 0.05 ? 'yes' : '') }]} />
          <div className="row" style={{ padding: 10 }}><button className="btn sm" onClick={() => downloadText('adjusted_pvalues.csv', toCsv(rows.map((r) => ({ index: r.i, p: r.p, bonferroni: r.bonf, holm: r.holm, bh: r.bh }))), 'text/csv')}>Export adjusted p-values (CSV)</button></div>
        </Card>
        <Card title="How to choose"><div className="faint" style={{ fontSize: 12 }}>Bonferroni and Holm control the chance of <i>any</i> false positive and suit a small, pre-specified family of tests. Benjamini–Hochberg controls the false-discovery rate and suits screening many features. Neither fixes a biased design: report the number of tests you ran, and say which correction you used.</div></Card>
      </>}
    </div></div>
  );
}
