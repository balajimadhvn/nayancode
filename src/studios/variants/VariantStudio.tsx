import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import { useNavigate } from 'react-router-dom';
import { clearHandoffSoon, useHandoff } from '@/core/handoff';
import { trackedFetch } from '@/core/net';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { BarChart, Histogram, Scatter, cssVar, type Pt } from '@/viz/charts';
import { MultiLine, SigBars, StackedBars, catColors } from '@/viz/more';
import { CHANNELS, demoCohort, demoSignatures, parseSignatureMatrix, suggestK } from './signatures';
import { civicEvidence, clinvarAtPosition, geneCard, gnomadFrequency, type CivicRow, type ClinvarRow, type GeneCard } from './evidence';
import { SBS6, applyRules, parseVep, sbsClass, syntheticGwas, syntheticVcf, vcfQc, vepRequest, type Field as RF, type Rule, type Variant, type VepRow } from './kernels';
import type { VariantKernels } from './variants.worker';

const remote = createRemote<VariantKernels>(() => new Worker(new URL('./variants.worker.ts', import.meta.url), { type: 'module' }));
const V = '0.1.0', E = 'TypeScript worker kernels';
const TOOLS = {
  vcf: { id: 'variants.vcf', name: 'VCF parsing, QC and filtering', version: V, engine: E, citations: [], describe: (p) => `Variants (n = ${p.n}) were parsed from VCF and summarised (transition/transversion ratio, genotype counts, substitution spectrum); hard filters were applied as specified (${p.rules || 'none'})` } as ToolInfo,
  vep: { id: 'variants.vep', name: 'Ensembl VEP annotation', version: V, engine: 'Ensembl REST API (rest.ensembl.org)', citations: ['mclaren2016'], describe: (p) => `${p.n} variants were annotated with the Ensembl Variant Effect Predictor REST service (${p.assembly})` } as ToolInfo,
  gwas: { id: 'variants.gwas', name: 'GWAS summary statistics', version: V, engine: E, citations: [], describe: (p) => `GWAS summary statistics (${p.n} variants) were summarised: genomic inflation λGC from the median χ² (1 df), distance-based lead-variant clumping (500 kb, p < 5×10⁻⁸)` } as ToolInfo,
};
type Tab = 'table' | 'qc' | 'somatic' | 'signatures' | 'annotate' | 'evidence' | 'gwas' | 'assoc';
const AssocPanel = lazy(() => import('./AssocPanel'));
const FIELDS: RF[] = ['QUAL', 'DP', 'VAF', 'AF', 'FILTER', 'TYPE', 'CHROM', 'GT'];

export default function VariantStudio() {
  const [tab, setTab] = useState<Tab>('table');
  const [data, setData] = useState<Awaited<ReturnType<VariantKernels['vcf']>> | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const { run, busy, progress, note, error } = useRunner();
  const [vcfSrc, setVcfSrc] = useState<{ file?: File; text?: string } | null>(null);
  const handoff = useHandoff((s) => s.vcf), setView = useHandoff((s) => s.setView), nav = useNavigate();
  const load = (src: { file?: File; text?: string }, label: string) => void run({ label: `VCF · ${label}`, tool: TOOLS.vcf, params: { n: '…', rules: '' }, inputs: [{ name: label, data: src.text ?? `${label}:${src.file?.size}` }], run: (h) => remote.vcf(src, h), summary: (r) => `${r.total.toLocaleString()} variants (${r.samples.length} samples) were parsed from VCF and summarised (transition/transversion ratio, genotype counts, substitution spectrum)` }).then((r) => { if (r) { setData(r); setVcfSrc(src); setRules([]); setTab('table'); } });
  useEffect(() => { if (handoff) { load({ text: handoff.text }, handoff.label); clearHandoffSoon('vcf'); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [handoff]);
  const vcf = useMemo(() => (data ? { samples: data.samples, variants: data.variants, contigs: [], skipped: data.skipped } : null), [data]);
  const { kept, funnel } = useMemo(() => (vcf ? applyRules(vcf.variants, rules.filter((r) => r.value !== '')) : { kept: [], funnel: [] }), [vcf, rules]);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Variant Studio</h1><p>Explore VCFs with QC, hard filters, mutation spectrum and TMB, optional Ensembl annotation, and GWAS Manhattan/QQ with genomic inflation. Research use only.</p></div></div>
      <div className="split"><div className="stack">
        <Card title="VCF" sub=".vcf / .vcf.gz">
          <div className="stack" style={{ gap: 10 }}>
            <label className="dropzone"><input type="file" hidden accept=".vcf,.gz" onChange={(e) => { const f = e.target.files?.[0]; if (f) load({ file: f }, f.name); }} />Choose a VCF or VCF.gz<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Parsed in a worker. Never uploaded.</div></label>
            <button className="btn" disabled={busy} onClick={() => load({ text: syntheticVcf(4, 3000) }, 'synthetic_tumor_normal.vcf')}>Demo: synthetic tumor/normal VCF</button>
            {data && vcfSrc && <button className="btn" onClick={() => { setView([{ name: 'variants.vcf', ...vcfSrc }]); nav('/genome'); }}>Open in genome viewer</button>}
            {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
            {data && <div className="faint" style={{ fontSize: 12 }}>{data.total.toLocaleString()} variants · {data.samples.length} samples ({data.samples.join(', ')}){data.truncated ? ' · table capped at 150,000 rows' : ''}{data.skipped ? ` · ${data.skipped} malformed lines skipped` : ''}</div>}
          </div>
        </Card>
        {data && <FilterCard rules={rules} setRules={setRules} samples={data.samples} funnel={funnel} />}
        <Callout kind="warn">Research use only. Not a clinical classifier: no ACMG/AMP calls are made.</Callout>
      </div>
      <div className="stack">
        <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'table', label: 'Variants' }, { id: 'qc', label: 'QC' }, { id: 'somatic', label: 'Somatic' }, { id: 'signatures', label: 'Signatures' }, { id: 'annotate', label: 'Annotate' }, { id: 'evidence', label: 'Evidence' }, { id: 'gwas', label: 'GWAS' }, { id: 'assoc', label: 'Association' }]} />
        {tab !== 'gwas' && tab !== 'assoc' && tab !== 'evidence' && tab !== 'signatures' && !vcf && <Card><div className="faint" style={{ padding: '30px 6px', textAlign: 'center' }}>Load a VCF or the demo. For GWAS summary statistics use the GWAS tab.</div></Card>}
        {tab === 'table' && vcf && <TableView kept={kept} samples={vcf.samples} />}
        {tab === 'qc' && vcf && <QcView vcf={vcf} kept={kept} />}
        {tab === 'somatic' && vcf && <Somatic vcf={vcf} kept={kept} />}
        {tab === 'signatures' && <Signatures vcfSrc={vcfSrc} samples={data?.samples ?? []} />}
        {tab === 'annotate' && vcf && <Annotate kept={kept} />}
        {tab === 'evidence' && <Evidence kept={kept} />}
        {tab === 'gwas' && <Gwas />}
        {tab === 'assoc' && <Suspense fallback={null}><AssocPanel /></Suspense>}
      </div></div>
    </div>
  );
}

