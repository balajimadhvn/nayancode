import { useMemo, useState } from 'react';
import { Callout, Card, DataTable, Field, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import { parseRanked, type GeneSet } from './gmt';
import type { GseaResult, GseaRow } from './gsea';
import { GSEA_TOOL } from './meta';
import { remote } from './remote';

interface Props {
  sets: GeneSet[];
  rankedText: string;
  setRankedText(t: string): void;
}

export default function Gsea({ sets, rankedText, setRankedText }: Props) {
  const [perms, setPerms] = useState(1000), [seed, setSeed] = useState(1), [weight, setWeight] = useState(1);
  const [minSize, setMinSize] = useState(5), [maxSize, setMaxSize] = useState(500);
  const [res, setRes] = useState<GseaResult | null>(null), [sel, setSel] = useState(0);
  const { run, busy, progress, note, error, cancel } = useRunner();
  const ranked = useMemo(() => parseRanked(rankedText), [rankedText]);

  const go = () => {
    if (!sets.length || !ranked.length) return;
    setRes(null); setSel(0);
    void run({
      label: `Pre-ranked GSEA · ${sets.length} set(s)`, tool: GSEA_TOOL,
      params: { ranked: ranked.length, sets: sets.length, perms, seed, weight, minSize, maxSize },
      inputs: [{ name: 'ranked list', data: `${ranked.length} gene(s)` }, { name: 'gene sets', data: `${sets.length} set(s)` }],
      run: (h) => remote.gsea({ ranked, sets, opts: { perms, seed, minSize, maxSize, weight } }, { onProgress: h.onProgress, signal: h.signal }),
      summary: (r) => `${r.rows.length} set(s) tested, ${r.rows.filter((q) => q.fdr < 0.05).length} at FDR < 0.05`,
    }).then((r) => r && setRes(r));
  };

  const row: GseaRow | undefined = res?.rows[sel];
  const spec = row ? {
    series: [{ name: 'Running sum', color: cssVar('--chart-a'), curve: row.curve.map((y, i) => ({ x: i + 1, y })) }],
    xLabel: 'Ranked genes (best first)', yLabel: 'Enrichment score',
    hlines: [0], vlines: row.hitPositions.map((x) => ({ x, color: cssVar('--chart-b') })), legend: false,
  } : null;

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Ranked list and permutations">
        <div className="stack" style={{ gap: 10 }}>
          <textarea className="input mono" rows={8} value={rankedText} onChange={(e) => { setRankedText(e.target.value); setRes(null); }} spellCheck={false} placeholder={'GENE1\t3.4\nGENE2\t2.1'} aria-label="Ranked gene list" />
          <div className="faint" style={{ fontSize: 12 }}>{ranked.length} ranked gene(s); one <span className="mono">gene&lt;TAB&gt;score</span> per line, best score first after sorting.</div>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Permutations"><input className="input" type="number" min={10} max={10000} value={perms} onChange={(e) => setPerms(+e.target.value)} /></Field>
            <Field label="Seed"><input className="input" type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} /></Field>
            <Field label="Weight"><input className="input" type="number" min={0} max={2} step="0.5" value={weight} onChange={(e) => setWeight(+e.target.value)} /></Field>
            <Field label="Min set size"><input className="input" type="number" min={1} value={minSize} onChange={(e) => setMinSize(+e.target.value)} /></Field>
            <Field label="Max set size"><input className="input" type="number" min={1} value={maxSize} onChange={(e) => setMaxSize(+e.target.value)} /></Field>
          </div>
          <div className="row"><button className="btn primary" disabled={busy || !sets.length || !ranked.length} onClick={go}>{busy ? 'Permuting…' : 'Run GSEA'}</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
          {busy && <div className="faint" style={{ fontSize: 12 }}>{Math.round(progress * 100)} % {note ? `· ${note}` : ''}</div>}
          {!sets.length && <Callout kind="warn">Load a gene-set collection in the Gene sets tab first.</Callout>}
          {error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout>Positions are permuted without a phenotype, so the null distribution is gene-set size matched. A small p means the set concentrates at one end of your list more than chance; it does not prove the pathway is active. Report the background and the identifier namespace with your result.</Callout>
    </div>
    <div className="stack">
      <Card title="GSEA results" sub={res ? `${res.rows.length} set(s) · ${res.ranked.toLocaleString()} ranked genes` : undefined} pad={false} actions={<button className="btn sm" disabled={!res?.rows.length} onClick={() => res && downloadText('gsea_results.csv', toCsv(res.rows.map((r) => ({ set: r.name, size: r.size, es: r.es, nes: r.nes, p: r.p, fdr: r.fdr }))), 'text/csv')}>CSV</button>}>
        {!res ? <div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Enter a ranked list, load gene sets, then run pre-ranked GSEA.</div> : res.rows.length === 0 ? <div style={{ padding: 16 }}><Callout kind="warn">No set passed the size filter after intersecting with the ranked list. Widen the set-size limits or check the gene symbols.</Callout></div> : <DataTable rows={res.rows} rowKey={(r) => r.name} onRow={(r) => setSel(res.rows.indexOf(r))} cols={[
          { key: 'name', label: 'Set' },
          { key: 'size', label: 'Hits', num: true, sort: (r) => r.size },
          { key: 'es', label: 'ES', num: true, sort: (r) => r.es, render: (r) => fmt(r.es, 3) },
          { key: 'nes', label: 'NES', num: true, sort: (r) => r.nes, render: (r) => fmt(r.nes, 2) },
          { key: 'p', label: 'p', num: true, sort: (r) => r.p, render: (r) => sci(r.p) },
          { key: 'fdr', label: 'FDR', num: true, sort: (r) => r.fdr, render: (r) => sci(r.fdr) },
        ]} />}
      </Card>
      {row && spec && <Card title="Running sum" sub={`${row.name} · ES ${fmt(row.es, 3)} · NES ${fmt(row.nes, 2)} · p ${sci(row.p)} · FDR ${sci(row.fdr)}`}>
        <CurvePlot spec={spec} height={300} exportName="gsea-running-sum" />
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Amber ticks are the {row.hitPositions.length} set members; the score peaks where the set is concentrated. Select another row to redraw.</div>
      </Card>}
    </div></div>
  );
}
