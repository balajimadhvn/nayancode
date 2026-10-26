import { useEffect, useMemo, useRef, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, Field, FileDrop, Stat, downloadText, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { parseFasta } from '../sequence/kernels';
import { parseFlagstat } from '../genome/mapping';
import { loadBundledText } from '../genome/genomeData';
import { useManifest } from '../genome/GenomePicker';
import { runTool } from '../genome/wasmTools';
import type { AlignmentHand } from './CountsStudio';

const PRESETS = [['sr', 'Illumina short reads'], ['map-ont', 'Oxford Nanopore'], ['map-hifi', 'PacBio HiFi'], ['map-pb', 'PacBio CLR'], ['splice', 'RNA-seq spliced (minimap2 -ax splice)']] as const;
const TOOL: ToolInfo = {
  id: 'counts.align', name: 'Read alignment', version: '0.1.0', engine: 'minimap2 2.22 and samtools 1.17 (WebAssembly, MIT)',
  citations: ['li2018', 'danecek2021'],
  describe: (p) => `Reads were aligned to the reference with minimap2 (preset ${p.preset}); alignments were coordinate-sorted and indexed with samtools (${p.mode === 'align' ? 'FASTQ input' : 'existing SAM/BAM input'}).`,
};
const dec = new TextDecoder();
const bamByName = (name: string) => /\.bam$/i.test(name);
const firstSq = (sam: string) => {
  const m = /^@SQ\t[^\n]*SN:([^\t]+)[^\n]*LN:(\d+)/m.exec(sam);
  return m ? { name: m[1], length: Number(m[2]) } : null;
};

export default function AlignTab({ alignment, setAlignment, onUse }: { alignment: AlignmentHand | null; setAlignment(a: AlignmentHand | null): void; onUse(t: 'genes' | 'peaks'): void }) {
  const { run, busy, progress, note, error, cancel } = useRunner();
  const { manifest } = useManifest();
  const [mode, setMode] = useState<'align' | 'sambam'>('align');
  const [refText, setRefText] = useState(''), [preset, setPreset] = useState<string>('sr');
  const [reads, setReads] = useState<{ file: File; name: string; size: number } | null>(null);
  const [samFile, setSamFile] = useState<{ file: File; name: string; size: number } | null>(null);
  const [loadingRef, setLoadingRef] = useState(false), [refErr, setRefErr] = useState('');
  const fastqInput = useRef<HTMLInputElement>(null), samInput = useRef<HTMLInputElement>(null);
  const contigs = useMemo(() => (refText ? parseFasta(refText) : []), [refText]);
  const refLength = contigs.reduce((a, c) => a + c.seq.length, 0);

  useEffect(() => { if (mode === 'sambam') setRefText(''); }, [mode]);
  const pickBundled = async (id: string) => {
    if (!id) return; setLoadingRef(true); setRefErr('');
    try { setRefText(await loadBundledText(id, 'fasta')); } catch (e) { setRefErr((e as Error).message); } finally { setLoadingRef(false); }
  };

  const go = () => void run({
    label: mode === 'align' ? `Alignment · ${reads?.name}` : `Alignment · ${samFile?.name}`,
    tool: TOOL, params: { preset, mode },
    inputs: [{ name: mode === 'align' ? 'reference' : 'alignment', data: (mode === 'align' ? refText : samFile?.name ?? '').slice(0, 200000) }],
    run: async (h) => {
      let samText = '', bam: Uint8Array | undefined, bai: Uint8Array | undefined;
      if (mode === 'align') {
        if (!refText || !reads) throw new Error('Choose a reference and a FASTQ file first.');
        h.onProgress(0.05, 'minimap2: aligning');
        const m = await runTool('minimap2', ['-a', '-x', preset, '--secondary=no', '/ref.fa', '/reads.fq', '-o', '/aln.sam'], { 'ref.fa': refText, 'reads.fq': new Uint8Array(await reads.file.arrayBuffer()) }, ['aln.sam'], { signal: h.signal });
        if (m.code !== 0 || !m.out['aln.sam']) throw new Error(`minimap2 failed (exit ${m.code}): ${m.stderr.split('\n').filter(Boolean).slice(-2).join(' ')}`);
        h.onProgress(0.45, 'samtools: sort + index');
        const so = await runTool('samtools', ['sort', '-o', '/sorted.bam', '/aln.sam'], { 'aln.sam': m.out['aln.sam'] }, ['sorted.bam'], { signal: h.signal });
        if (!so.out['sorted.bam']) throw new Error('samtools sort failed: ' + so.stderr.slice(-200));
        const ix = await runTool('samtools', ['index', '/sorted.bam'], { 'sorted.bam': so.out['sorted.bam'] }, ['sorted.bam.bai'], { signal: h.signal });
        if (!ix.out['sorted.bam.bai']) throw new Error('samtools index failed: ' + ix.stderr.slice(-200));
        const files = { 'sorted.bam': so.out['sorted.bam'], 'sorted.bam.bai': ix.out['sorted.bam.bai'] };
        h.onProgress(0.7, 'samtools: flagstat + SAM view');
        const fs = await runTool('samtools', ['flagstat', '/sorted.bam'], files, [], { signal: h.signal });
        const view = await runTool('samtools', ['view', '-h', '/sorted.bam', '-o', '/out.sam'], files, ['out.sam'], { signal: h.signal });
        if (!view.out['out.sam']) throw new Error('samtools view failed: ' + view.stderr.slice(-200));
        samText = dec.decode(view.out['out.sam']); bam = so.out['sorted.bam']; bai = ix.out['sorted.bam.bai'];
        return { sam: samText, flag: parseFlagstat(fs.stdout || fs.stderr), bam, bai };
      }
      if (!samFile) throw new Error('Choose a SAM or BAM file first.');
      const isBam = bamByName(samFile.name);
      let input: Uint8Array | string;
      if (isBam) {
        const bytes = new Uint8Array(await samFile.file.arrayBuffer());
        const magic = bytes.length >= 4 && bytes[0] === 66 && bytes[1] === 65 && bytes[2] === 77 && bytes[3] === 1;
        if (!magic) throw new Error('That file is not a BAM file (missing the BAM\\1 signature).');
        h.onProgress(0.1, 'samtools: convert BAM to SAM');
        const v = await runTool('samtools', ['view', '-h', '/in.bam', '-o', '/in.sam'], { 'in.bam': bytes }, ['in.sam'], { signal: h.signal });
        if (!v.out['in.sam']) throw new Error('samtools view failed: ' + v.stderr.slice(-200));
        input = dec.decode(v.out['in.sam']);
      } else input = await samFile.file.text();
      const header = typeof input === 'string' ? input : dec.decode(input);
      if (!header.split('\n').some((l) => l && l[0] !== '@' && l.split('\t').length >= 11)) throw new Error('The file has no SAM alignment records.');
      h.onProgress(0.4, 'samtools: sort + index');
      const so = await runTool('samtools', ['sort', '-o', '/sorted.bam', '/in.sam'], { 'in.sam': input }, ['sorted.bam'], { signal: h.signal });
      if (!so.out['sorted.bam']) throw new Error('samtools sort failed: ' + so.stderr.slice(-200));
      const ix = await runTool('samtools', ['index', '/sorted.bam'], { 'sorted.bam': so.out['sorted.bam'] }, ['sorted.bam.bai'], { signal: h.signal });
      const files = { 'sorted.bam': so.out['sorted.bam'], 'sorted.bam.bai': ix.out['sorted.bam.bai'] };
      h.onProgress(0.7, 'samtools: flagstat + SAM view');
      const fs = await runTool('samtools', ['flagstat', '/sorted.bam'], files, [], { signal: h.signal });
      const view = await runTool('samtools', ['view', '-h', '/sorted.bam', '-o', '/out.sam'], files, ['out.sam'], { signal: h.signal });
      if (!view.out['out.sam']) throw new Error('samtools view failed: ' + view.stderr.slice(-200));
      samText = dec.decode(view.out['out.sam']); bam = so.out['sorted.bam']; bai = ix.out['sorted.bam.bai'];
      return { sam: samText, flag: parseFlagstat(fs.stdout || fs.stderr), bam, bai };
    },
  }).then((r) => {
    if (!r) return;
    const sq = firstSq(r.sam);
    setAlignment({ sam: r.sam, label: mode === 'align' ? (reads?.name ?? 'aligned reads') : (samFile?.name ?? 'alignment'), refName: contigs[0]?.id ?? sq?.name ?? 'reference', refLength: refLength || sq?.length || 0, flag: r.flag, bam: r.bam, bai: r.bai });
  });

  return (
    <div className="split"><div className="stack">
      <Card title="Alignment input" sub="minimap2 + samtools, WebAssembly">
        <div className="stack" style={{ gap: 10 }}>
          <Field label="Input"><select className="select" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="align">FASTQ reads + reference FASTA</option><option value="sambam">Existing SAM / BAM</option></select></Field>
          {mode === 'align' ? <>
            <Field label="Bundled reference genome (RefSeq)"><select className="select" defaultValue="" disabled={loadingRef} onChange={(e) => void pickBundled(e.target.value)} aria-label="Bundled reference genome"><option value="">Choose, or upload a FASTA below…</option>{manifest?.genomes.map((g) => <option key={g.id} value={g.id}>{g.name} · {(g.totalLength / 1e6).toFixed(1)} Mb</option>)}</select></Field>
            {refErr && <Callout kind="err">{refErr}</Callout>}
            <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t) => setRefText(t)} label={refText ? `Reference: ${contigs.length} contig(s), ${refLength.toLocaleString()} bp` : 'Reference FASTA (≤ 100 Mb)'} />
            <label className="dropzone" onClick={() => fastqInput.current?.click()}><input ref={fastqInput} type="file" hidden accept=".fastq,.fq,.fastq.gz,.fq.gz,.gz" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 300 * 1024 * 1024) { alert('Reads file is larger than 300 MB. Align it on your computer, then open the BAM here.'); return; } setReads({ file: f, name: f.name, size: f.size }); }} />{reads ? `Reads: ${reads.name} (${(reads.size / 1048576).toFixed(1)} MB)` : 'Reads FASTQ (uncompressed, ≤ 300 MB)'}<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Processed in your browser. Never uploaded.</div></label>
            <Field label="minimap2 preset"><select className="select" value={preset} onChange={(e) => setPreset(e.target.value)}>{PRESETS.map(([id, n]) => <option key={id} value={id}>{id} · {n}</option>)}</select></Field>
          </> : <>
            <label className="dropzone" onClick={() => samInput.current?.click()}><input ref={samInput} type="file" hidden accept=".sam,.bam" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 500 * 1024 * 1024) { alert('Alignment file is larger than 500 MB, the limit for this browser tool.'); return; } setSamFile({ file: f, name: f.name, size: f.size }); }} />{samFile ? `${samFile.name} (${(samFile.size / 1048576).toFixed(1)} MB)` : 'SAM or BAM file (≤ 500 MB)'}<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>BAM is converted with samtools in your browser. Never uploaded.</div></label>
          </>}
          <div className="row"><button className="btn primary" disabled={busy || (mode === 'align' ? !refText || !reads : !samFile)} onClick={go}>Align &amp; sort</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
          {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout>Limits: reference ≤ ~100 Mb and FASTQ ≤ 300 MB per run (WebAssembly memory). BAM input is capped at 500 MB and is converted in your browser. For a whole human genome, align on your computer and open the BAM here, then count or call peaks on one chromosome at a time. Research use only.</Callout>
    </div>
    <div className="stack">{!alignment ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Align reads or open a SAM/BAM to see the mapping summary.</div></Card> : <>
      <Card title="Alignment" sub={alignment.label}>
        <div className="cols-4">
          <Stat label="Reads" value={(alignment.flag?.total ?? 0).toLocaleString()} />
          <Stat label="Mapped" value={`${fmt(alignment.flag?.mappedPct ?? 0, 1)}%`} />
          <Stat label="Properly paired" value={(alignment.flag?.properlyPaired ?? 0).toLocaleString()} />
          <Stat label="Duplicates" value={(alignment.flag?.duplicates ?? 0).toLocaleString()} />
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>{alignment.refName}{alignment.refLength ? ` · ${(alignment.refLength / 1e6).toFixed(2)} Mb` : ''} · {(alignment.sam.length / 1048576).toFixed(1)} MB SAM in memory</div>
        <div className="row" style={{ gap: 6, marginTop: 12 }}>
          <button className="btn primary sm" onClick={() => onUse('genes')}>Use in Gene counts</button>
          <button className="btn sm" onClick={() => onUse('peaks')}>Use in Peaks</button>
          {alignment.bam && <button className="btn sm" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([alignment.bam!.slice().buffer as ArrayBuffer])); a.download = 'sorted.bam'; a.click(); }}>BAM</button>}
          {alignment.bai && <button className="btn sm" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([alignment.bai!.slice().buffer as ArrayBuffer])); a.download = 'sorted.bam.bai'; a.click(); }}>BAI</button>}
          <button className="btn sm" onClick={() => downloadText('alignment.sam', alignment.sam)}>SAM</button>
        </div>
      </Card>
    </>}</div></div>
  );
}