function FilterCard({ rules, setRules, samples, funnel }: { rules: Rule[]; setRules(r: Rule[]): void; samples: string[]; funnel: { label: string; n: number }[] }) {
  const upd = (i: number, p: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Card title="Hard filters" sub="all rules must pass" actions={<button className="btn sm" onClick={() => setRules([...rules, { field: 'FILTER', op: '=', value: 'PASS' }])}>+ Rule</button>}>
      <div className="stack" style={{ gap: 8 }}>
        {rules.length === 0 && <div className="faint" style={{ fontSize: 12.5 }}>No filters. Add e.g. <code>FILTER = PASS</code>, <code>DP ≥ 30</code>, <code>VAF ≥ 0.1</code>.</div>}
        {rules.map((r, i) => (
          <div key={i} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <select className="select" style={{ width: 92 }} value={r.field} onChange={(e) => upd(i, { field: e.target.value as RF })}>{FIELDS.map((f) => <option key={f}>{f}</option>)}</select>
            <select className="select" style={{ width: 66 }} value={r.op} onChange={(e) => upd(i, { op: e.target.value as Rule['op'] })}>{['>=', '<=', '=', '!='].map((o) => <option key={o}>{o}</option>)}</select>
            <input className="input" value={r.value} onChange={(e) => upd(i, { value: e.target.value })} />
            {['DP', 'VAF', 'GT'].includes(r.field) && samples.length > 1 && <select className="select" style={{ width: 90 }} value={r.sample ?? 0} onChange={(e) => upd(i, { sample: +e.target.value })}>{samples.map((s, k) => <option key={s} value={k}>{s}</option>)}</select>}
            <button className="btn ghost icon" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
          </div>))}
        <div style={{ display: 'grid', gap: 5 }}>{funnel.map((f, i) => <div key={i}><div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}><span className="dim">{f.label}</span><b className="mono">{f.n.toLocaleString()}</b></div><div className="progress"><i style={{ width: `${(f.n / (funnel[0].n || 1)) * 100}%` }} /></div></div>)}</div>
      </div>
    </Card>
  );
}

function TableView({ kept, samples }: { kept: Variant[]; samples: string[] }) {
  return (
    <Card title="Variants" sub={`${kept.length.toLocaleString()} after filters`} pad={false} actions={<button className="btn sm" onClick={() => downloadText('filtered_variants.csv', toCsv(kept.map((v) => ({ chrom: v.chrom, pos: v.pos, id: v.id, ref: v.ref, alt: v.alt, type: v.type, qual: v.qual ?? '', filter: v.filter, dp: v.dp ?? '', ...Object.fromEntries(samples.map((s, i) => [`${s}_GT`, v.calls[i]?.gt ?? ''])), ...Object.fromEntries(samples.map((s, i) => [`${s}_VAF`, v.calls[i]?.vaf?.toFixed(3) ?? '']))}))), 'text/csv')}>Export CSV</button>}>
      <DataTable rows={kept} rowKey={(v, i) => `${v.chrom}:${v.pos}:${i}`} limit={400} cols={[
        { key: 'chrom', label: 'Chr', sort: (v) => v.chrom }, { key: 'pos', label: 'Pos', num: true, sort: (v) => v.pos, render: (v) => v.pos.toLocaleString() },
        { key: 'ref', label: 'Ref', render: (v) => <code>{v.ref.slice(0, 12)}</code> }, { key: 'alt', label: 'Alt', render: (v) => <code>{v.alt.slice(0, 12)}</code> },
        { key: 'type', label: 'Type', sort: (v) => v.type }, { key: 'qual', label: 'QUAL', num: true, sort: (v) => v.qual ?? -1, render: (v) => (v.qual === null ? '–' : fmt(v.qual, 0)) },
        { key: 'filter', label: 'Filter', render: (v) => <span className={`badge ${v.filter === 'PASS' ? 'live' : 'building'}`}>{v.filter}</span>, sort: (v) => v.filter },
        ...samples.flatMap((s, i) => [{ key: `gt${i}`, label: `${s} GT`, render: (v: Variant) => <code>{v.calls[i]?.gt}</code> }, { key: `vaf${i}`, label: `${s} VAF`, num: true, sort: (v: Variant) => v.calls[i]?.vaf ?? -1, render: (v: Variant) => (v.calls[i]?.vaf == null ? '–' : fmt(v.calls[i].vaf!, 2)) }]),
      ]} />
    </Card>
  );
}

