import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { demoGenotypes } from './demo';
import { parsePopTable, pairwiseFst, wcFst, type FstResult } from './stats';

const TOOL: ToolInfo = {
  id: 'popgen.fst', name: 'Weir–Cockerham Fst', version: '0.1.0', engine: 'TypeScript', citations: ['weir1984', 'balding1995'],
  describe: (p) => `Weir & Cockerham (1984) θ (Fst) over ${p.populations} populations and ${p.loci} loci, with a ${p.resamples}-resample bootstrap over loci for the 95 % interval${p.pairwise ? ', and the same estimator for every population pair' : ''}.`,
};

interface Out { fst: FstResult; pair: { populations: string[]; matrix: number[][] } }

export default function FstTab() {
  const [text, setText] = useState('');
  const [resamples, setResamples] = useState('200');
  const [out, setOut] = useState<Out | null>(null);
  const { run, busy, error } = useRunner();

  const parsed = useMemo(() => { try { return text ? parsePopTable(text) : null; } catch (e) { return { err: (e as Error).message }; } }, [text]);
  const ok = parsed && !('err' in parsed) ? parsed : null;
  const errMsg = parsed && 'err' in parsed ? parsed.err : null;

  const go = () => {
    if (!ok) return;
    const n = Math.max(0, Math.floor(Number(resamples) || 0));
    void run({
      label: `Fst · ${ok.snps.length} loci`, tool: TOOL, params: { populations: new Set(ok.pop).size, loci: ok.snps.length, resamples: n, pairwise: true },
      inputs: [{ name: 'genotype table', data: text }],
      run: async () => {
        const fst = wcFst(ok, ok.pop, { resamples: n });
        setOut({ fst, pair: pairwiseFst(ok, ok.pop) });
        return { theta: fst.theta };
      },
      summary: () => 'Weir–Cockerham Fst with bootstrap interval and pairwise matrix',
    });
  };

  const pairRows = out ? out.pair.populations.map((p, i) => {
    const row: Record<string, string | number> = { population: p };
    out.pair.populations.forEach((q, j) => { row[q] = out.pair.matrix[i][j]; });
    return row;
  }) : [];

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Genotype table"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setText(t); setOut(null); }} label={text ? 'Table loaded' : 'CSV/TSV: sample, population, then one SNP column per locus (0/1/2)'} />
        <button className="btn" onClick={() => { setText(demoGenotypes().text); setOut(null); }}>Load demo table</button>
        {errMsg && <Callout kind="err">{errMsg}</Callout>}
        {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.samples.length} samples · {ok.snps.length} SNPs</div>}
      </div></Card>
      {ok && <Card title="2 · Options"><div className="stack" style={{ gap: 10 }}>
        <Field label="Bootstrap resamples over loci"><input className="input" value={resamples} onChange={(e) => setResamples(e.target.value)} /></Field>
        <button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Running…' : 'Estimate Fst'}</button>
        {error && <Callout kind="err">{error}</Callout>}
      </div></Card>}
    </div>
    <div className="stack">
      {!out ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load a genotype table and estimate Weir–Cockerham Fst.</div></Card> : <>
        <div className="cols-3">
          <Stat label="θ (Fst)" value={fmt(out.fst.theta, 4)} hint="Σa / Σ(a+b+c) over loci" />
          <Stat label="95 % CI" value={out.fst.ci95 ? `${fmt(out.fst.ci95[0], 4)} – ${fmt(out.fst.ci95[1], 4)}` : '—'} hint="bootstrap over loci" />
          <Stat label="Loci" value={out.fst.loci.length} />
        </div>
        <Card title="Pairwise Fst matrix" pad={false}>
          <DataTable rowKey={(r) => String(r.population)} rows={pairRows} cols={[
            { key: 'population', label: 'Population' },
            ...out.pair.populations.map((p) => ({ key: p, label: p, num: true, render: (r: Record<string, string | number>) => fmt(Number(r[p]), 4) })),
          ]} />
        </Card>
        <Card title="Per-locus components" sub="a, b and c of the Weir–Cockerham estimator" pad={false}>
          <DataTable rowKey={(r) => r.snp} rows={out.fst.loci} cols={[
            { key: 'snp', label: 'SNP' },
            { key: 'a', label: 'a', num: true, render: (r) => fmt(r.a, 4) },
            { key: 'b', label: 'b', num: true, render: (r) => fmt(r.b, 4) },
            { key: 'c', label: 'c', num: true, render: (r) => fmt(r.c, 4) },
            { key: 'theta', label: 'θ', num: true, render: (r) => fmt(r.theta, 4) },
          ]} />
          <div className="row" style={{ padding: 10 }}>
            <button className="btn sm" onClick={() => downloadText('popgen_fst_loci.csv', toCsv(out.fst.loci.map((r) => ({ snp: r.snp, a: r.a, b: r.b, c: r.c, theta: r.theta }))), 'text/csv')}>Export CSV</button>
          </div>
        </Card>
      </>}
    </div></div>
  );
}
