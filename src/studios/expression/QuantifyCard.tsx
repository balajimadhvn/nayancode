import { useState } from 'react';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import type { PseudoKernels, QuantResult } from './pseudoalign.worker';

const remote = createRemote<PseudoKernels>(() => new Worker(new URL('./pseudoalign.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = { id: 'expression.pseudoalign', name: 'Pseudoalignment and quantification', version: '0.1.0', engine: 'TypeScript worker (k-mer index, equivalence classes, EM)', citations: ['bray2016'], describe: (p) => `Reads were pseudoaligned to a ${p.k}-mer index of ${p.transcripts} transcripts and transcript abundances were estimated by expectation–maximisation over equivalence classes with an assumed mean fragment length of ${p.frag} nt (kallisto-style)` };
interface Done { name: string; r: QuantResult }

/** FASTQ → transcript counts for small transcriptomes, with a hand-off of the count matrix to the differential-expression workflow. */
export default function QuantifyCard({ onUse }: { onUse(counts: string, sheet: string | null, note: string): void }) {
  const [fasta, setFasta] = useState<{ name: string; text: string } | null>(null), [files, setFiles] = useState<File[]>([]), [mates, setMates] = useState<File[]>([]);
  const [k, setK] = useState('25'), [frag, setFrag] = useState('200'), [maxReads, setMaxReads] = useState('2000000');
  const [done, setDone] = useState<Done[]>([]), [info, setInfo] = useState<{ transcripts: number; kmers: number; ecs: number } | null>(null), [sheet, setSheet] = useState<string | null>(null), [up, setUp] = useState<string[]>([]);
  const { run, busy, progress, note, error } = useRunner();
  const clean = (s: string) => s.replace(/\.(fastq|fq|fasta|fa)(\.gz)?$/i, '').replace(/_(R?1|001)$/i, '');
  const go = (demoData?: Awaited<ReturnType<typeof remote.demo>>) => void run({ label: 'Pseudoalignment', tool: TOOL, params: { k: Number(k), transcripts: 0, frag: Number(frag) }, inputs: [{ name: fasta?.name ?? 'demo transcriptome', data: (demoData?.fasta ?? fasta?.text ?? '').slice(0, 100000) }], run: async (h) => {
    const text = demoData?.fasta ?? fasta?.text; if (!text) throw new Error('Load a transcriptome FASTA first.');
    const inf = await remote.index({ fasta: { text }, k: Number(k) || 25 }, { signal: h.signal }); setInfo(inf);
    const out: Done[] = [], src = demoData ? demoData.samples.map((s) => ({ name: s.name, text: s.fastq })) : files.map((f) => ({ name: clean(f.name), file: f }));
    for (let i = 0; i < src.length; i++) {
      const s = src[i] as { name: string; text?: string; file?: File };
      const r = await remote.quant({ reads: s.text !== undefined ? { text: s.text } : { file: s.file }, mate2: !demoData && mates[i] ? { file: mates[i] } : undefined, fragLen: Number(frag) || 200, maxReads: Number(maxReads) || 2_000_000 }, { signal: h.signal, onProgress: (p, n) => h.onProgress((i + p) / src.length, `${s.name}: ${n ?? ''}`) });
      out.push({ name: s.name, r }); h.onProgress((i + 1) / src.length, s.name);
    }
    return { out, inf };
  }, summary: (r) => `Reads from ${r.out.length} sample${r.out.length > 1 ? 's' : ''} were pseudoaligned to a ${k}-mer index of ${r.inf.transcripts} transcripts and abundances were estimated by EM with a mean fragment length of ${frag} nt; ${r.out.map((d) => `${d.name} ${(100 * d.r.mapped / d.r.reads).toFixed(1)} %`).join(', ')} of reads were assigned` }).then((r) => { if (r) setDone(r.out); });
  const demo = async () => { const d = await remote.demo({ seed: 5 }); setFasta({ name: 'synthetic_transcriptome.fa', text: d.fasta }); setSheet(d.sheet); setUp(d.up); setFiles([]); go(d); };
  const matrix = () => { if (!done.length) return ''; const ids = done[0].r.quant.map((q) => q.id); return ['gene,' + done.map((d) => d.name).join(','), ...ids.map((id, i) => `${id},${done.map((d) => Math.round(d.r.quant[i].estCounts)).join(',')}`)].join('\n'); };
  const tpm = () => { const ids = done[0].r.quant.map((q) => q.id); return ['transcript,' + done.map((d) => d.name).join(','), ...ids.map((id, i) => `${id},${done.map((d) => d.r.quant[i].tpm.toFixed(3)).join(',')}`)].join('\n'); };
  return (
    <Card title="Optional: quantify reads (FASTQ → counts)" sub="small transcriptomes: bacteria, yeast, viruses">
      <div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t, n) => { setFasta({ name: n, text: t }); setDone([]); }} label={fasta ? `Transcriptome: ${fasta.name}` : 'Transcript sequences (cDNA FASTA)'} />
        <label className="dropzone"><input type="file" multiple hidden accept=".fastq,.fq,.gz,.fa,.fasta" onChange={(e) => { setFiles([...(e.target.files ?? [])]); setDone([]); }} />{files.length ? `${files.length} FASTQ file${files.length > 1 ? 's' : ''} (one per sample)` : 'Choose FASTQ files, one per sample (.gz accepted)'}</label>
        <label className="dropzone"><input type="file" multiple hidden accept=".fastq,.fq,.gz" onChange={(e) => setMates([...(e.target.files ?? [])])} />{mates.length ? `${mates.length} mate-2 files` : 'Optional: mate-2 files for paired-end (same order)'}</label>
        <div className="cols-3" style={{ gap: 8 }}><Field label="k-mer (11–25)"><input className="input" value={k} onChange={(e) => setK(e.target.value)} /></Field><Field label="Mean fragment (nt)"><input className="input" value={frag} onChange={(e) => setFrag(e.target.value)} /></Field><Field label="Max reads / sample"><input className="input" value={maxReads} onChange={(e) => setMaxReads(e.target.value)} /></Field></div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><button className="btn primary" disabled={busy || !fasta || !files.length} onClick={() => go()}>Quantify</button><button className="btn" disabled={busy} onClick={() => void demo()}>Demo: 6 synthetic samples</button></div>
        {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
        {info && <div className="faint" style={{ fontSize: 12 }}>Index: {info.transcripts.toLocaleString()} transcripts, {info.kmers.toLocaleString()} distinct {k}-mers, {info.ecs.toLocaleString()} equivalence classes.</div>}
        {done.length > 0 && <>
          <DataTable rowKey={(r) => r.name} rows={done} cols={[{ key: 'n', label: 'Sample', render: (r) => r.name }, { key: 'reads', label: 'Reads', num: true, render: (r) => r.r.reads.toLocaleString() }, { key: 'm', label: 'Pseudoaligned', num: true, render: (r) => `${fmt((100 * r.r.mapped) / r.r.reads, 1)} %` }, { key: 'it', label: 'EM iterations', num: true, render: (r) => r.r.iterations }]} />
          {done.some((d) => d.r.mapped / d.r.reads < 0.5) && <Callout kind="warn">Fewer than half of the reads pseudoalign. Check that the FASTA matches the organism and contains transcripts (not the genome), and that reads are not trimmed too short for k = {k}.</Callout>}
          {up.length > 0 && <div className="faint" style={{ fontSize: 12 }}>Synthetic design: {up.join(', ')} are 4-fold up in the treated samples.</div>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><button className="btn primary sm" onClick={() => onUse(matrix(), sheet, `Counts loaded from pseudoalignment of ${done.length} samples (${done[0].r.quant.length} transcripts). Define the sample sheet below if you did not use the demo.`)}>Use as count matrix below</button><button className="btn sm" onClick={() => downloadText('est_counts.csv', matrix(), 'text/csv')}>Download counts</button><button className="btn sm" onClick={() => downloadText('tpm.csv', tpm(), 'text/csv')}>Download TPM</button></div>
          <Stat label="Total transcripts quantified" value={done[0].r.quant.length.toLocaleString()} />
        </>}
      </div>
    </Card>
  );
}