function QcView({ vcf, kept }: { vcf: { samples: string[]; variants: Variant[]; contigs: string[]; skipped: number }; kept: Variant[] }) {
  const q = useMemo(() => vcfQc(vcf, kept), [vcf, kept]), pal = [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d'), cssVar('--accent-3'), cssVar('--warn')];
  return (
    <>
      <div className="cols-4"><Stat label="Variants (filtered)" value={q.passing.toLocaleString()} /><Stat label="Ti/Tv" value={fmt(q.titv, 2)} hint="Whole-genome germline ≈ 2.0–2.1; exome ≈ 2.8–3.0; somatic is usually lower" /><Stat label="Indel fraction" value={`${fmt(q.indelFrac * 100, 1)}%`} /><Stat label="Multi-allelic" value={q.multiAllelic} /></div>
      <div className="cols-2">
        <Card title="Variant types"><BarChart labels={Object.keys(q.byType)} values={Object.values(q.byType)} colors={pal} yLabel="Variants" /></Card>
        <Card title="Substitution spectrum" sub="pyrimidine-referenced SNVs"><BarChart labels={[...SBS6]} values={SBS6.map((s) => q.spectrum[s])} colors={['#22bfef', '#1f2937', '#ef4444', '#cbd5e1', '#84cc16', '#f0abfc']} yLabel="SNVs" /></Card>
        <Card title="Per chromosome"><BarChart labels={q.perChrom.map((c) => c.chrom)} values={q.perChrom.map((c) => c.n)} colors={[cssVar('--chart-c')]} yLabel="Variants" /></Card>
        <Card title="Read depth (DP)"><Histogram values={q.dp} label="DP" bins={30} /></Card>
        <Card title="Variant quality (QUAL)"><Histogram values={q.qual} label="QUAL" bins={30} color="--chart-b" /></Card>
        <Card title="Per-sample genotypes" pad={false}><DataTable rows={q.perSample} rowKey={(r) => r.sample} cols={[{ key: 'sample', label: 'Sample' }, { key: 'called', label: 'Called', num: true }, { key: 'het', label: 'Het', num: true }, { key: 'hom', label: 'Hom-alt', num: true }, { key: 'hh', label: 'Het/Hom', num: true, render: (r) => fmt(r.hetHom, 2) }, { key: 'dp', label: 'Mean DP', num: true, render: (r) => fmt(r.meanDp, 1) }]} /></Card>
      </div>
    </>
  );
}

function Somatic({ vcf, kept }: { vcf: { samples: string[]; variants: Variant[]; contigs: string[]; skipped: number }; kept: Variant[] }) {
  const [si, setSi] = useState(0), [mb, setMb] = useState(30), [minVaf, setMinVaf] = useState(0.05), [dpMin, setDpMin] = useState(20);
  const calls = useMemo(() => kept.filter((v) => { const c = v.calls[si]; return c && c.vaf !== null && c.vaf >= minVaf && (c.dp ?? 0) >= dpMin && c.gt !== '0/0' && (vcf.samples.length < 2 || !(vcf.samples.length > 1 && v.calls.some((x, i) => i !== si && x.vaf !== null && x.vaf > 0.2 && x.dp !== null && x.dp > 10 && vcf.samples[i].toLowerCase().includes('normal')))); }), [kept, si, minVaf, dpMin, vcf.samples]);
  const spec = useMemo(() => { const o = Object.fromEntries(SBS6.map((s) => [s, 0])) as Record<string, number>; for (const v of calls) if (v.type === 'SNV') { const c = sbsClass(v.ref, v.alt); if (c) o[c]++; } return o; }, [calls]);
  const vafs = calls.map((v) => v.calls[si].vaf!);
  return (
    <>
      <Card title="Somatic settings" sub="a germline-looking call in a sample named *normal* is excluded"><div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="Tumor sample"><select className="select" value={si} onChange={(e) => setSi(+e.target.value)}>{vcf.samples.map((s, i) => <option key={s} value={i}>{s}</option>)}</select></Field>
        <Field label="Min VAF"><input className="input" type="number" step={0.01} value={minVaf} onChange={(e) => setMinVaf(+e.target.value)} style={{ width: 90 }} /></Field>
        <Field label="Min DP"><input className="input" type="number" value={dpMin} onChange={(e) => setDpMin(+e.target.value)} style={{ width: 90 }} /></Field>
        <Field label="Callable Mb"><input className="input" type="number" value={mb} onChange={(e) => setMb(+e.target.value)} style={{ width: 90 }} /></Field></div></Card>
      <div className="cols-4"><Stat label="Somatic-like calls" value={calls.length.toLocaleString()} /><Stat label="TMB (mut/Mb)" value={fmt(calls.length / mb, 1)} hint="All SNVs+indels over the callable size. Clinical TMB uses nonsynonymous coding variants only; annotate first." /><Stat label="Median VAF" value={vafs.length ? fmt([...vafs].sort((a, b) => a - b)[Math.floor(vafs.length / 2)], 2) : '–'} /><Stat label="C>T fraction" value={`${fmt((spec['C>T'] / (Object.values(spec).reduce((a, b) => a + b, 0) || 1)) * 100, 0)}%`} /></div>
      <div className="cols-2"><Card title="VAF distribution" sub="clonal peak near purity/2"><Histogram values={vafs} label="variant allele fraction" bins={25} /></Card><Card title="Mutation spectrum"><BarChart labels={[...SBS6]} values={SBS6.map((s) => spec[s])} colors={['#22bfef', '#1f2937', '#ef4444', '#cbd5e1', '#84cc16', '#f0abfc']} yLabel="SNVs" /></Card></div>
      <Callout>Mutational signatures are in the <b style={{ color: 'var(--text)' }}>Signatures</b> tab: de novo NMF extraction on your own cohort, and refitting to any reference matrix you upload. COSMIC signatures are not bundled because they need a commercial licence.</Callout>
    </>
  );
}

function Annotate({ kept }: { kept: Variant[] }) {
  const { run, busy, error } = useRunner(); const [rows, setRows] = useState<VepRow[]>([]), [asm, setAsm] = useState<'GRCh38' | 'GRCh37'>('GRCh38'), [n, setN] = useState(25);
  const cands = kept.filter((v) => v.type !== 'SV').slice(0, n);
  const go = () => {
    const body = vepRequest(cands);
    if (!confirm(`This sends ${body.variants.length} variant coordinates (chrom, position, ref, alt only; no sample data) to rest.ensembl.org to annotate against ${asm}.\n\nContinue?`)) return;
    void run({ label: `Ensembl VEP · ${body.variants.length}`, tool: TOOLS.vep, params: { n: body.variants.length, assembly: asm }, inputs: [], run: async () => { const host = asm === 'GRCh38' ? 'https://rest.ensembl.org' : 'https://grch37.rest.ensembl.org'; const r = await trackedFetch(`${host}/vep/human/region`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }); return parseVep(await r.json()); } }).then((r) => r && setRows(r));
  };
  return (
    <>
      <Card title="Ensembl Variant Effect Predictor" sub="optional, sends coordinates after you confirm">
        <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Variants (top of filtered list)"><input className="input" type="number" min={1} max={200} value={n} onChange={(e) => setN(Math.min(200, Math.max(1, +e.target.value)))} style={{ width: 120 }} /></Field><Field label="Assembly"><select className="select" value={asm} onChange={(e) => setAsm(e.target.value as 'GRCh38' | 'GRCh37')}><option>GRCh38</option><option>GRCh37</option></select></Field><button className="btn primary" disabled={busy || !cands.length} onClick={go}>Annotate {cands.length}</button></div>
        {error && <div style={{ marginTop: 10 }}><Callout kind="err">{error}</Callout></div>}
        <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>The demo VCF uses synthetic coordinates; Ensembl will return intergenic/no-hit rows for them. Use real human variants (chr:pos in the chosen assembly) for meaningful output. Ensembl REST is free with fair-use rate limits.</div>
      </Card>
      {rows.length > 0 && <Card title="Annotation" pad={false}><DataTable rows={rows} rowKey={(r, i) => r.input + i} cols={[{ key: 'input', label: 'Variant', render: (r) => <code>{r.input.split(' ').slice(0, 5).join(' ')}</code> }, { key: 'gene', label: 'Gene', sort: (r) => r.gene }, { key: 'consequence', label: 'Most severe', sort: (r) => r.consequence }, { key: 'impact', label: 'Impact', sort: (r) => r.impact, render: (r) => <span className={`badge ${r.impact === 'HIGH' ? 'building' : r.impact === 'MODERATE' ? 'live' : 'planned'}`}>{r.impact}</span> }, { key: 'biotype', label: 'Biotype' }]} /></Card>}
    </>
  );
}

