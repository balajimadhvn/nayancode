import { useMemo, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { Scatter, cssVar, type Pt } from '@/viz/charts';
import { DEFAULT_ASSOC, syntheticCohort, type AssocOptions } from './assoc';
import type { VariantKernels } from './variants.worker';

const remote = createRemote<VariantKernels>(() => new Worker(new URL('./variants.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = { id: 'variants.assoc', name: 'Association testing (GWAS-lite)', version: '0.1.0', engine: 'TypeScript worker kernels', citations: ['wigginton2005', 'price2006', 'devlin1999'], describe: (p) => `Single-variant association was tested with ${p.test} on ${p.n} samples (covariates: ${p.cov || 'none'}); variants were filtered at MAF ≥ ${p.maf}, call rate ≥ ${p.cr} and exact Hardy–Weinberg p ≥ ${p.hwe}; genomic inflation λGC was ${p.lambda}` };
type Res = Awaited<ReturnType<typeof remote.assoc>>;
const num = (s: string, d: number) => { const v = Number(s); return s.trim() !== '' && Number.isFinite(v) ? v : d; };

export default function AssocPanel() {
  const [geno, setGeno] = useState<{ name: string; text: string; vcf: boolean } | null>(null), [pheno, setPheno] = useState<{ name: string; text: string } | null>(null);
  const [o, setO] = useState<AssocOptions>(DEFAULT_ASSOC), [maf, setMaf] = useState('0.01'), [cr, setCr] = useState('0.9'), [hwe, setHwe] = useState('1e-6'), [res, setRes] = useState<Res | null>(null), [causal, setCausal] = useState<string[]>([]);
  const { run, busy, progress, error } = useRunner();
  const demo = (binary: boolean) => { const c = syntheticCohort({ n: 500, m: 1500, binary, seed: 21 }); setGeno({ name: 'synthetic_genotypes.tsv', text: c.genotypes, vcf: false }); setPheno({ name: 'synthetic_phenotypes.tsv', text: c.phenotypes }); setCausal(c.causal); setO((p) => ({ ...p, nPc: 2 })); setRes(null); };
  const go = () => {
    if (!geno || !pheno) return; const opts = { ...o, minMaf: num(maf, 0.01), minCallRate: num(cr, 0.9), hweP: num(hwe, 1e-6) };
    void run({ label: 'Association testing', tool: TOOL, params: { test: opts.test, n: 0, cov: '', maf: opts.minMaf, cr: opts.minCallRate, hwe: opts.hweP, lambda: '' }, inputs: [{ name: geno.name, data: geno.text.slice(0, 5000) }, { name: pheno.name, data: pheno.text.slice(0, 5000) }], run: (h) => remote.assoc({ geno: { text: geno.text }, vcf: geno.vcf, pheno: { text: pheno.text }, opts }, h), summary: (r) => `Single-variant association was tested with ${r.res.test} on ${r.res.n} samples${r.res.covariates.length ? ` adjusting for ${r.res.covariates.join(', ')}` : ''}; ${r.res.nRows.toLocaleString()} variants passed filters (MAF ≥ ${opts.minMaf}, call rate ≥ ${opts.minCallRate}, exact HWE p ≥ ${opts.hweP}); genomic inflation λGC = ${r.res.lambda.toFixed(3)}` }).then((r) => r && setRes(r));
  };
  const man = useMemo<Pt[]>(() => (res?.summary ? res.summary.pts.map((p) => ({ x: p.x, y: p.y, cat: p.p < 5e-8 ? 2 : res.summary!.chroms.indexOf(p.chrom) % 2, label: `${p.id} · chr${p.chrom}:${p.pos.toLocaleString()} · p=${p.p.toExponential(2)}` })) : []), [res]);
  const qq = useMemo<Pt[]>(() => (res?.summary ? [...res.summary.qq.map((q) => ({ x: q.e, y: q.o, cat: 0, label: 'observed' })), ...Array.from({ length: 30 }, (_, i) => { const m = Math.max(...res.summary!.qq.map((q) => q.e)); return { x: (m * i) / 29, y: (m * i) / 29, cat: 1, label: 'expected' }; })] : []), [res]);
  const bonf = res ? -Math.log10(0.05 / res.res.nRows) : 7.3;
  return (
    <div className="split"><div className="stack">
      <Card title="1 · Data"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".tsv,.csv,.txt,.vcf" onText={(t, n) => { setGeno({ name: n, text: t, vcf: /\.vcf$/i.test(n) || t.startsWith('##fileformat') }); setRes(null); }} label={geno ? `Genotypes: ${geno.name}` : 'Genotypes: VCF (GT) or table (samples × variants, 0/1/2)'} />
        <FileDrop accept=".tsv,.csv,.txt" onText={(t, n) => { setPheno({ name: n, text: t }); setRes(null); }} label={pheno ? `Phenotypes: ${pheno.name}` : 'Phenotypes: sample, pheno, optional covariates'} />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><button className="btn" onClick={() => demo(true)}>Demo: case/control (500 × 1,500)</button><button className="btn" onClick={() => demo(false)}>Demo: quantitative trait</button></div>
        <div className="faint" style={{ fontSize: 11.5 }}>Phenotype file: columns <code>sample</code>, <code>pheno</code> (0/1, 1/2 or numeric) and any numeric covariates such as age and sex. Sample IDs must match the genotypes.</div>
      </div></Card>
      <Card title="2 · Model"><div className="stack" style={{ gap: 10 }}>
        <Field label="Test"><select className="select" value={o.test} onChange={(e) => setO({ ...o, test: e.target.value as AssocOptions['test'] })}><option value="auto">Automatic (linear or logistic)</option><option value="linear">Linear regression</option><option value="logistic">Logistic regression</option><option value="trend">Cochran–Armitage trend (no covariates)</option></select></Field>
        <div className="cols-2" style={{ gap: 8 }}><Field label="Genetic PCs"><input className="input" value={o.nPc} onChange={(e) => setO({ ...o, nPc: Math.max(0, Math.min(10, Math.round(num(e.target.value, 0)))) })} /></Field><Field label="Min MAF"><input className="input" value={maf} onChange={(e) => setMaf(e.target.value)} /></Field><Field label="Min call rate"><input className="input" value={cr} onChange={(e) => setCr(e.target.value)} /></Field><Field label="HWE p ≥"><input className="input" value={hwe} onChange={(e) => setHwe(e.target.value)} /></Field></div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={o.useCovariates} onChange={(e) => setO({ ...o, useCovariates: e.target.checked })} />Adjust for phenotype-file covariates</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={o.gcCorrect} onChange={(e) => setO({ ...o, gcCorrect: e.target.checked })} />Genomic-control correction of p-values</label>
        <button className="btn primary" disabled={!geno || !pheno || busy} onClick={go}>Run association</button>
        {busy && <Busy progress={progress} />}{error && <Callout kind="err">{error}</Callout>}
      </div></Card>
      <Callout><div>For cohorts of a few hundred to a few thousand people. Principal components come from LD-pruned variants (r² &gt; 0.5, 50-SNP window). Results are exploratory: replicate in an independent cohort, and use PLINK 2, REGENIE or SAIGE for biobank scale, related samples or rare variants.</div></Callout>
    </div>
    <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load genotypes and phenotypes (or a demo) and run the association.</div></Card> : <>
      <div className="cols-4"><Stat label="Samples" value={res.res.n} hint={res.res.nCases !== undefined ? `${res.res.nCases} cases` : undefined} /><Stat label="Variants tested" value={res.res.nRows.toLocaleString()} hint={`dropped: ${res.res.filtered.maf} low MAF, ${res.res.filtered.callRate} low call rate, ${res.res.filtered.hwe} HWE, ${res.res.filtered.failed} failed`} /><Stat label="λ GC" value={fmt(res.res.lambda, 3)} hint="≈1 is well calibrated" /><Stat label="Top −log10 p" value={fmt(-Math.log10(res.res.top[0]?.p ?? 1), 1)} /></div>
      <Callout><div>{res.res.test}{res.res.covariates.length ? `, adjusted for ${res.res.covariates.join(', ')}` : ''}. Bonferroni threshold for {res.res.nRows.toLocaleString()} tests: p &lt; {(0.05 / res.res.nRows).toExponential(1)}.{res.res.pcVar.length ? ` PCs explain ${res.res.pcVar.map((v) => fmt(v * 100, 1) + ' %').join(', ')} of genotype variance.` : ''}</div></Callout>
      {res.summary && <><Card title="Manhattan plot" sub="dashed line = Bonferroni"><Scatter points={man} colors={[cssVar('--chart-a'), cssVar('--chart-c'), cssVar('--chart-b')]} xLabel="Chromosome" yLabel="-log10 p" hlines={[bonf]} height={320} radius={2} xTicks={res.summary.ticks.map((t) => ({ x: t.x, label: t.chrom }))} /></Card>
        <div className="cols-2"><Card title="QQ plot"><Scatter points={qq} colors={[cssVar('--chart-a'), cssVar('--text-faint')]} xLabel="Expected -log10 p" yLabel="Observed -log10 p" height={300} equalAspect /></Card>
          <Card title="Top variants" pad={false} actions={<button className="btn sm" onClick={() => downloadText('association_results.csv', res.csv, 'text/csv')}>Download all (CSV)</button>}><DataTable rows={res.res.top} rowKey={(r) => r.id} limit={25} cols={[{ key: 'id', label: 'Variant', render: (r) => <span className={causal.includes(r.id) ? 'mono' : ''}>{r.id}{causal.includes(r.id) ? ' ★' : ''}</span> }, { key: 'maf', label: 'MAF', num: true, render: (r) => fmt(r.maf, 3) }, { key: 'beta', label: 'β / log OR', num: true, render: (r) => fmt(r.beta, 3) }, { key: 'p', label: 'p', num: true, render: (r) => r.p.toExponential(2), sort: (r) => r.p }]} /></Card></div></>}
      {causal.length > 0 && <div className="faint" style={{ fontSize: 12 }}>★ marks the three variants planted in the synthetic demo.</div>}
    </>}</div></div>
  );
}
