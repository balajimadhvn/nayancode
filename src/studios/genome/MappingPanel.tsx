import { brandedName } from '@/core/filename';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHandoff } from '@/core/handoff';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { cssVar } from '@/viz/charts';
import { MultiLine } from '@/viz/more';
import { DEFAULT_CALLER, simulateReads, simulateReference, type CallerOpts, type Coverage, type Flagstat, type PlantedSnv, type SnvCall } from './mapping';
import { runTool } from './wasmTools';
import { mapAndCall } from './pipeline';
import { parseFasta } from '../sequence/kernels';

const TOOL: ToolInfo = {
  id: 'genome.mapping', name: 'Read mapping and variant calling', version: '0.3.0', engine: 'minimap2 2.22, samtools 1.17 and bcftools 1.10 (WebAssembly, MIT) + TypeScript SNV caller',
  citations: ['li2018', 'danecek2021'],
  describe: (p) => `Reads were aligned to the reference with minimap2 (preset ${p.preset}); alignments were coordinate-sorted and indexed with samtools; coverage was computed with samtools depth; ${p.caller === 'bcftools' ? `SNVs and indels were called with bcftools mpileup (base quality ≥ ${p.minBaseQ}, mapping quality ≥ 20) and the bcftools multiallelic caller (ploidy ${p.ploidy}, variant sites only)` : `single-nucleotide variants were called from the samtools mpileup (minimum depth ${p.minDepth}, ≥ ${p.minAlt} alternate reads, allele fraction ≥ ${p.minAf}, base quality ≥ ${p.minBaseQ})`}`,
};
export interface Mapped { refName: string; refText: string; bam: Uint8Array; bai: Uint8Array; vcf: string; calls: SnvCall[]; consensus: string | null }
const PRESETS = [['sr', 'Illumina short reads'], ['map-ont', 'Oxford Nanopore'], ['map-hifi', 'PacBio HiFi'], ['map-pb', 'PacBio CLR'], ['asm5', 'Assembly vs close reference']] as const;
const enc = (s: string) => new TextEncoder().encode(s);