function Gwas() {
  const { run, busy, progress, error } = useRunner(); const [res, setRes] = useState<Awaited<ReturnType<VariantKernels['gwas']>> | null>(null);
  const go = (src: { file?: File; text?: string }, label: string) => void run({ label: `GWAS · ${label}`, tool: TOOLS.gwas, params: { n: '…' }, inputs: [{ name: label, data: src.text ?? `${label}:${src.file?.size}` }], run: (h) => remote.gwas(src, h), summary: (r) => `GWAS summary statistics (${r.n.toLocaleString()} variants) were summarised: genomic inflation λGC from the median χ² (1 df), distance-based lead-variant clumping (500 kb, p < 5×10⁻⁸)` }).then((r) => r && setRes(r));
  const man = useMemo<Pt[]>(() => (res ? res.pts.map((p) => ({ x: p.x, y: p.y, cat: p.p < 5e-8 ? 2 : res.chroms.indexOf(p.chrom) % 2, label: `${p.id} · chr${p.chrom}:${p.pos.toLocaleString()} · p=${p.p.toExponential(2)}` })) : []), [res]);
  const qq = useMemo<Pt[]>(() => (res ? [...res.qq.map((q) => ({ x: q.e, y: q.o, cat: 0, label: 'observed' })), ...Array.from({ length: 30 }, (_, i) => { const m = Math.max(...res.qq.map((q) => q.e)); return { x: (m * i) / 29, y: (m * i) / 29, cat: 1, label: 'expected' }; })] : []), [res]);
  return (
    <>
      <Card title="Summary statistics" sub="TSV/CSV with chromosome, position, p-value">
        <div className="row"><label className="btn"><input type="file" hidden accept=".tsv,.txt,.csv,.gz" onChange={(e) => { const f = e.target.files?.[0]; if (f) go({ file: f }, f.name); }} />Choose file</label><button className="btn" disabled={busy} onClick={() => go({ text: syntheticGwas(8, 60000) }, 'synthetic_gwas.tsv')}>Demo: 60k synthetic SNPs (3 planted loci)</button></div>
        {busy && <div style={{ marginTop: 10 }}><Busy progress={progress} /></div>}{error && <div style={{ marginTop: 10 }}><Callout kind="err">{error}</Callout></div>}
      </Card>
      {res && <>
        <div className="cols-4"><Stat label="Variants" value={res.n.toLocaleString()} /><Stat label="λ GC" value={fmt(res.lambda, 3)} hint="≈1 is well calibrated; >1.1 suggests stratification or polygenicity" /><Stat label="Lead loci" value={res.leads.length} hint="p < 5e-8, 500 kb clumping" /><Stat label="Top −log10 p" value={fmt(Math.max(...res.pts.map((p) => p.y)), 1)} /></div>
        <Card title="Manhattan plot" sub="dashed line = genome-wide significance 5×10⁻⁸"><Scatter points={man} colors={[cssVar('--chart-a'), cssVar('--chart-c'), cssVar('--chart-b')]} xLabel="Chromosome" yLabel="-log10 p" hlines={[7.301]} height={340} radius={1.8} xTicks={res.ticks.map((t) => ({ x: t.x, label: t.chrom }))} /></Card>
        <div className="cols-2"><Card title="QQ plot"><Scatter points={qq} colors={[cssVar('--chart-a'), cssVar('--text-faint')]} xLabel="Expected -log10 p" yLabel="Observed -log10 p" height={320} equalAspect /></Card>
          <Card title="Lead variants" pad={false}><DataTable rows={res.leads} rowKey={(r) => r.id} cols={[{ key: 'id', label: 'Variant' }, { key: 'chrom', label: 'Chr' }, { key: 'pos', label: 'Position', num: true, render: (r) => r.pos.toLocaleString() }, { key: 'p', label: 'p-value', num: true, render: (r) => r.p.toExponential(2), sort: (r) => r.p }]} /></Card></div>
      </>}
    </>
  );
}

