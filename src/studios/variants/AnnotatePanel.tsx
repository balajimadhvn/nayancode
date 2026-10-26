import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { useManifest } from '@/studios/genome/GenomePicker';
import { loadBundledText } from '@/studios/genome/genomeData';
import { parseGff } from '@/studios/counts/gff';
import type { Variant } from './kernels';
import { CONSEQUENCE_ORDER, annotateVariants, annotatedVcf, vcfRecordCount, type AnnRow, type Consequence, type Impact } from './annotate';

const TOOL: ToolInfo = {
  id: 'variants.annotate', name: 'Local consequence annotation', version: '0.1.0', engine: 'TypeScript kernels',
  citations: ['mclaren2016', 'cingolani2012'],
  describe: (p) => `Consequences and HGVS were assigned locally to ${p.rows} allele/gene pairs from ${p.records} VCF records against ${p.genes} gene models (genetic code ${p.code}); variants on contigs absent from the reference were skipped`,
};

const COLOR: Record<Consequence, string> = {
  splice_donor: '#b91c1c', splice_acceptor: '#dc2626', stop_gained: '#ef4444', frameshift_variant: '#f97316',
  start_lost: '#e11d48', stop_lost: '#db2777', inframe_deletion: '#d97706', inframe_insertion: '#ca8a04',
  missense_variant: '#2563eb', splice_region_variant: '#7c3aed', synonymous_variant: '#0891b2',
  '5_prime_UTR_variant': '#64748b', '3_prime_UTR_variant': '#64748b', intron_variant: '#94a3b8',
  upstream_gene_variant: '#cbd5e1', downstream_gene_variant: '#cbd5e1', intergenic_variant: '#e2e8f0',
};
const badge = (impact: Impact) => (impact === 'HIGH' ? 'building' : impact === 'MODERATE' ? 'live' : impact === 'LOW' ? 'planned' : '');

async function readSource(src: { file?: File; text?: string }): Promise<string> {
  if (src.text !== undefined) return src.text;
  const f = src.file!;
  const head = new Uint8Array(await f.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const s = f.stream()
      .pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)
      .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>);
    const r = s.getReader(); let out = '';
    for (;;) { const { done, value } = await r.read(); if (done) break; out += value as unknown as string; }
    return out;
  }
  return f.text();
}
const size = (t: string) => (t.length >= 1e6 ? `${(t.length / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(t.length / 1e3))} kB`);

type Res = { rows: AnnRow[]; genes: number; records: number; ms: number };

const DEMO_REF = 'ACGTACGTAC' + 'ATGAAACCCG' + 'GTACGTACAG' + 'GGTTTTAAGC' + 'TTACGGCATGCATGCCATGC';
const DEMO_FASTA = `>chr1 demo contig\n${DEMO_REF}\n`;
const DEMO_GFF = [
  '##gff-version 3',
  'chr1\tdemo\tgene\t11\t40\t.\t+\t.\tID=g1;Name=DEMO1',
  'chr1\tdemo\tmRNA\t11\t40\t.\t+\t.\tID=t1;Parent=g1',
  'chr1\tdemo\texon\t11\t20\t.\t+\t.\tParent=t1',
  'chr1\tdemo\texon\t31\t40\t.\t+\t.\tParent=t1',
  'chr1\tdemo\tCDS\t11\t20\t.\t+\t0\tParent=t1',
  'chr1\tdemo\tCDS\t31\t40\t.\t+\t0\tParent=t1',
].join('\n');
const DEMO_VCF = ['##fileformat=VCFv4.2', '##source=Nayancode synthetic demo', '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
  'chr1\t5\t.\tA\tG\t.\tPASS\t.', 'chr1\t14\t.\tA\tC,G\t.\tPASS\t.', 'chr1\t16\t.\tA\tG\t.\tPASS\t.',
  'chr1\t19\t.\tC\tT\t.\tPASS\t.', 'chr1\t21\t.\tG\tC\t.\tPASS\t.', 'chr1\t23\t.\tC\tA\t.\tPASS\t.',
  'chr1\t30\t.\tG\tA\t.\tPASS\t.', 'chr1\t31\t.\tG\tA\t.\tPASS\t.'].join('\n');