export function MappingPanel({ onMapped, onBrowse }: { onMapped(m: Mapped): void; onBrowse(): void }) {
  const { run, busy, progress, note, error, cancel } = useRunner(); const nav = useNavigate(), setHandoff = useHandoff((s) => s.setVcf);
  const [refText, setRefText] = useState(''), [reads, setReads] = useState<{ data: Uint8Array | string; name: string; size: number } | null>(null), [preset, setPreset] = useState<string>('sr'), [opt, setOpt] = useState<CallerOpts>(DEFAULT_CALLER), [caller, setCaller] = useState<'bcftools' | 'builtin'>('bcftools'), [ploidy, setPloidy] = useState<1 | 2>(2), [truth, setTruth] = useState<PlantedSnv[] | null>(null);
  const [res, setRes] = useState<{ flag: Flagstat; cov: Coverage[]; calls: SnvCall[]; mapped: Mapped; log: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const contigs = refText ? parseFasta(refText) : [];
  const demo = () => {
    const ref = simulateReference(20000, 3), snvs: PlantedSnv[] = [1500, 4200, 8800, 12100, 17000].map((p, i) => ({ pos: p, ref: ref[p], alt: ({ A: 'G', G: 'A', C: 'T', T: 'C' } as Record<string, string>)[ref[p]], af: i === 4 ? 0.4 : 1 }));
    // Indels: a 3 bp and a 1 bp deletion, and a 2 bp insertion (VCF style, sharing the first base).
    snvs.push({ pos: 6000, ref: ref.slice(6000, 6004), alt: ref[6000], af: 1 }, { pos: 10500, ref: ref[10500], alt: ref[10500] + (ref[10500] === 'G' ? 'TT' : 'GG'), af: 1 }, { pos: 15000, ref: ref.slice(15000, 15002), alt: ref[15000], af: 1 });
    const sim = simulateReads(ref, { n: 3800, len: 150, err: 0.004, snvs, seed: 5 }); setRefText(`>demo_ref synthetic 20 kb reference\n${ref.replace(/(.{70})/g, '$1\n')}\n`); setReads({ data: sim.fastq, name: 'simulated_reads.fastq (synthetic)', size: sim.fastq.length }); setTruth(snvs); setRes(null); };
  const go = () => void run({ label: `Mapping · ${reads?.name}`, tool: TOOL, params: { preset, caller, ploidy, ...opt }, inputs: [{ name: 'reference', data: refText.slice(0, 200000) }, { name: reads!.name, data: typeof reads!.data === 'string' ? reads!.data.slice(0, 200000) : `${reads!.name}:${reads!.size}` }], run: async (h) => {
    const p = await mapAndCall(runTool, { refText, contigs: contigs.map((c) => ({ id: c.id, length: c.seq.length })), reads: typeof reads!.data === 'string' ? enc(reads!.data) : reads!.data, preset, caller, ploidy, opt }, h);
    return { flag: p.flag, cov: p.cov, calls: p.calls, log: p.log, mapped: { refName: contigs[0]?.id ?? 'ref', refText, bam: p.bam, bai: p.bai, vcf: p.vcf, calls: p.calls, consensus: p.consensus } };
  } }).then((r) => { if (r) { setRes(r); onMapped(r.mapped); } });
  useEffect(() => setRes(null), [refText, reads]);
    // Indels may be left-aligned by the caller, so they match by length change within 10 bp; SNVs match exactly.
  const same = (p: PlantedSnv, c: SnvCall) => (p.ref.length === 1 && p.alt.length === 1 ? c.pos - 1 === p.pos && c.alt === p.alt : Math.abs(c.pos - 1 - p.pos) <= 10 && c.alt.length - c.ref.length === p.alt.length - p.ref.length);
  const planted = truth, tp = planted && res ? planted.filter((p) => res.calls.some((c) => same(p, c))).length : 0, fp = planted && res ? res.calls.filter((c) => !planted.some((p) => same(p, c))).length : 0;
  return (<>
    <div className="split"><div className="stack">
      <Card title="Reference & reads" sub="minimap2 + samtools, WebAssembly">
        <div className="stack" style={{ gap: 10 }}>
          <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t) => { setRefText(t); setTruth(null); }} label={refText ? `Reference: ${contigs.length} contig(s), ${contigs.reduce((a, c) => a + c.seq.length, 0).toLocaleString()} bp` : 'Reference FASTA (≤ 100 Mb)'} />
          <label className="dropzone" onClick={() => fileInput.current?.click()}><input ref={fileInput} type="file" hidden accept=".fastq,.fq" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 300 * 1024 * 1024) { alert('Reads file is larger than 300 MB, the browser memory limit. Map it with minimap2 or nf-core on your computer, then open the BAM here.'); return; } setReads({ data: new Uint8Array(await f.arrayBuffer()), name: f.name, size: f.size }); setTruth(null); }} />{reads ? `Reads: ${reads.name} (${(reads.size / 1048576).toFixed(1)} MB)` : 'Reads FASTQ (uncompressed, ≤ 300 MB)'}<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Processed in your browser. Never uploaded.</div></label>
          <button className="btn" onClick={demo} disabled={busy}>Demo: simulated 150 bp reads on a 20 kb genome</button>
          <Field label="minimap2 preset"><select className="select" value={preset} onChange={(e) => setPreset(e.target.value)}>{PRESETS.map(([id, n]) => <option key={id} value={id}>{id} · {n}</option>)}</select></Field>
        </div>
      </Card>
      <Card title="Variant calling">
        <div className="cols-2" style={{ gap: 8, marginBottom: 8 }}>
          <Field label="Caller"><select className="select" value={caller} onChange={(e) => setCaller(e.target.value as typeof caller)}><option value="bcftools">bcftools call · SNVs + indels</option><option value="builtin">Built-in · SNVs, low allele fractions</option></select></Field>
          {caller === 'bcftools' && <Field label="Ploidy"><select className="select" value={ploidy} onChange={(e) => setPloidy(+e.target.value as 1 | 2)}><option value={2}>Diploid</option><option value={1}>Haploid (bacteria, viruses)</option></select></Field>}
        </div>
        <div className="cols-2" style={{ gap: 8 }}>{(caller === 'bcftools' ? [['minBaseQ', 'Min base quality']] as const : [['minDepth', 'Min depth'], ['minAlt', 'Min alt reads'], ['minAf', 'Min allele fraction'], ['minBaseQ', 'Min base quality']] as const).map(([k, l]) => <Field key={k} label={l}><input className="input" type="number" step={k === 'minAf' ? 0.01 : 1} value={opt[k]} onChange={(e) => setOpt({ ...opt, [k]: +e.target.value })} /></Field>)}</div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={!refText || !reads || busy} onClick={go}>Map & call</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
        {busy && <div style={{ marginTop: 10 }}><Busy progress={progress} note={note} /></div>}{error && <div style={{ marginTop: 10 }}><Callout kind="err">{error}</Callout></div>}
      </Card>
      <Callout>Limits: reference ≤ ~100 Mb and reads ≤ 300 MB per run (WebAssembly memory), so bacterial, viral, organellar and targeted data fit; whole human genomes do not. bcftools calls SNVs and short indels; structural variants are not called. Engines are the real minimap2, samtools and bcftools builds, vendored under their MIT licences.</Callout>
    </div>
    <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Provide a reference and reads (or run the demo), then Map & call.</div></Card> : <>
      <div className="cols-4"><Stat label="Reads" value={res.flag.total.toLocaleString()} /><Stat label="Mapped" value={`${fmt(res.flag.mappedPct, 1)}%`} /><Stat label="Mean depth" value={`${fmt(res.cov.reduce((a, c) => a + c.mean * c.length, 0) / res.cov.reduce((a, c) => a + c.length, 0), 1)}×`} /><Stat label="Variants called" value={res.calls.length} /></div>
      {planted && <Callout><b style={{ color: 'var(--text)' }}>Validation against planted truth:</b>&nbsp;{tp}/{planted.length} planted variants recovered, {fp} false positive{fp === 1 ? '' : 's'}.</Callout>}
      <Card title="Coverage" sub="mean depth along each contig">{res.cov.slice(0, 1).map((c) => <MultiLine key={c.contig} xs={c.bins.map((_, i) => Math.round(((i + 0.5) / c.bins.length) * c.length))} series={[{ name: c.contig, ys: c.bins, color: cssVar('--chart-a') }]} xLabel="Position (bp)" yLabel="Depth (×)" yMin={0} height={220} />)}<div className="cols-4" style={{ marginTop: 10 }}>{res.cov.slice(0, 4).map((c) => <Stat key={c.contig} label={`${c.contig} ≥10× / ≥30×`} value={`${fmt(c.pct10x, 0)}% / ${fmt(c.pct30x, 0)}%`} />)}</div></Card>
      <Card title="Variants" sub={caller === 'bcftools' ? 'bcftools call, SNVs + indels' : 'samtools mpileup, SNVs'} pad={false} actions={<><button className="btn sm" onClick={() => { setHandoff({ text: res.mapped.vcf, label: 'mapped_variants.vcf' }); nav('/variants'); }}>Open in Variant Studio</button><button className="btn sm" onClick={() => downloadText('variants.vcf', res.mapped.vcf)}>VCF</button></>}>
        <DataTable rows={res.calls} rowKey={(c, i) => `${c.chrom}${c.pos}${c.alt}${i}`} cols={[{ key: 'chrom', label: 'Contig' }, { key: 'pos', label: 'Pos', num: true, sort: (c) => c.pos }, { key: 'ra', label: 'Ref>Alt', render: (c) => `${c.ref}>${c.alt}` }, { key: 'ty', label: 'Type', render: (c) => (c.ref.length === c.alt.length ? 'SNV' : c.alt.length > c.ref.length ? 'insertion' : 'deletion') }, { key: 'dp', label: 'Depth', num: true, sort: (c) => c.depth }, { key: 'ac', label: 'Alt reads', num: true, sort: (c) => c.altCount }, { key: 'af', label: 'AF', num: true, sort: (c) => c.af, render: (c) => fmt(c.af, 3) }, { key: 'sb', label: 'Fwd/Rev', num: true, render: (c) => `${c.fwd}/${c.rev}` }, { key: 'q', label: 'QUAL', num: true, sort: (c) => c.qual, render: (c) => fmt(c.qual, 0) }, { key: 'f', label: 'Filter', render: (c) => (c.flags.length ? <span className="badge building">{c.flags.join(', ')}</span> : <span className="badge live">PASS</span>) }]} />
      </Card>
      <Card title="Outputs"><div className="row"><button className="btn" onClick={onBrowse}>Open in genome browser</button><button className="btn sm" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([res.mapped.bam.slice().buffer as ArrayBuffer])); a.download = brandedName('sorted.bam'); a.click(); }}>BAM</button><button className="btn sm" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([res.mapped.bai.slice().buffer as ArrayBuffer])); a.download = brandedName('sorted.bam.bai'); a.click(); }}>BAI</button>{res.mapped.consensus && <button className="btn sm" onClick={() => downloadText('consensus.fasta', res.mapped.consensus!)}>Consensus FASTA</button>}<button className="btn sm" onClick={() => downloadText('coverage.csv', toCsv(res.cov.map(({ bins, ...c }) => { void bins; return c; })), 'text/csv')}>Coverage CSV</button></div></Card>
    </>}</div></div>
  </>);
}

