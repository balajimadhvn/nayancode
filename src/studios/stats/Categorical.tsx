import { useMemo, useState } from 'react';
import { Callout, Card, DataTable, Stat, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { chiSquare, fisherExact, oddsRatio2x2, parseDelimited } from './tests';

const DEMO = ',exposed,unexposed\nevents,7,2\nno events,3,9';

function parseTable(text: string): { rowNames: string[]; colNames: string[]; table: number[][]; err?: string } {
  try {
    const t = parseDelimited(text);
    const colNames = t.header.slice(1);
    const rowNames: string[] = [], table: number[][] = [];
    for (const r of t.rows) {
      rowNames.push(r[0]);
      table.push(colNames.map((_, i) => Number(r[i + 1])));
    }
    if (table.some((row) => row.some((v) => !Number.isFinite(v) || v < 0))) return { rowNames, colNames, table, err: 'Every cell must be a non-negative number.' };
    return { rowNames, colNames, table };
  } catch (e) { return { rowNames: [], colNames: [], table: [], err: (e as Error).message }; }
}

export default function Categorical() {
  const [text, setText] = useState(DEMO);
  const parsed = useMemo(() => parseTable(text), [text]);
  const is2x2 = parsed.table.length === 2 && parsed.table[0]?.length === 2 && !parsed.err;
  const res = useMemo(() => {
    if (!is2x2) return null;
    try {
      const [[a, b], [c, d]] = parsed.table;
      return { pearson: chiSquare(parsed.table), yates: chiSquare(parsed.table, { yates: true }), fisher: fisherExact(a, b, c, d), or: a > 0 && b > 0 && c > 0 && d > 0 ? oddsRatio2x2(a, b, c, d) : null };
    } catch { return null; }
  }, [parsed.table, is2x2]);
  const big = useMemo(() => { if (is2x2 || parsed.err) return null; try { return chiSquare(parsed.table); } catch (e) { return { err: (e as Error).message }; } }, [parsed.table, is2x2, parsed.err]);
  return (
    <div className="split"><div className="stack">
      <Card title="1 · Contingency table"><div className="stack" style={{ gap: 10 }}>
        <textarea className="input mono" rows={7} style={{ fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ gap: 6 }}><button className="btn" onClick={() => setText(DEMO)}>Load demo (2×2)</button><button className="btn" onClick={() => setText(',A,B,C\nrow 1,12,5,7\nrow 2,8,9,15')}>Load demo (2×3)</button></div>
        {parsed.err && <Callout kind="err">{parsed.err}</Callout>}
        <div className="faint" style={{ fontSize: 11.5 }}>First row is a header; the first column holds the row labels. Cells are counts.</div>
      </div></Card>
      <Callout kind="warn">Check assumptions before trusting a p-value. Statistics Studio does not replace a statistician for a clinical or regulatory analysis.</Callout>
    </div>
    <div className="stack">
      {parsed.err && <Card><div className="faint" style={{ padding: '24px 6px' }}>Fix the table to see results.</div></Card>}
      {!parsed.err && <Card title="Table" pad={false}>
        <DataTable rowKey={(r) => r.name} rows={parsed.rowNames.map((name, i) => ({ name, cells: parsed.table[i] }))}
          cols={[{ key: 'name', label: '' }, ...parsed.colNames.map((c, j) => ({ key: c, label: c, num: true, render: (r: { name: string; cells: number[] }) => String(r.cells[j]) }))]} />
      </Card>}
      {res && <>
        <div className="cols-3">
          <Stat label="Pearson χ² p" value={sci(res.pearson.p)} hint={`χ² = ${fmt(res.pearson.chi2, 3)} on ${res.pearson.df} df`} />
          <Stat label="Fisher exact p" value={sci(res.fisher.p)} hint="two-sided" />
          <Stat label="Odds ratio" value={res.or ? fmt(res.or.or, 3) : '–'} hint={res.or ? `95 % CI ${fmt(res.or.lo, 3)} – ${fmt(res.or.hi, 3)}` : 'needs non-zero cells'} />
        </div>
        <Card title="Test results"><DataTable rowKey={(r) => r.test} rows={[
          { test: 'Pearson χ²', value: res.pearson.chi2, df: res.pearson.df, p: res.pearson.p },
          { test: 'Yates χ²', value: res.yates.chi2, df: 1, p: res.yates.p },
          { test: 'Fisher exact', value: NaN, df: NaN, p: res.fisher.p },
        ]} cols={[{ key: 'test', label: 'Test' }, { key: 'value', label: 'Statistic', num: true, render: (r) => (Number.isFinite(r.value) ? fmt(r.value, 4) : '–') }, { key: 'df', label: 'df', num: true, render: (r) => (Number.isFinite(r.df) ? String(r.df) : '–') }, { key: 'p', label: 'p', num: true, render: (r) => sci(r.p) }]} />
          <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>Fisher's exact test is exact for small counts; Yates' continuity correction is the conservative 2×2 χ². χ² with an expected count below 5 is unreliable.</div>
          <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => downloadText('contingency_tests.csv', toCsv(parsed.rowNames.map((r, i) => ({ row: r, ...Object.fromEntries(parsed.colNames.map((c, j) => [c, parsed.table[i][j]])) }))), 'text/csv')}>Export table (CSV)</button></div>
        </Card>
      </>}
      {big && 'err' in big && <Callout kind="err">{big.err}</Callout>}
      {big && !('err' in big) && <div className="cols-3"><Stat label="Pearson χ² p" value={sci(big.p)} hint={`χ² = ${fmt(big.chi2, 3)} on ${big.df} df`} /><Stat label="Smallest expected count" value={fmt(big.minExpected, 2)} hint="below 5 makes the χ² approximation unreliable" /><Stat label="Cells" value={`${parsed.table.length} × ${parsed.table[0].length}`} /></div>}
    </div></div>
  );
}