const SIG_TOOL: ToolInfo = { id: 'variants.signatures', name: 'Mutational signature analysis', version: '0.1.0', engine: 'TypeScript worker kernels', citations: ['alexandrov2013', 'lee2001', 'lawson1974'], describe: (p) => `Single-base-substitution spectra were classified into 96 trinucleotide channels; ${p.k} signatures were extracted de novo by non-negative matrix factorisation (Kullback–Leibler divergence, multiplicative updates, ${p.restarts} restarts; model order chosen by reconstruction error and restart stability)${p.ref ? ' and matched to the supplied reference signatures by cosine similarity, with exposures refitted by non-negative least squares' : ''}` };
function Signatures({ vcfSrc, samples }: { vcfSrc: { file?: File; text?: string } | null; samples: string[] }) {
  const sel = useRunner(), ext = useRunner(), cnt = useRunner();
  const [V, setV] = useState<number[][] | null>(null), [names, setNames] = useState<string[]>([]), [fasta, setFasta] = useState(''), [ref, setRef] = useState<{ names: string[]; sigs: number[][] } | null>(null), [refErr, setRefErr] = useState('');
  const [curve, setCurve] = useState<{ k: number; error: number; stability: number; cosine: number }[]>([]), [k, setK] = useState(2), [out, setOut] = useState<Awaited<ReturnType<typeof remote.sigExtract>> | null>(null), [info, setInfo] = useState('');
  const demo = () => { const d = demoCohort(30, 4); setV(d.V); setNames(d.names); setCurve([]); setOut(null); setInfo('Synthetic cohort: 30 samples built from two planted, made-up signatures (not COSMIC).'); };
  const fromVcf = () => vcfSrc && fasta && void cnt.run({ label: 'SBS-96 contexts', tool: SIG_TOOL, params: { k: 0, restarts: 0 }, inputs: [{ name: 'fasta', data: fasta.slice(0, 100000) }], run: (h) => remote.sbs({ vcf: vcfSrc, fasta, sampleIdx: [] }, h), summary: () => 'Single-base-substitution contexts were derived from the VCF and the supplied reference FASTA' }).then((r) => { if (r) { setV(r.rows.map((x) => x.counts)); setNames(r.rows.map((x) => x.sample)); setCurve([]); setOut(null); setInfo(r.rows.map((x) => `${x.sample}: ${x.used} SNVs used, ${x.skipped} skipped, ${x.missingContig} on contigs missing from the FASTA`).join(' · ')); } });
  const select = () => V && void sel.run({ label: 'Signature model selection', tool: SIG_TOOL, params: { k: 'selection', restarts: 6 }, inputs: [{ name: 'counts', data: JSON.stringify(V).slice(0, 50000) }], run: (h) => remote.sigSelect({ V, kMax: Math.min(8, V.length - 1) }, h), summary: () => 'The number of signatures was chosen from reconstruction error and restart stability across k' }).then((r) => r && setCurve(r));
  const extract = () => V && void ext.run({ label: `NMF signatures · k=${k}`, tool: SIG_TOOL, params: { k, restarts: 10, ref: !!ref }, inputs: [{ name: 'counts', data: JSON.stringify(V).slice(0, 50000) }], run: (h) => remote.sigExtract({ V, k, ref: ref ?? undefined }, h) }).then((r) => r && setOut(r));
  const loadTable = (t: string) => { try { const lines = t.split(/\r?\n/).filter(Boolean), d = lines[0].includes('\t') ? '\t' : ','; const rows = lines.slice(1).map((l) => l.split(d)); const head = lines[0].split(d).slice(1).map((x) => x.replace(/\s/g, '')); if (head.length !== 96) throw new Error(`Expected 96 channel columns, found ${head.length}.`); const order = CHANNELS.map((c) => head.indexOf(c)); if (order.some((o) => o < 0)) throw new Error('Column names must be SBS channels like A[C>A]A.'); setV(rows.map((r) => order.map((o) => Number(r[o + 1])))); setNames(rows.map((r) => r[0])); setCurve([]); setOut(null); setInfo(`${rows.length} samples loaded.`); } catch (e) { setInfo('✗ ' + (e as Error).message); } };
  const best = curve.length ? suggestK(curve) : null;
  const cols = catColors(out?.ex.k ?? 2);
  return (
    <>
      <Card title="Mutational signatures" sub="no restricted reference data needed" >
        <div className="stack" style={{ gap: 10 }}>
          <div className="row"><button className="btn" onClick={demo}>Demo cohort (synthetic)</button><FileDrop onText={loadTable} label="Sample × 96-channel count table (TSV/CSV)" /></div>
          <div className="cols-2" style={{ gap: 10 }}>
            <Card title="Or derive from this VCF" sub={vcfSrc ? `${samples.length} sample column(s)` : 'load a VCF first'}><div className="stack" style={{ gap: 8 }}><FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t) => setFasta(t)} label={fasta ? 'Reference FASTA loaded' : 'Reference FASTA (contigs used by the VCF)'} /><button className="btn" disabled={!vcfSrc || !fasta || cnt.busy} onClick={fromVcf}>Extract SBS-96 per sample</button>{cnt.error && <Callout kind="err">{cnt.error}</Callout>}<div className="faint" style={{ fontSize: 11.5 }}>Needs the reference genome, so it suits small genomes and targeted panels; for human WGS, extract contexts with a tool next to the genome and drop the count table instead.</div></div></Card>
            <Card title="Optional reference signatures" sub="any matrix you are licensed to use"><div className="stack" style={{ gap: 8 }}><FileDrop onText={(t) => { try { setRef(parseSignatureMatrix(t)); setRefErr(''); } catch (e) { setRef(null); setRefErr((e as Error).message); } }} label={ref ? `${ref.names.length} reference signatures loaded` : '96 × n matrix, rows named A[C>A]A'} /><button className="btn sm" onClick={() => { setRef(demoSignatures()); setRefErr(''); }}>Use the 2 demo signatures</button>{refErr && <Callout kind="err">{refErr}</Callout>}<div className="faint" style={{ fontSize: 11.5 }}>COSMIC and other restricted sets are not bundled. Load your own licensed copy locally; it never leaves your browser.</div></div></Card>
          </div>
          {info && <Callout>{info}</Callout>}
        </div>
      </Card>
      {V && <>
        <Card title="1 · Choose the number of signatures" sub={`${V.length} samples`} actions={<button className="btn primary sm" disabled={sel.busy || V.length < 4} onClick={select}>Run model selection</button>}>
          {sel.busy && <Busy progress={sel.progress} note={sel.note} />}{sel.error && <Callout kind="err">{sel.error}</Callout>}{V.length < 8 && <Callout kind="warn">Fewer than 8 samples: de novo extraction is unreliable. Prefer refitting to a reference matrix.</Callout>}
          {curve.length > 0 && <><MultiLine xs={curve.map((c) => c.k)} yMin={0} yMax={1} xLabel="Number of signatures (k)" yLabel="Score" series={[{ name: 'restart stability', ys: curve.map((c) => c.stability), color: cssVar('--accent-3') }, { name: 'cosine to input', ys: curve.map((c) => c.cosine), color: cssVar('--chart-a') }]} height={200} /><div className="faint" style={{ fontSize: 12 }}>Suggested k is the elbow: the smallest k after which reconstruction stops improving materially while restarts stay reproducible (stability ≥ 0.9). Suggested: <b style={{ color: 'var(--text)' }}>k = {best}</b>.</div></>}
        </Card>
        <Card title="2 · Extract" actions={<><label className="row dim" style={{ fontSize: 12 }}>k <input className="input" type="number" min={1} max={8} value={k} onChange={(e) => setK(Math.max(1, Math.min(8, +e.target.value)))} style={{ width: 64 }} /></label><button className="btn primary sm" disabled={ext.busy} onClick={extract}>Extract</button></>}>
          {ext.busy && <Busy progress={ext.progress} note={ext.note} />}{ext.error && <Callout kind="err">{ext.error}</Callout>}
          {out && <div className="stack" style={{ gap: 12 }}>
            <div className="cols-4"><Stat label="Signatures" value={out.ex.k} /><Stat label="Stability" value={fmt(out.ex.stability, 3)} /><Stat label="Cosine (fit)" value={fmt(out.ex.cosineToInput, 3)} /><Stat label="Samples" value={V.length} /></div>
            {out.ex.signatures.map((s, i) => <div key={i}><SigBars values={s} label={`De novo signature ${i + 1}${out.matches[i] ? ` · closest reference: ${out.matches[i].ref} (cosine ${out.matches[i].cosine.toFixed(2)})` : ''}`} /></div>)}
            <Card title="Exposures per sample" sub="mutations attributed to each signature"><StackedBars labels={names} names={out.ex.signatures.map((_, i) => `Signature ${i + 1}`)} colors={cols} series={out.ex.signatures.map((_, a) => out.ex.exposures.map((r) => { const t = r.reduce((x, y) => x + y, 0) || 1; return r[a] / t; }))} height={260} /></Card>
            {out.refit.length > 0 && <Card title="Refit to reference" sub="NNLS exposures" pad={false}><DataTable rows={out.refit} rowKey={(r) => String(r.sample)} cols={[{ key: 's', label: 'Sample', render: (r) => names[r.sample] }, ...(ref?.names ?? []).map((n, j) => ({ key: n, label: n, num: true, render: (r: (typeof out.refit)[number]) => fmt(r.exposures[j], 0) })), { key: 'cos', label: 'Fit cosine', num: true, render: (r) => fmt(r.cosine, 3) }]} /></Card>}
            <button className="btn sm" onClick={() => downloadText('signatures.tsv', ['channel\t' + out.ex.signatures.map((_, i) => `Sig${i + 1}`).join('\t'), ...CHANNELS.map((c, ci) => c + '\t' + out.ex.signatures.map((s) => s[ci].toFixed(6)).join('\t'))].join('\n'))}>Export signatures (TSV)</button>
          </div>}
        </Card>
      </>}
    </>
  );
}

