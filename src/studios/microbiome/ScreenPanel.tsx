import { useState } from 'react';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { BarChart, cssVar } from '@/viz/charts';
import type { ScreenKernels, ScreenResult } from './screen.worker';

const remote = createRemote<ScreenKernels>(() => new Worker(new URL('./screen.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = {
  id: 'microbiome.screen', name: 'Reference screening', version: '0.1.0', engine: 'TypeScript worker (FracMinHash sketches, greedy gather)',
  citations: ['ondov2016', 'irber2022'],
  describe: (p) => `Reads were sketched with FracMinHash (k = ${p.k}, scaled = ${p.scaled}) and screened against ${p.references} reference genome${p.references === 1 ? '' : 's'} by containment; the sample was decomposed greedily with a minimum-metagenome-cover gather`,
};
const WARNING = 'Screening only. Sketch containment can say which bundled genomes are present in a sample; it does not give species-level or strain-level calls from a full database. Use Kraken2 / sourmash with a full database for that.';

interface Row { id: string; containment: number; coverage: number; share: number; shared: number }

/** Read-level screening against the bundled reference genomes (and any the user drops in). */
export default function ScreenPanel() {
  const [file, setFile] = useState<File | null>(null), [extra, setExtra] = useState<{ name: string; text: string } | null>(null);
  const [maxReads, setMaxReads] = useState('1000000');
  const [res, setRes] = useState<ScreenResult | null>(null);
  const { run, busy, progress, note, error } = useRunner();

  const rows: Row[] = res ? (() => {
    const share = new Map(res.gathered.map((g) => [g.id, g.fractionOfSample]));
    return res.refs.map((r) => ({ id: r.id, containment: r.containment, coverage: r.coverage, share: share.get(r.id) ?? 0, shared: r.shared })).sort((a, b) => b.containment - a.containment || a.id.localeCompare(b.id));
  })() : [];
  const hits = rows.filter((r) => r.share > 0);
  const cols = [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d')];

  const apply = (r: ScreenResult) => setRes(r);
  const go = () => {
    if (!file) return;
    void run({
      label: `Screening · ${file.name}`, tool: TOOL, params: { k: 21, scaled: 50, references: 8 + (extra ? 1 : 0) },
      inputs: [{ name: 'reads', data: `${file.name} (${file.size.toLocaleString()} bytes)` }, ...(extra ? [{ name: 'references', data: extra.name }] : [])],
      run: (h) => remote.screen({ reads: { file }, maxReads: Number(maxReads) || 1_000_000, extraFasta: extra?.text }, { onProgress: h.onProgress, signal: h.signal }).then((r) => { apply(r); return r; }),
      summary: (r) => `${r.reads.toLocaleString()} reads were sketched and screened against the bundled genomes; ${r.gathered.length ? `the sample was decomposed as ${r.gathered.map((g) => `${g.id} ${(g.fractionOfSample * 100).toFixed(1)} %`).join(', ')}` : 'no reference explained the sample'}`,
    });
  };
  const demo = () => void run({
    label: 'Screening · 70 % lambda + 30 % T7 demo', tool: TOOL, params: { k: 21, scaled: 50, references: 8 },
    inputs: [{ name: 'reads', data: 'simulated in the browser: 20,000 × 150 nt, 0.5 % substitutions' }],
    run: (h) => remote.demo({ nReads: 20_000, seed: 7 }, { onProgress: h.onProgress, signal: h.signal }).then((r) => { apply(r); setFile(null); return r; }),
    summary: (r) => `Simulated reads from a 70 % lambda / 30 % T7 mixture were sketched and screened; the gather reported ${r.gathered.map((g) => `${g.id} ${(g.fractionOfSample * 100).toFixed(1)} %`).join(', ')}`,
  });

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Card title="1 · Reads and references" sub="small genomes, viruses, amplicon-free shotgun reads">
        <div className="stack" style={{ gap: 10 }}>
          <label className="dropzone"><input type="file" hidden accept=".fastq,.fq,.fasta,.fa,.fna,.gz" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); }} />{file ? `Reads: ${file.name}` : 'Choose FASTQ / FASTA reads (.gz accepted)'}</label>
          <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t, n) => { setExtra({ name: n, text: t }); setRes(null); }} label={extra ? `Extra references: ${extra.name}` : 'Optional: your own reference FASTA (one reference per record)'} />
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Max reads"><input className="input" value={maxReads} onChange={(e) => setMaxReads(e.target.value)} /></Field>
            <Field label="References screened"><div className="faint" style={{ fontSize: 12, paddingTop: 10 }}>The 8 bundled RefSeq genomes{extra ? ' plus your FASTA' : ''}.</div></Field>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy || !file} onClick={go}>Screen</button>
            <button className="btn" disabled={busy} onClick={demo}>Demo: 70 % lambda + 30 % T7 mixture</button>
          </div>
          {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout kind="warn">{WARNING}</Callout>
      {res && <>
        <div className="cols-4">
          <Stat label="Reads sketched" value={res.reads.toLocaleString()} hint={res.demo ? 'simulated in the browser' : undefined} />
          <Stat label="Distinct sketch hashes" value={res.readHashes.toLocaleString()} hint="k = 21, scaled = 50 (about 1 in 50 k-mers kept)" />
          <Stat label="References hit" value={hits.length} />
          <Stat label="Explained by gather" value={`${fmt(res.gathered.reduce((a, g) => a + g.fractionOfSample, 0) * 100, 1)} %`} hint="the rest is sequence in no bundled genome, or error hashes" />
        </div>
        <Card title="Screening table" sub="containment = share of the sample explained · coverage = share of the reference seen · share = greedy gather" pad={false}
          actions={<button className="btn sm" onClick={() => downloadText('screening.csv', toCsv(rows.map((r) => ({ reference: r.id, sharedHashes: r.shared, containment: r.containment, referenceCoverage: r.coverage, shareOfSample: r.share }))), 'text/csv')}>CSV</button>}>
          <DataTable<Row> rows={rows} rowKey={(r) => r.id} cols={[
            { key: 'id', label: 'Reference', sort: (r) => r.id },
            { key: 'shared', label: 'Shared hashes', num: true, sort: (r) => r.shared, render: (r) => r.shared.toLocaleString() },
            { key: 'containment', label: 'Containment', num: true, sort: (r) => r.containment, render: (r) => `${fmt(r.containment * 100, 2)} %` },
            { key: 'coverage', label: 'Reference coverage', num: true, sort: (r) => r.coverage, render: (r) => `${fmt(r.coverage * 100, 1)} %` },
            { key: 'share', label: 'Share of sample', num: true, sort: (r) => r.share, render: (r) => (r.share ? `${fmt(r.share * 100, 1)} %` : '–') },
          ]} />
        </Card>
        {res.gathered.length > 0 && <Card title="Gather" sub="minimum-metagenome-cover: references are taken largest-first from the hashes still unexplained">
          <BarChart labels={res.gathered.map((g) => g.id)} values={res.gathered.map((g) => g.fractionOfSample * 100)} colors={res.gathered.map((_, i) => cols[i % cols.length])} yLabel="Share of sample (%)" fmt={(v) => `${fmt(v, 1)}`} height={280} exportName="screening-gather" />
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>Read as relative abundance of the sketched k-mers, not of cells: genomes with more of the sample's sequence get a larger share. Nothing is reported below 5 shared hashes.</div>
        </Card>}
      </>}
    </div>
  );
}
