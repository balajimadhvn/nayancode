import { useState } from 'react';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import type { AssembleKernels, AssemblyResult } from './assemble.worker';

const remote = createRemote<AssembleKernels>(() => new Worker(new URL('./assemble.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = {
  id: 'genome.assemble', name: 'Small-genome assembly', version: '0.1.0', engine: 'TypeScript worker (minimizer index, string graph, greedy overlap extension)',
  citations: ['li2016miniasm', 'myers2005'],
  describe: (p) => `Reads were assembled de novo by an overlap-layout approach: canonical ${p.k}-mer minimizers (window ${p.w}) were indexed, dovetail overlaps of at least ${p.minOverlap} nt were found and checked for a consistent diagonal, reads contained in another read and transitive overlaps were removed, and contigs were built by greedy overlap extension. The assembly is unpolished`,
};

/** De novo assembly of small genomes from long or high-accuracy reads. */
export default function AssemblyPanel() {
  const [file, setFile] = useState<File | null>(null), [maxReads, setMaxReads] = useState('200000'), [minOverlap, setMinOverlap] = useState('1000');
  const [res, setRes] = useState<AssemblyResult | null>(null), [name, setName] = useState('');
  const { run, busy, progress, note, error } = useRunner();
  const apply = (r: AssemblyResult, label: string) => { setRes(r); setName(label); };
  const go = () => {
    if (!file) return;
    void run({
      label: `Assembly · ${file.name}`, tool: TOOL, params: { k: 15, w: 10, minOverlap: Number(minOverlap) || 1000 },
      inputs: [{ name: 'reads', data: `${file.name} (${file.size.toLocaleString()} bytes)` }],
      run: (h) => remote.assemble({ reads: { file }, maxReads: Number(maxReads) || 200_000, minOverlap: Number(minOverlap) || 1000 }, { onProgress: h.onProgress, signal: h.signal }).then((r) => { apply(r, file.name); return r; }),
      summary: (r) => `${r.reads.toLocaleString()} reads assembled into ${r.stats.contigs} contigs (total ${r.stats.total.toLocaleString()} bp, N50 ${r.stats.n50.toLocaleString()}, longest ${r.stats.longest.toLocaleString()} bp)`,
    });
  };
  const demo = () => void run({
    label: 'Assembly · simulated phage lambda', tool: TOOL, params: { k: 15, w: 10, minOverlap: 1000 },
    inputs: [{ name: 'reads', data: 'simulated in the browser: 60× phage lambda, 3–8 kb reads, 0.3 % substitutions' }],
    run: (h) => remote.demo({ coverage: 60, seed: 4 }, { onProgress: h.onProgress, signal: h.signal }).then((r) => { apply(r, 'simulated phage lambda'); setFile(null); return r; }),
    summary: (r) => `Simulated phage lambda reads assembled into ${r.stats.contigs} contigs (N50 ${r.stats.n50.toLocaleString()} bp, longest ${r.stats.longest.toLocaleString()} bp)`,
  });
  const fasta = () => (res ? res.contigs.map((c) => `>${c.id} reads=${c.reads}\n${c.seq.match(/.{1,70}/g)!.join('\n')}`).join('\n') + '\n' : '');

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Reads" sub="long or high-accuracy reads, FASTQ / FASTA (.gz accepted)">
        <div className="stack" style={{ gap: 10 }}>
          <label className="dropzone"><input type="file" hidden accept=".fastq,.fq,.fasta,.fa,.fna,.gz" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); }} />{file ? `Reads: ${file.name}` : 'Choose FASTQ or FASTA reads'}</label>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Max reads"><input className="input" value={maxReads} onChange={(e) => setMaxReads(e.target.value)} /></Field>
            <Field label="Min overlap (nt)"><input className="input" value={minOverlap} onChange={(e) => setMinOverlap(e.target.value)} /></Field>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy || !file} onClick={go}>Assemble</button>
            <button className="btn" disabled={busy} onClick={demo}>Demo: 60× simulated phage lambda</button>
          </div>
          {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout kind="warn">Browser-scale assembler for bacterial and viral genomes from long or high-accuracy reads. The output is unpolished. For publication-grade assemblies use Flye/Unicycler/SPAdes and polish.</Callout>
    </div>
      <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Choose reads (or run the demo) to build contigs.</div></Card> : <>
        <div className="cols-4">
          <Stat label="Contigs" value={res.stats.contigs} />
          <Stat label="Total (bp)" value={res.stats.total.toLocaleString()} />
          <Stat label="N50" value={res.stats.n50.toLocaleString()} />
          <Stat label="Longest" value={res.stats.longest.toLocaleString()} />
        </div>
        <div className="cols-4">
          <Stat label="Reads assembled" value={res.reads.toLocaleString()} hint={`${res.contained.toLocaleString()} reads contained in another read were dropped`} />
          <Stat label="Reads < 500 nt" value={res.filtered.toLocaleString()} />
          <Stat label="L50" value={res.stats.l50} />
          <Stat label="GC" value={`${fmt(res.stats.gc * 100, 2)}%`} />
        </div>
        <Card title="Contigs" sub={name} pad={false} actions={<><button className="btn sm" onClick={() => downloadText('contigs.fasta', fasta(), 'text/fasta')}>Download contigs.fasta</button><button className="btn sm" onClick={() => downloadText('contigs.csv', toCsv(res.stats.contigTable), 'text/csv')}>CSV</button></>}>
          <DataTable rows={res.contigs} rowKey={(r) => r.id} cols={[
            { key: 'id', label: 'Contig', sort: (r) => r.id },
            { key: 'length', label: 'Length', num: true, sort: (r) => r.seq.length, render: (r) => r.seq.length.toLocaleString() },
            { key: 'reads', label: 'Reads', num: true, sort: (r) => r.reads },
          ]} />
        </Card>
      </>}</div></div>
  );
}
