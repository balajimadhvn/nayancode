import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { demoGenotypes } from './demo';
import { alleleFreqs, parsePopTable, populations, wcFst, type FreqRow, type FstResult } from './stats';

const TOOL: ToolInfo = {
  id: 'popgen.frequencies', name: 'Allele frequencies and HWE', version: '0.1.0', engine: 'TypeScript', citations: ['weir1984', 'balding1995'],
  describe: (p) => `Per-population allele frequencies, observed and unbiased expected heterozygosity and exact Hardy–Weinberg tests${p.fst === 'yes' ? ', plus Weir–Cockerham θ across populations' : ''}.`,
};

interface Out { rows: FreqRow[]; fst: FstResult; nSnps: number; nPops: number }

export default function FrequenciesTab() {
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('all');
  const [out, setOut] = useState<Out | null>(null);
  const { run, busy, error } = useRunner();

  const parsed = useMemo(() => { try { return text ? parsePopTable(text) : null; } catch (e) { return { err: (e as Error).message }; } }, [text]);
  const ok = parsed && !('err' in parsed) ? parsed : null;
  const errMsg = parsed && 'err' in parsed ? parsed.err : null;
  const groups = ok ? populations(ok.pop) : [];

  const go = () => {
    if (!ok) return;
    void run({
      label: `Frequencies · ${ok.snps.length} SNPs`, tool: TOOL, params: { populations: groups.length, fst: 'yes' },
      inputs: [{ name: 'genotype table', data: text }],
      run: async () => {
        const rows = alleleFreqs(ok, ok.pop);
        const fst = wcFst(ok, ok.pop);
        setOut({ rows, fst, nSnps: ok.snps.length, nPops: groups.length });
        return { n: rows.length };
      },
      summary: () => 'Allele frequencies, heterozygosity and HWE tests per SNP and population',
    });
  };

  const rows = out ? (filter === 'all' ? out.rows : out.rows.filter((r) => r.population === filter)) : [];
  const meanHo = out ? out.rows.reduce((a, r) => a + r.Ho, 0) / Math.max(1, out.rows.length) : NaN;

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Genotype table"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setText(t); setOut(null); }} label={text ? 'Table loaded' : 'CSV/TSV: sample, population, then one column per SNP (0/1/2 dosages)'} />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => { setText(demoGenotypes().text); setOut(null); }}>Load demo table</button>
        </div>
        {errMsg && <Callout kind="err">{errMsg}</Callout>}
        {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.samples.length} samples · {ok.snps.length} SNPs · {groups.length} populations</div>}
      </div></Card>
      {ok && <Card title="2 · Options"><div className="stack" style={{ gap: 10 }}>
        <Field label="Population"><select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All populations</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select></Field>
        <button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Running…' : 'Summarise'}</button>
        {error && <Callout kind="err">{error}</Callout>}
      </div></Card>}
    </div>
    <div className="stack">
      {!out ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load a genotype table (or the demo) and summarise allele frequencies and HWE.</div></Card> : <>
        <div className="cols-3">
          <Stat label="SNPs" value={out.nSnps} />
          <Stat label="Mean Ho" value={fmt(meanHo, 3)} hint="observed heterozygosity across rows" />
          <Stat label="Fst (WC)" value={fmt(out.fst.theta, 4)} hint="Weir–Cockerham θ across all populations" />
        </div>
        <Card title="Frequencies and Hardy–Weinberg" sub={`${rows.length} rows`} pad={false}>
          <DataTable rowKey={(r) => r.snp + r.population} rows={rows} cols={[
            { key: 'snp', label: 'SNP' },
            { key: 'population', label: 'Population' },
            { key: 'n', label: 'n', num: true },
            { key: 'alt', label: 'alt freq', num: true, render: (r) => fmt(r.alt, 3) },
            { key: 'ho', label: 'Ho', num: true, render: (r) => fmt(r.Ho, 3) },
            { key: 'he', label: 'He', num: true, render: (r) => fmt(r.He, 3) },
            { key: 'f', label: 'F', num: true, render: (r) => fmt(r.F, 3) },
            { key: 'hwe', label: 'HWE p', num: true, render: (r) => (r.hweP < 1e-4 ? r.hweP.toExponential(2) : fmt(r.hweP, 4)) },
          ]} />
          <div className="row" style={{ padding: 10 }}>
            <button className="btn sm" onClick={() => downloadText('popgen_frequencies.csv', toCsv(rows.map((r) => ({ snp: r.snp, population: r.population, n: r.n, alt_freq: r.alt, ho: r.Ho, he: r.He, f: r.F, hwe_p: r.hweP }))), 'text/csv')}>Export CSV</button>
          </div>
        </Card>
        <Card title="Differentiation" sub="Weir–Cockerham θ over all populations">
          <div className="row" style={{ gap: 20 }}>
            <Stat label="θ (Fst)" value={fmt(out.fst.theta, 4)} />
            <Stat label="95 % CI" value={out.fst.ci95 ? `${fmt(out.fst.ci95[0], 4)} – ${fmt(out.fst.ci95[1], 4)}` : '—'} hint="200 bootstrap resamples over loci" />
            <Stat label="Loci used" value={out.fst.loci.length} />
          </div>
        </Card>
      </>}
    </div></div>
  );
}