/** igv.js (MIT) loaded on demand. Local files become blob URLs; nothing leaves the browser. */
export function GenomeBrowser({ mapped }: { mapped: Mapped | null }) {
  const host = useRef<HTMLDivElement>(null), [err, setErr] = useState(''), [extra, setExtra] = useState<{ name: string; text: string; ext: string }[]>([]), [ready, setReady] = useState(false);
  useEffect(() => {
    if (!mapped || !host.current) return; type IgvApi = { createBrowser(el: HTMLElement, c: unknown): Promise<unknown>; removeBrowser(b: unknown): void }; let browser: unknown, igvMod = null as IgvApi | null, cancelled = false, el: HTMLDivElement | null = null; const urls: string[] = [];
    const blob = (d: BlobPart, type = 'application/octet-stream') => { const u = URL.createObjectURL(new Blob([d], { type })); urls.push(u); return u; };
    (async () => {
      try { igvMod = ((await import('igv')) as unknown as { default: IgvApi }).default; if (cancelled || !igvMod || !host.current) return; el = document.createElement('div'); host.current.appendChild(el);
        const first = parseFasta(mapped.refText)[0], tracks: unknown[] = [{ name: 'Alignments', type: 'alignment', format: 'bam', url: blob(mapped.bam.slice().buffer as ArrayBuffer), indexURL: blob(mapped.bai.slice().buffer as ArrayBuffer), height: 280 }, ...(mapped.calls.length ? [{ name: 'Variants', type: 'variant', format: 'vcf', url: blob(mapped.vcf, 'text/plain'), indexed: false }] : [])];
        for (const t of extra) tracks.push({ name: t.name, type: 'annotation', format: t.ext, url: blob(t.text, 'text/plain'), indexed: false });
        browser = await igvMod.createBrowser(el, { reference: { id: 'local', name: first.id, fastaURL: blob(mapped.refText, 'text/plain'), indexed: false }, locus: `${first.id}:1-${Math.min(first.seq.length, 400)}`, tracks }); if (cancelled) { try { igvMod.removeBrowser(browser); } catch { /* ignore */ } return; } setReady(true);
      } catch (e) { setErr((e as Error).message); }
    })();
    return () => { cancelled = true; try { if (browser && igvMod) igvMod.removeBrowser(browser); } catch { /* already gone */ } el?.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [mapped, extra]);
  if (!mapped) return <Callout>Map reads first (Mapping tab). The browser then shows your alignments, called variants and any annotation tracks (BED / GFF) you add, all local.</Callout>;
  return (<>
    <Card title="Genome browser" sub="igv.js (MIT), local blobs only" actions={<span className="faint" style={{ fontSize: 12 }}>{ready ? 'type a locus or gene name; zoom with the +/− controls' : 'loading igv.js…'}</span>}>
      {err && <Callout kind="err">{err}</Callout>}
      <div ref={host} style={{ background: '#fff', borderRadius: 10, padding: 6, minHeight: 360, color: '#111' }} />
    </Card>
    <Card title="Add an annotation track"><FileDrop accept=".bed,.gff,.gff3,.gtf" onText={(t, n) => setExtra((e) => [...e, { name: n, text: t, ext: /\.gtf$/i.test(n) ? 'gtf' : /\.gff3?$/i.test(n) ? 'gff3' : 'bed' }])} label="Drop BED / GFF3 / GTF" />{extra.length > 0 && <div className="row" style={{ marginTop: 8 }}>{extra.map((x, i) => <span key={i} className="badge live">{x.name}</span>)}</div>}</Card>
  </>);
}