const EV_TOOL: ToolInfo = { id: 'variants.evidence', name: 'Clinical evidence lookup', version: '0.1.0', engine: 'ClinVar (NCBI) · CIViC · Open Targets · gnomAD via MyVariant.info', citations: ['clinvar2018', 'civic2017', 'opentargets2023', 'gnomad2020'], describe: (p) => `Public evidence was retrieved for ${p.query} from ClinVar (NCBI E-utilities), CIViC, the Open Targets Platform and gnomAD (via MyVariant.info); all four are openly licensed` };
function Evidence({ kept }: { kept: Variant[] }) {
  const { run, busy, error } = useRunner();
  const [gene, setGene] = useState('BRAF'), [profile, setProfile] = useState('BRAF V600E'), [asm, setAsm] = useState<'GRCh38' | 'GRCh37'>('GRCh38');
  const [chr, setChr] = useState('7'), [pos, setPos] = useState(140753336), [ref, setRef] = useState('A'), [alt, setAlt] = useState('T');
  const [card, setCard] = useState<GeneCard | null>(null), [civic, setCivic] = useState<{ rows: CivicRow[]; total: number } | null>(null), [cv, setCv] = useState<ClinvarRow[] | null>(null), [af, setAf] = useState<Awaited<ReturnType<typeof gnomadFrequency>> | 'none' | null>(null);
  const confirmSend = (what: string) => confirm(`This sends ${what} to public databases (Open Targets, CIViC, NCBI, MyVariant.info). No sample data or file contents are sent.\n\nContinue?`);
  const geneGo = () => confirmSend(`the gene symbol "${gene}"`) && void run({ label: `Gene card · ${gene}`, tool: EV_TOOL, params: { query: `gene ${gene}` }, inputs: [], run: () => geneCard(gene) }).then((r) => r && setCard(r));
  const civicGo = () => confirmSend(`the molecular profile name "${profile}"`) && void run({ label: `CIViC · ${profile}`, tool: EV_TOOL, params: { query: `profile ${profile}` }, inputs: [], run: () => civicEvidence(profile) }).then((r) => r && setCivic(r));
  const varGo = () => confirmSend(`the coordinates ${chr}:${pos} ${ref}>${alt} (${asm})`) && void run({ label: `ClinVar/gnomAD · ${chr}:${pos}`, tool: EV_TOOL, params: { query: `variant ${chr}:${pos}${ref}>${alt}` }, inputs: [], run: async () => ({ cv: await clinvarAtPosition(chr, pos, asm), af: await gnomadFrequency(chr, pos, ref, alt, asm) }) }).then((r) => { if (r) { setCv(r.cv); setAf(r.af ?? 'none'); } });
  return (
    <>
      <Callout>Sources are queried live and only after you confirm. All are openly licensed: ClinVar (public domain), CIViC (CC0), Open Targets (CC0), gnomAD (CC0). OncoKB, COSMIC, OMIM, HGMD and CADD are deliberately not used because they need commercial licences. Research use only.</Callout>
      <div className="cols-2">
        <Card title="Gene & cancer evidence"><div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Gene symbol"><input className="input" value={gene} onChange={(e) => setGene(e.target.value)} style={{ width: 130 }} /></Field><button className="btn primary" disabled={busy} onClick={geneGo}>Gene card</button></div>
          <div className="row" style={{ alignItems: 'flex-end' }}><Field label="CIViC molecular profile"><input className="input" value={profile} onChange={(e) => setProfile(e.target.value)} style={{ width: 190 }} /></Field><button className="btn primary" disabled={busy} onClick={civicGo}>CIViC evidence</button></div>
        </div></Card>
        <Card title="Variant: ClinVar & gnomAD"><div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Chr"><input className="input" value={chr} onChange={(e) => setChr(e.target.value)} style={{ width: 62 }} /></Field><Field label="Position"><input className="input" type="number" value={pos} onChange={(e) => setPos(+e.target.value)} style={{ width: 130 }} /></Field><Field label="Ref"><input className="input" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} style={{ width: 62 }} /></Field><Field label="Alt"><input className="input" value={alt} onChange={(e) => setAlt(e.target.value.toUpperCase())} style={{ width: 62 }} /></Field><Field label="Assembly"><select className="select" value={asm} onChange={(e) => setAsm(e.target.value as typeof asm)}><option>GRCh38</option><option>GRCh37</option></select></Field></div>
          <div className="row"><button className="btn primary" disabled={busy} onClick={varGo}>Look up variant</button>{kept.length > 0 && <select className="select" style={{ width: 200 }} value="" onChange={(e) => { const v = kept[+e.target.value]; if (v) { setChr(v.chrom.replace(/^chr/i, '')); setPos(v.pos); setRef(v.ref); setAlt(v.alt); } }}><option value="">Fill from filtered list…</option>{kept.slice(0, 50).map((v, i) => <option key={i} value={i}>{v.chrom}:{v.pos} {v.ref}&gt;{v.alt}</option>)}</select>}</div>
          <div className="faint" style={{ fontSize: 11.5 }}>Defaults: BRAF p.V600E (GRCh38 chr7:140753336 A&gt;T).</div>
        </div></Card>
      </div>
      {busy && <Busy progress={0.5} note="Querying public databases…" />}{error && <Callout kind="err">{error}</Callout>}
      {card && <Card title={`${card.symbol} · ${card.name}`} sub="Open Targets (CC0) + CIViC (CC0)"><div className="stack" style={{ gap: 10 }}>{card.summary && <p className="dim">{card.summary}</p>}{card.civicDescription && <p className="dim" style={{ fontSize: 13 }}><b style={{ color: 'var(--text)' }}>CIViC:</b> {card.civicDescription.slice(0, 700)}{card.civicDescription.length > 700 ? '…' : ''}</p>}<DataTable rows={card.diseases} rowKey={(d) => d.id} cols={[{ key: 'name', label: 'Associated disease (Open Targets score)' }, { key: 'score', label: 'Score', num: true, sort: (d) => d.score, render: (d) => fmt(d.score, 3) }]} /></div></Card>}
      {civic && <Card title={`CIViC evidence · ${profile}`} sub={`${civic.total} accepted items, showing ${civic.rows.length}`} pad={false}><DataTable rows={civic.rows} rowKey={(r) => r.id} cols={[{ key: 'id', label: 'ID' }, { key: 'type', label: 'Type' }, { key: 'level', label: 'Level', sort: (r) => r.level }, { key: 'disease', label: 'Disease' }, { key: 'therapies', label: 'Therapy', render: (r) => r.therapies.join(', ') || '–' }, { key: 'significance', label: 'Significance' }, { key: 'description', label: 'Summary', render: (r) => <span className="dim" title={r.description}>{r.description.slice(0, 110)}…</span> }]} /></Card>}
      {cv && <Card title="ClinVar" sub={`${cv.length} record(s) at ${chr}:${pos}`} pad={false}>{cv.length ? <DataTable rows={cv} rowKey={(r) => r.uid} cols={[{ key: 'title', label: 'Variant' }, { key: 'significance', label: 'Classification', render: (r) => <span className={`badge ${/pathogenic/i.test(r.significance) && !/benign/i.test(r.significance) ? 'building' : /benign/i.test(r.significance) ? 'live' : 'planned'}`}>{r.significance}</span> }, { key: 'review', label: 'Review status' }, { key: 'conditions', label: 'Conditions', render: (r) => r.conditions.slice(0, 3).join('; ') }]} /> : <div className="faint" style={{ padding: 16 }}>No ClinVar record at this position.</div>}</Card>}
      {af && <Card title="Population frequency" sub="gnomAD via MyVariant.info (CC0)">{af === 'none' ? <div className="faint">Not found (or not a single-nucleotide variant).</div> : <div className="cols-4"><Stat label="gnomAD genome AF" value={af.genome === null ? '–' : af.genome.toExponential(2)} /><Stat label="gnomAD exome AF" value={af.exome === null ? '–' : af.exome.toExponential(2)} /><Stat label="dbSNP" value={af.rsid ?? '–'} /></div>}</Card>}
    </>
  );
}
