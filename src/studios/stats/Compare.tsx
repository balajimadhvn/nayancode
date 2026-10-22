import { useMemo, useState } from 'react';
import { Callout, Card, DataTable, Stat, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { BarChart, Histogram, cssVar } from '@/viz/charts';
import { cohensD, holm, kruskalWallis, mannWhitney, oneWayAnova, parseDelimited, welchT } from './tests';

const DEMO = 'group,value\ncontrol,10.2\ncontrol,9.4\ncontrol,11.1\ncontrol,10.8\ncontrol,9.9\ncontrol,10.5\ntreated,12.4\ntreated,13.1\ntreated,11.7\ntreated,12.9\ntreated,13.5\ntreated,12.2';

function groupsFrom(text: string): { name: string; values: number[] }[] {
  const t = parseDelimited(text);
  const gi = t.header.findIndex((h) => /group|condition|class/i.test(h));
  if (gi >= 0) {
    const vi = t.header.findIndex((h, i) => i !== gi && /value|measure|response|y$/i.test(h));
    const v = vi >= 0 ? vi : t.header.map((_, i) => i).find((i) => i !== gi)!;
    const map = new Map<string, number[]>();
    for (const r of t.rows) {
      const g = r[gi]?.trim() || 'group', x = Number(r[v]);
      if (!Number.isFinite(x)) continue;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(x);
    }
    return [...map].map(([name, values]) => ({ name, values }));
  }
  // Wide format: one column per group.
  return t.header.map((name, i) => ({ name, values: t.rows.map((r) => Number(r[i])).filter(Number.isFinite) })).filter((g) => g.values.length > 0);
}

export default function Compare() {
  const [text, setText] = useState(''), [ran, setRan] = useState(false), [shown, setShown] = useState('');
  const parsed = useMemo(() => { try { return text ? groupsFrom(text) : null; } catch (e) { return { err: (e as Error).message }; } }, [text]);
  const groups = parsed && !('err' in parsed) ? parsed : null;
  const res = useMemo(() => {
    if (!groups || !ran || groups.length < 2) return null;
    const k = groups.length;
    const param = k === 2 ? welchT(groups[0].values, groups[1].values) : oneWayAnova(groups.map((g) => g.values));
    const nonparam = k === 2 ? mannWhitney(groups[0].values, groups[1].values) : kruskalWallis(groups.map((g) => g.values));
    const pairs: { a: string; b: string; t: number; p: number; adj: number; d: number }[] = [];
    if (k > 2) {
      const raw: { a: string; b: string; t: number; p: number; d: number }[] = [];
      for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
        const w = welchT(groups[i].values, groups[j].values);
        raw.push({ a: groups[i].name, b: groups[j].name, t: w.t, p: w.p, d: cohensD(groups[i].values, groups[j].values) });
      }
      const adj = holm(raw.map((r) => r.p));
      raw.forEach((r, i) => pairs.push({ ...r, adj: adj[i] }));
    }
    const paramP = param.p, paramHint = k === 2
      ? `t = ${fmt((param as { t: number }).t, 3)}, df = ${fmt((param as { df: number }).df, 1)}`
      : `F(${(param as { df1: number }).df1}, ${(param as { df2: number }).df2}) = ${fmt((param as { F: number }).F, 3)}`;
    return { param, nonparam, pairs, k, paramP, paramHint };
  }, [groups, ran]);
  const cols = [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d'), '#3fb97a', '#b45fd1'];
  const hist = groups?.find((g) => g.name === shown) ?? groups?.[0];
  return (
    <div className="split"><div className="stack">
      <Card title="1 · Data"><div className="stack" style={{ gap: 10 }}>
        <textarea className="input mono" rows={8} style={{ fontSize: 12 }} value={text} onChange={(e) => { setText(e.target.value); setRan(false); }} placeholder={'group,value\ncontrol,10.2\ncontrol,9.4\ntreated,12.4'} />
        <div className="row" style={{ gap: 6 }}><button className="btn" onClick={() => { setText(DEMO); setRan(false); }}>Load demo (two groups)</button><button className="btn" onClick={() => { setText('ctrl,9.1,10.4,10.9,9.8\ndrugA,11.2,11.9,10.8,12.1\ndrugB,13.4,12.8,13.9,12.6'); setRan(false); }}>Load demo (three groups)</button></div>
        {parsed && 'err' in parsed && <Callout kind="err">{parsed.err}</Callout>}
        {groups && <div className="faint" style={{ fontSize: 12 }}>{groups.length} group(s): {groups.map((g) => `${g.name} (n=${g.values.length})`).join(' · ')}</div>}
        <div className="faint" style={{ fontSize: 11.5 }}>Long format: a <code>group</code> column and a value column. Wide format: one column per group.</div>
      </div></Card>
      <Card title="2 · Test"><div className="stack" style={{ gap: 10 }}>
        <div className="faint" style={{ fontSize: 12 }}>Two groups → Welch t-test and Mann–Whitney. Three or more → one-way ANOVA and Kruskal–Wallis, with pairwise Welch t-tests adjusted by Holm.</div>
        <button className="btn primary" disabled={!groups || groups.length < 2} onClick={() => setRan(true)}>Run tests</button>
      </div></Card>
      <Callout kind="warn">Check assumptions before trusting a p-value. Statistics Studio does not replace a statistician for a clinical or regulatory analysis.</Callout>
    </div>
    <div className="stack">
      {!res && <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Paste your groups (or a demo) and run the tests.</div></Card>}
      {res && <>
        <div className="cols-3">
          <Stat label={res.k === 2 ? 'Welch t p' : 'ANOVA F p'} value={sci(res.paramP)} hint={res.paramHint} />
          <Stat label={res.k === 2 ? 'Mann–Whitney p' : 'Kruskal–Wallis p'} value={sci(res.nonparam.p)} hint={res.k === 2 ? `U = ${(res.nonparam as { U: number }).U}` : `H = ${fmt((res.nonparam as { H: number }).H, 3)}`} />
          {res.k === 2 ? <Stat label="Cohen's d" value={fmt(cohensD(groups![0].values, groups![1].values), 3)} /> : <Stat label="η² (ANOVA)" value={fmt((res.param as { etaSquared: number }).etaSquared, 3)} />}
        </div>
        <Card title="Group summary" pad={false}>
          <DataTable rowKey={(r) => r.name} rows={groups!} cols={[
            { key: 'name', label: 'Group' }, { key: 'n', label: 'n', num: true, render: (r) => r.values.length },
            { key: 'mean', label: 'Mean', num: true, render: (r) => fmt(r.values.reduce((a, b) => a + b, 0) / r.values.length, 3) },
            { key: 'sd', label: 'SD', num: true, render: (r) => { const m = r.values.reduce((a, b) => a + b, 0) / r.values.length; return fmt(Math.sqrt(r.values.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, r.values.length - 1)), 3); } },
            { key: 'median', label: 'Median', num: true, render: (r) => { const s = [...r.values].sort((a, b) => a - b), n = s.length; return fmt(n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2, 3); } }]} />
        </Card>
        <Card title="Distribution" actions={groups!.length > 1 ? <select className="select" style={{ width: 130 }} value={hist?.name} onChange={(e) => setShown(e.target.value)}>{groups!.map((g) => <option key={g.name}>{g.name}</option>)}</select> : undefined}>
          {hist && <Histogram values={hist.values} label={`Values · ${hist.name}`} color="--chart-a" marker={hist.values.reduce((a, b) => a + b, 0) / hist.values.length} />}
          <div className="faint" style={{ fontSize: 11.5 }}>A roughly symmetric histogram supports the parametric test; strong skew or outliers favour the rank test.</div>
        </Card>
        <Card title="Group means" sub="bars are means; dots are individual values">
          <BarChart labels={groups!.map((g) => g.name)} values={groups!.map((g) => g.values.reduce((a, b) => a + b, 0) / g.values.length)} colors={groups!.map((_, i) => cols[i % cols.length])} dots={groups!.map((g) => g.values)} yLabel="Value" exportName="group-means" />
        </Card>
        {res.pairs.length > 0 && <Card title="Pairwise Welch t-tests" sub="Holm-adjusted" pad={false}>
          <DataTable rowKey={(r) => r.a + r.b} rows={res.pairs} cols={[
            { key: 'a', label: 'Group A' }, { key: 'b', label: 'Group B' }, { key: 't', label: 't', num: true, render: (r) => fmt(r.t, 3) },
            { key: 'p', label: 'p', num: true, render: (r) => sci(r.p) }, { key: 'adj', label: 'p (Holm)', num: true, render: (r) => sci(r.adj) }, { key: 'd', label: "Cohen's d", num: true, render: (r) => fmt(r.d, 3) }]} />
          <div className="row" style={{ padding: 10 }}><button className="btn sm" onClick={() => downloadText('group_comparison.csv', toCsv(res.pairs.map((r) => ({ group_a: r.a, group_b: r.b, t: r.t, p: r.p, p_holm: r.adj, cohens_d: r.d }))), 'text/csv')}>Export pairwise tests (CSV)</button></div>
        </Card>}
      </>}
    </div></div>
  );
}
