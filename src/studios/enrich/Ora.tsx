import { useMemo, useState } from 'react';
import { Callout, Card, DataTable, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { BarChart, cssVar } from '@/viz/charts';
import { parseGeneList, type GeneSet } from './gmt';
import { ORA_TOOL } from './meta';
import { ora, type OraRow } from './ora';

interface Props {
  sets: GeneSet[];
  geneText: string;
  setGeneText(t: string): void;
  backgroundText: string;
  setBackgroundText(t: string): void;
}

export default function OverRepresentation({ sets, geneText, setGeneText, backgroundText, setBackgroundText }: Props) {
  const [rows, setRows] = useState<OraRow[] | null>(null);
  const { run, busy, error } = useRunner();
  const list = useMemo(() => parseGeneList(geneText), [geneText]);
  const background = useMemo(() => parseGeneList(backgroundText), [backgroundText]);
  const universe = useMemo(() => new Set((background.length ? background : sets.flatMap((s) => s.genes)).map((g) => g.toUpperCase())), [background, sets]);
  const dropped = list.filter((g) => !universe.has(g)).length;

  const go = () => {
    if (!sets.length || !list.length) return;
    setRows(null);
    void run({
      label: `ORA · ${list.length} gene(s) vs ${sets.length} set(s)`, tool: ORA_TOOL,
      params: { list: list.length, sets: sets.length, background: background.length > 0, universe: universe.size },
      inputs: [{ name: 'gene list', data: `${list.length} gene(s)` }, { name: 'gene sets', data: `${sets.length} set(s)` }, ...(background.length ? [{ name: 'background', data: `${background.length} gene(s)` }] : [])],
      run: async () => ora(list, sets, background.length ? background : undefined),
      summary: (r) => `${r.length} set(s) tested, ${r.filter((q) => q.fdr < 0.05).length} at FDR < 0.05`,
    }).then((r) => r && setRows(r));
  };

  const top = (rows ?? []).slice(0, 15);
  const values = top.map((r) => Math.min(300, -Math.log10(Math.max(r.fdr, 1e-300))));
  const labels = top.map((r) => r.name);

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Gene list and background">
        <div className="stack" style={{ gap: 10 }}>
          <textarea className="input mono" rows={8} value={geneText} onChange={(e) => { setGeneText(e.target.value); setRows(null); }} spellCheck={false} placeholder={'TP53\nBRCA1\nEGFR'} aria-label="Gene list" />
          <div className="faint" style={{ fontSize: 12 }}>{list.length} unique gene(s) in the list</div>
          <textarea className="input mono" rows={5} value={backgroundText} onChange={(e) => { setBackgroundText(e.target.value); setRows(null); }} spellCheck={false} placeholder="Optional: every gene tested (full background). Empty = union of the loaded sets." aria-label="Background genes" />
          <div className="faint" style={{ fontSize: 12 }}>{background.length ? `${background.length} background gene(s)` : 'No background supplied: the union of the loaded sets is used.'}</div>
          <div className="row"><button className="btn primary" disabled={busy || !sets.length || !list.length} onClick={go}>{busy ? 'Testing…' : 'Run ORA'}</button></div>
          {!sets.length && <Callout kind="warn">Load a gene-set collection in the Gene sets tab first.</Callout>}
          {error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout>The background matters: pass every gene that could have entered the list. With the default union, a set that is small relative to the whole collection can look more significant than it is. These are unadjusted gene-symbol overlaps, not pathway activity.</Callout>
    </div>
    <div className="stack">
      <Card title="Over-representation" sub={rows ? `${rows.length} set(s) · N = ${fmt(rows[0]?.N ?? universe.size, 0)} · n = ${fmt(rows[0]?.n ?? list.length - dropped, 0)}${dropped ? ` · ${dropped} list gene(s) outside the universe dropped` : ''}` : undefined} pad={false} actions={<button className="btn sm" disabled={!rows?.length} onClick={() => rows && downloadText('ora_results.csv', toCsv(rows.map((r) => ({ set: r.name, K: r.K, k: r.k, n: r.n, N: r.N, p: r.p, fdr: r.fdr, fold_enrichment: r.fold, genes: r.genes.join(';') }))), 'text/csv')}>CSV</button>}>
        {!rows ? <div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Enter a gene list, load gene sets, then run over-representation analysis.</div> : rows.length === 0 ? <div style={{ padding: 16 }}><Callout kind="warn">No set passed the size filter or no list gene was inside the universe. Check the identifiers and the background.</Callout></div> : <DataTable rows={rows} rowKey={(r) => r.name} cols={[
          { key: 'name', label: 'Set' },
          { key: 'K', label: 'K (set)', num: true, sort: (r) => r.K },
          { key: 'k', label: 'k (overlap)', num: true, sort: (r) => r.k },
          { key: 'fold', label: 'Fold', num: true, sort: (r) => r.fold, render: (r) => fmt(r.fold, 2) },
          { key: 'p', label: 'p', num: true, sort: (r) => r.p, render: (r) => sci(r.p) },
          { key: 'fdr', label: 'FDR', num: true, sort: (r) => r.fdr, render: (r) => sci(r.fdr) },
          { key: 'genes', label: 'Overlapping genes', render: (r) => <span className="mono faint" style={{ fontSize: 11.5 }}>{r.genes.slice(0, 6).join(' ')}{r.genes.length > 6 ? ` +${r.genes.length - 6}` : ''}</span> },
        ]} />}
      </Card>
      {rows && rows.length > 0 && <Card title="Top sets by significance" sub="−log10(FDR); zero FDR is capped at 300"><BarChart labels={labels} values={values} colors={[cssVar('--chart-a')]} yLabel="−log10(FDR)" fmt={(v) => fmt(v, 1)} height={300} exportName="ora-top-sets" /></Card>}
    </div></div>
  );
}