export default function AnnotatePanel({ kept, src }: { kept: Variant[]; src: { file?: File; text?: string } | null }) {
  const { manifest } = useManifest();
  const { run, busy, progress, note, error } = useRunner();
  const [vcf, setVcf] = useState<{ name: string; text: string } | null>(null);
  const [gff, setGff] = useState<{ name: string; text: string } | null>(null);
  const [fasta, setFasta] = useState<{ name: string; text: string } | null>(null);
  const [code, setCode] = useState<'standard' | 'bacterial'>('standard');
  const [upstream, setUpstream] = useState(5000);
  const [onlyKept, setOnlyKept] = useState(true);
  const [impact, setImpact] = useState<'ALL' | Impact>('ALL');
  const [bundle, setBundle] = useState('ecoli-k12');
  const [reading, setReading] = useState(false);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');
  const [res, setRes] = useState<Res | null>(null);

  const useLoaded = () => {
    if (!src) return;
    setReading(true); setLocalErr('');
    readSource(src).then((t) => { setVcf({ name: src.file?.name ?? 'loaded VCF', text: t }); setOnlyKept(true); setRes(null); })
      .catch((e: Error) => setLocalErr(e.message)).finally(() => setReading(false));
  };
  const loadBundle = () => {
    setBundleBusy(true); setLocalErr('');
    Promise.all([loadBundledText(bundle, 'fasta'), loadBundledText(bundle, 'gff')])
      .then(([fa, gf]) => { setFasta({ name: `${bundle}.fna`, text: fa }); setGff({ name: `${bundle}.gff3`, text: gf }); setRes(null); })
      .catch((e: Error) => setLocalErr(e.message)).finally(() => setBundleBusy(false));
  };
  const go = () => {
    if (!vcf || !gff || !fasta) return;
    const keep = new Set(kept.map((v) => `${v.chrom}:${v.pos}:${v.ref}`));
    void run({
      label: 'Local consequence annotation', tool: TOOL,
      params: { rows: '…', records: '…', genes: '…', code },
      inputs: [{ name: vcf.name, data: vcf.text.slice(0, 4000) }, { name: gff.name, data: gff.text.slice(0, 4000) }, { name: fasta.name, data: fasta.text.slice(0, 4000) }],
      run: async () => {
        const t0 = performance.now(), model = parseGff(gff.text);
        const rows = annotateVariants(vcf.text, model.genes, fasta.text, { upstream, code });
        const selected = onlyKept ? rows.filter((r) => keep.has(`${r.chrom}:${r.pos}:${r.ref}`)) : rows;
        return { rows: selected, genes: model.genes.length, records: vcfRecordCount(vcf.text), ms: performance.now() - t0 };
      },
      summary: (r) => `Consequences and HGVS were assigned locally to ${r.rows.length} allele/gene pairs from ${r.records} VCF records against ${r.genes} gene models (genetic code ${code === 'bacterial' ? '11, bacterial' : '1, standard'}); variants on contigs absent from the reference were skipped`,
    }).then((r) => r && setRes(r));
  };

  const counts = useMemo(() => {
    if (!res) return [];
    return CONSEQUENCE_ORDER.map((c) => ({ c, n: res.rows.filter((r) => r.consequence === c).length })).filter((x) => x.n > 0);
  }, [res]);
  const shown = useMemo(() => (res ? res.rows.filter((r) => impact === 'ALL' || r.impact === impact) : []), [res, impact]);
  const total = counts.reduce((a, b) => a + b.n, 0) || 1;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Callout kind="warn">Rule-based consequence calling for single transcripts per gene model; not a replacement for VEP or SnpEff for clinical reporting. Complex variants, structural variants and non-coding RNA are not interpreted.</Callout>
      <div className="cols-2">
        <Card title="1 · Variants"><div className="stack" style={{ gap: 10 }}>
          {src && <button className="btn" disabled={reading} onClick={useLoaded}>{reading ? 'Reading…' : `Use the loaded VCF (${kept.length.toLocaleString()} after filters)`}</button>}
          <label className="dropzone"><input type="file" hidden accept=".vcf,.gz" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; setReading(true); setLocalErr(''); readSource({ file: f }).then((t) => { setVcf({ name: f.name, text: t }); setRes(null); }).catch((x: Error) => setLocalErr(x.message)).finally(() => setReading(false)); }} />Choose a VCF or VCF.gz<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Read locally. Never uploaded.</div></label>
          <button className="btn" onClick={() => { setVcf({ name: 'synthetic_consequences.vcf', text: DEMO_VCF }); setGff({ name: 'synthetic.gff3', text: DEMO_GFF }); setFasta({ name: 'synthetic.fa', text: DEMO_FASTA }); setOnlyKept(false); setRes(null); }}>Demo: synthetic two-exon gene</button>
          {vcf && <div className="faint" style={{ fontSize: 12 }}>{vcf.name} · {vcfRecordCount(vcf.text).toLocaleString()} records · {size(vcf.text)}</div>}
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={onlyKept} onChange={(e) => { setOnlyKept(e.target.checked); setRes(null); }} />Only annotate variants that pass the hard filters</label>
          <div className="faint" style={{ fontSize: 11.5 }}>At most 50,000 records are annotated in the browser; split larger VCFs.</div>
        </div></Card>
        <Card title="2 · Gene model and reference"><div className="stack" style={{ gap: 10 }}>
          <FileDrop accept=".gff,.gff3,.gtf,.txt" onText={(t, n) => { setGff({ name: n, text: t }); setRes(null); }} label={gff ? `GFF/GTF: ${gff.name} · ${size(gff.text)}` : 'GFF3 or GTF with exon and CDS rows'} />
          <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t, n) => { setFasta({ name: n, text: t }); setRes(null); }} label={fasta ? `Reference: ${fasta.name} · ${size(fasta.text)}` : 'Reference FASTA (same contig names as the VCF)'} />
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Bundled genome"><select className="select" value={bundle} onChange={(e) => setBundle(e.target.value)}>{manifest?.genomes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>) ?? <option value={bundle}>Loading manifest…</option>}</select></Field>
            <button className="btn" disabled={bundleBusy} onClick={loadBundle}>{bundleBusy ? 'Downloading…' : 'Load genome + GFF'}</button>
          </div>
          <div className="faint" style={{ fontSize: 11.5 }}>Bundled NCBI RefSeq genomes are public domain. A gene without CDS rows is treated as exonic, so coding consequences need CDS rows.</div>
        </div></Card>
      </div>
      <Card title="3 · Run" sub="standard table 1 or bacterial table 11">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Genetic code"><select className="select" value={code} onChange={(e) => { setCode(e.target.value as typeof code); setRes(null); }}><option value="standard">Standard (table 1)</option><option value="bacterial">Bacterial (table 11)</option></select></Field>
          <Field label="Upstream window (bp)"><input className="input" type="number" min={0} max={100000} value={upstream} onChange={(e) => { setUpstream(Math.max(0, Math.min(100000, Math.round(Number(e.target.value) || 0)))); setRes(null); }} style={{ width: 110 }} /></Field>
          <button className="btn primary" disabled={!vcf || !gff || !fasta || busy} onClick={go}>Annotate consequences</button>
        </div>
        {busy && <div style={{ marginTop: 10 }}><Busy progress={progress} note={note} /></div>}
        {(error || localErr) && <div style={{ marginTop: 10 }}><Callout kind="err">{error ?? localErr}</Callout></div>}
        <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>Runs in your browser, on your own processor. Your files are not uploaded.</div>
      </Card>
      {res && (
        <>
          <div className="cols-4"><Stat label="VCF records" value={res.records.toLocaleString()} /><Stat label="Consequence rows" value={res.rows.length.toLocaleString()} /><Stat label="Gene models" value={res.genes.toLocaleString()} /><Stat label="Run time" value={`${fmt(res.ms, 0)} ms`} /></div>
          <Card title="Summary" sub={`${shown.length.toLocaleString()} rows shown · ${total.toLocaleString()} assigned`}>
            <div className="stack" style={{ gap: 8 }}>
              <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-2)' }}>{counts.map(({ c, n }) => <div key={c} title={`${c}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: COLOR[c] }} />)}</div>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', fontSize: 11.5 }}>{counts.map(({ c, n }) => <span key={c} className="row" style={{ gap: 4 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: COLOR[c], display: 'inline-block' }} />{c} <b>{n}</b></span>)}</div>
            </div>
          </Card>
          <Card title="Consequences" pad={false} actions={<><button className="btn sm" onClick={() => downloadText('variant_consequences.csv', toCsv(shown), 'text/csv')}>Export CSV</button><button className="btn sm" onClick={() => downloadText('annotated_variants.vcf', annotatedVcf(vcf!.text, res.rows))}>Annotated VCF</button></>}>
            <div style={{ padding: '0 14px 10px' }}><Field label="Impact filter"><select className="select" value={impact} onChange={(e) => setImpact(e.target.value as typeof impact)} style={{ width: 170 }}><option value="ALL">All impacts</option><option value="HIGH">HIGH</option><option value="MODERATE">MODERATE</option><option value="LOW">LOW</option><option value="MODIFIER">MODIFIER</option></select></Field></div>
            {shown.length ? <DataTable rows={shown} rowKey={(r, i) => `${r.chrom}:${r.pos}:${r.ref}:${r.alt}:${r.gene}:${i}`} limit={400} cols={[
              { key: 'v', label: 'Variant', render: (r) => <code>{r.chrom}:{r.pos.toLocaleString()} {r.ref}&gt;{r.alt}</code> },
              { key: 'gene', label: 'Gene', sort: (r) => r.gene || '~' },
              { key: 'consequence', label: 'Consequence', sort: (r) => r.consequence, render: (r) => <span style={{ color: COLOR[r.consequence], fontWeight: 600 }}>{r.consequence}</span> },
              { key: 'hgvsc', label: 'HGVS c.', render: (r) => <code>{r.hgvsc || '–'}</code> },
              { key: 'hgvsp', label: 'HGVS p.', render: (r) => <code>{r.hgvsp || '–'}</code> },
              { key: 'impact', label: 'Impact', sort: (r) => r.impact, render: (r) => <span className={`badge ${badge(r.impact)}`}>{r.impact}</span> },
            ]} /> : <div className="faint" style={{ padding: 16 }}>No rows for this impact filter.</div>}
          </Card>
        </>
      )}
    </div>
  );
}
