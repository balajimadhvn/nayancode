import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { Scatter } from '@/viz/charts';
import { okabe } from '@/viz/figure';
import { StackedBars } from '@/viz/more';
import { admix, chooseK, type AdmixFit } from './admix';
import { demoGenotypes } from './demo';
import { parsePopTable, populations, structurePca } from './stats';

const TOOL_PCA: ToolInfo = {
  id: 'popgen.pca', name: 'Genotype PCA', version: '0.1.0', engine: 'TypeScript', citations: ['alexander2009'],
  describe: () => 'Principal components of the LD-pruned, standardised genotype matrix (shared genotype-PCA kernel).',
};
const TOOL_ADMIX: ToolInfo = {
  id: 'popgen.admixture', name: 'Admixture EM', version: '0.1.0', engine: 'TypeScript', citations: ['alexander2009'],
  describe: (p) => `ADMIXTURE-style maximum-likelihood ancestry proportions for K = ${p.K}, five seeded random starts, binomial genotype likelihood and the EM updates of Tang et al. (2005).`,
};

export default function StructureTab() {
  const [text, setText] = useState('');
  const [pca, setPca] = useState<{ pcs: number[][]; var: number[]; idx: number[] } | null>(null);
  const [fit, setFit] = useState<AdmixFit | null>(null);
  const [scan, setScan] = useState<AdmixFit[] | null>(null);
  const [K, setK] = useState('2');
  const { run, busy, error } = useRunner();

  const parsed = useMemo(() => { try { return text ? parsePopTable(text) : null; } catch (e) { return { err: (e as Error).message }; } }, [text]);
  const ok = parsed && !('err' in parsed) ? parsed : null;
  const errMsg = parsed && 'err' in parsed ? parsed.err : null;
  const groups = ok ? populations(ok.pop) : [];

  const runPca = () => {
    if (!ok) return;
    void run({
      label: 'Genotype PCA', tool: TOOL_PCA, params: { nPc: 2 },
      inputs: [{ name: 'genotype table', data: text }],
      run: async () => { const r = structurePca(ok, 2); setPca(r); return { snps: r.idx.length }; },
      summary: () => 'PCA after LD pruning',
    });
  };
  const runAdmix = () => {
    if (!ok) return;
    const k = Math.max(1, Math.min(6, Math.floor(Number(K) || 2)));
    void run({
      label: `Admixture K = ${k}`, tool: TOOL_ADMIX, params: { K: k, starts: 5 },
      inputs: [{ name: 'genotype table', data: text }],
      run: async () => { const r = admix(ok.G, k, { seed: 2026 }); setFit(r); return { logLik: r.logLik }; },
      summary: () => 'Ancestry proportions by EM',
    });
  };
  const runScan = () => {
    if (!ok) return;
    void run({
      label: 'Admixture model scan', tool: TOOL_ADMIX, params: { K: '1–6', starts: 5 },
      inputs: [{ name: 'genotype table', data: text }],
      run: async () => { const r = chooseK(ok.G, 6, { seed: 2026 }); setScan(r); return { fits: r.length }; },
      summary: () => 'Log-likelihood and BIC for K = 1…6',
    });
  };

  const points = useMemo(() => {
    if (!ok || !pca || pca.pcs.length < 2) return [];
    const cat = new Map(groups.map((g, i) => [g, i]));
    return ok.samples.map((s, i) => ({ x: pca.pcs[0][i], y: pca.pcs[1][i], cat: cat.get(ok.pop[i]) ?? 0, label: `${s} · ${ok.pop[i]}` }));
  }, [ok, pca, groups]);

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Genotype table"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={(t) => { setText(t); setPca(null); setFit(null); setScan(null); }} label={text ? 'Table loaded' : 'CSV/TSV: sample, population, then one SNP column per locus (0/1/2)'} />
        <button className="btn" onClick={() => { setText(demoGenotypes({ loci: 240, perPop: 40, admixed: 12 }).text); setPca(null); setFit(null); setScan(null); }}>Load demo table</button>
        {errMsg && <Callout kind="err">{errMsg}</Callout>}
        {ok && <div className="faint" style={{ fontSize: 12 }}>{ok.samples.length} samples · {ok.snps.length} SNPs · {groups.length} populations</div>}
      </div></Card>
      {ok && <Card title="2 · Analysis"><div className="stack" style={{ gap: 10 }}>
        <button className="btn" disabled={busy} onClick={runPca}>Principal components</button>
        <Field label="Components (K)"><select className="select" value={K} onChange={(e) => setK(e.target.value)}>
          {[1, 2, 3, 4, 5, 6].map((k) => <option key={k} value={k}>{k}</option>)}
        </select></Field>
        <button className="btn primary" disabled={busy} onClick={runAdmix}>Estimate ancestry</button>
        <button className="btn" disabled={busy} onClick={runScan}>Model scan (K = 1–6)</button>
        {busy && <div className="faint" style={{ fontSize: 12 }}>EM runs five seeded starts per K; the scan can take a little while.</div>}
        {error && <Callout kind="err">{error}</Callout>}
      </div></Card>}
    </div>
    <div className="stack">
      {pca && points.length > 0 && <Card title="PCA" sub={`PC1 ${fmt(pca.var[0] * 100, 1)} % · PC2 ${fmt(pca.var[1] * 100, 1)} % of variance`}>
        <Scatter points={points} colors={groups.map((_, i) => okabe(i, true))} names={groups} xLabel="PC1" yLabel="PC2" height={360} radius={2.4} />
      </Card>}
      {fit && <Card title={`Ancestry proportions · K = ${fit.K}`} sub={`logL ${fmt(fit.logLik, 1)} · BIC ${fmt(fit.bic, 1)} · ${fit.iterations} iterations`}>
        <StackedBars labels={fit.Q.map((_, i) => ok?.samples[i] ?? `s${i + 1}`)} names={Array.from({ length: fit.K }, (_, k) => `Component ${k + 1}`)} colors={Array.from({ length: fit.K }, (_, k) => okabe(k, true))} series={Array.from({ length: fit.K }, (_, k) => fit.Q.map((r) => r[k]))} height={320} />
        <div className="row" style={{ paddingTop: 10 }}>
          <button className="btn sm" onClick={() => downloadText('popgen_admixture_q.csv', toCsv(fit.Q.map((r, i) => ({ sample: ok?.samples[i] ?? `s${i + 1}`, ...Object.fromEntries(r.map((v, k) => [`component_${k + 1}`, v])) }))), 'text/csv')}>Export Q</button>
        </div>
      </Card>}
      {scan && <Card title="Model selection" sub="BIC = −2·logL + parameters·ln(n observed genotypes)" pad={false}>
        <DataTable rowKey={(r) => String(r.K)} rows={scan} cols={[
          { key: 'K', label: 'K', num: true },
          { key: 'logLik', label: 'log-likelihood', num: true, render: (r) => fmt(r.logLik, 1) },
          { key: 'params', label: 'parameters', num: true },
          { key: 'bic', label: 'BIC', num: true, render: (r) => fmt(r.bic, 1) },
          { key: 'iterations', label: 'iterations', num: true },
        ]} />
      </Card>}
      {!pca && !fit && !scan && <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load a genotype table, then run PCA or the admixture EM.</div></Card>}
      <Callout>Ancestry columns are sorted by their mean proportion, so labels are exchangeable between runs. Choose K from the BIC table, not from a single run.</Callout>
    </div></div>
  );
}
