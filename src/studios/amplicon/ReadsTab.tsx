import { useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { createRemote } from '@/compute/rpc';
import { Busy, Callout, Card, DataTable, Field, Stat } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { demoAmplicon, PRIMER_F } from './simAmplicon';
import type { AmpliconResult } from './pipeline';
import type { AmpliconKernels, AmpSource } from './amplicon.worker';
import type { AmpliconInput, AmpliconSettings, AmpliconSource } from './AmpliconStudio';

const remote = createRemote<AmpliconKernels>(() => new Worker(new URL('./amplicon.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = {
  id: 'amplicon.pipeline', name: 'Amplicon ASV pipeline', version: '0.1.0',
  engine: 'TypeScript kernels in a Web Worker (streaming FASTQ, UNOISE-style denoising, UCHIME-style chimeras, RDP-style naive Bayes)',
  citations: ['edgar2016', 'edgar2015', 'wang2007', 'edgar2011'],
  describe: (p) => `Amplicon reads were trimmed of the ${p.fwd} / ${p.rev} primers (IUPAC-aware, ≤${p.mismatch} mismatches), filtered at maxEE = ${p.maxEE} and ±20 % of the median length, paired reads were merged by overlap, dereplicated, denoised with UNOISE-style abundance-skew rules (minimum abundance ${p.minSize}), screened for chimeras, and classified by an RDP-style 8-mer naive Bayes classifier when a reference was supplied`,
};

const baseName = (n: string) => n.replace(/\.(fastq|fq)(\.gz)?$/i, '');
const paired = (name: string) => /^(.*?)[._-](?:R)?([12])$/i.exec(baseName(name));

/** Group files into samples; `_R1`/`_R2` (or `.1`/`.2`) suffix pairs are recognised. */
export function groupFiles(files: File[]): { sources: AmpliconSource[]; ignored: string[] } {
  const bySample = new Map<string, AmpliconSource>();
  const ignored: string[] = [];
  for (const f of files) {
    const m = paired(f.name), key = m ? m[1] : baseName(f.name), mate = m?.[2];
    const cur = bySample.get(key) ?? { name: key };
    if (mate === '2') cur.r2 = f; else cur.r1 = f;
    bySample.set(key, cur);
  }
  const sources = [...bySample.values()].filter((s) => (s.r1 ? true : (ignored.push(s.name), false)));
  return { sources, ignored };
}

export default function ReadsTab({ input, setInput, settings, setSettings, reference, setReference, referenceName, result, setResult }: {
  input: AmpliconInput | null; setInput(v: AmpliconInput | null): void; settings: AmpliconSettings; setSettings(v: AmpliconSettings): void;
  reference: string; setReference(t: string, n: string): void; referenceName: string;
  result: AmpliconResult | null; setResult(v: AmpliconResult | null): void;
}) {
  const [ignored, setIgnored] = useState<string[]>([]);
  const { run, busy, progress, note, error } = useRunner();
  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const g = groupFiles([...files]);
    setIgnored(g.ignored);
    setResult(null);
    setInput({ kind: 'files', label: `${g.sources.length} sample${g.sources.length === 1 ? '' : 's'} (${[...files].length} FASTQ)`, sources: g.sources, demo: null });
  };
  const demo = () => {
    const d = demoAmplicon(21);
    setIgnored([]); setResult(null);
    setInput({ kind: 'demo', label: 'SYNTHETIC demo (3 samples)', sources: [], demo: d });
    setReference(d.reference, 'synthetic reference (3 phyla × 3 genera × 4 sequences)');
  };
  const go = () => {
    if (!input) return;
    const sources: AmpSource[] = input.demo
      ? input.demo.samples.map((s) => ({ sample: s.sample, demo: s }))
      : input.sources.map((s) => ({ sample: s.name, file: s.r1, file2: s.r2 }));
    void run({
      label: `Amplicon · ${input.label}`, tool: TOOL,
      params: { fwd: settings.fwd, rev: settings.rev, maxEE: settings.maxEE, minSize: settings.minSize, mismatch: 2 },
      inputs: [{ name: input.label, data: input.label }],
      run: (h) => remote.run({ sources, opts: { fwdPrimer: settings.fwd, revPrimer: settings.rev, maxEE: settings.maxEE, minSize: settings.minSize }, reference: reference || undefined }, { onProgress: h.onProgress }),
    }).then((r) => { if (r) setResult(r); });
  };
  const stageRows = result ? [
    { stage: 'Raw reads / pairs', n: result.stages.raw, note: 'input units' },
    { stage: 'Primer-matched', n: result.stages.primerMatched, note: 'forward (and reverse mate) primer found' },
    { stage: 'Filtered', n: result.stages.filtered, note: `maxEE ${settings.maxEE}, no N, ±20 % median length` },
    { stage: 'Merged', n: result.stages.merged, note: 'paired reads overlapped; single-end data skipped' },
    { stage: 'Denoised', n: result.stages.denoised, note: 'ASVs before chimera removal' },
    { stage: 'Non-chimeric', n: result.stages.nonChimeric, note: 'ASVs exported to the table' },
  ] : [];
  return (
    <>
      <Card title="1 · Reads and primers" sub="FASTQ / FASTQ.gz, single or paired. Filenames ending _R1/_R2 (or .1/.2) are paired and the prefix becomes the sample name.">
        <div className="stack" style={{ gap: 10 }}>
          <label className="dropzone">
            <input type="file" multiple accept=".fastq,.fq,.fastq.gz,.fq.gz,.gz" hidden onChange={(e) => onFiles(e.target.files)} />
            {input ? `Loaded: ${input.label}` : 'Choose one or more FASTQ files (one per sample; pairs as _R1 and _R2)'}
            <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Reads are parsed in your browser. Nothing is uploaded. Up to 200,000 reads or pairs per sample.</div>
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={demo}>Load demo (3 synthetic samples, SYNTHETIC)</button>
            {input && <button className="btn" onClick={() => { setInput(null); setResult(null); }}>Clear</button>}
          </div>
          {input?.demo && <div className="faint" style={{ fontSize: 11.5 }}>Synthetic 250 nt ASVs from five genera, 0.3 % substitution errors, primer sequences and paired 200 bp reads. Planted mixes are shown in the table tab; not a real sample.</div>}
          {ignored.length > 0 && <Callout kind="warn">Ignored files without a forward mate: {ignored.join(', ')}. Rename pairs as sample_R1.fastq and sample_R2.fastq.</Callout>}
          {input && <div className="faint" style={{ fontSize: 12 }}>{input.demo ? input.demo.samples.map((s) => `${s.sample}: ${s.reads.length.toLocaleString()} pairs`).join(' · ') : input.sources.map((s) => `${s.name} (${s.r2 ? 'paired' : 'single'})`).join(' · ')}</div>}
        </div>
      </Card>
      <Card title="2 · Primers and filters">
        <div className="cols-2" style={{ gap: 10 }}>
          <Field label="Forward primer (5′→3′, IUPAC)"><input className="input mono" value={settings.fwd} onChange={(e) => setSettings({ ...settings, fwd: e.target.value.toUpperCase() })} placeholder={PRIMER_F} /></Field>
          <Field label="Reverse primer (5′→3′, IUPAC)"><input className="input mono" value={settings.rev} onChange={(e) => setSettings({ ...settings, rev: e.target.value.toUpperCase() })} /></Field>
          <Field label="Maximum expected errors"><input className="input" type="number" step={0.1} min={0} value={settings.maxEE} onChange={(e) => setSettings({ ...settings, maxEE: +e.target.value })} /></Field>
          <Field label="Minimum ASV abundance (minSize)"><input className="input" type="number" min={1} value={settings.minSize} onChange={(e) => setSettings({ ...settings, minSize: +e.target.value })} /></Field>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="btn primary" disabled={!input || busy} onClick={go}>Run</button>
          {busy && <span className="faint">{note}</span>}
          <span className="faint" style={{ fontSize: 12 }}>{referenceName ? `Taxonomy reference: ${referenceName}` : 'No taxonomy reference: ASVs are still called, taxonomy stays Unclassified.'}</span>
        </div>
        {busy && <div style={{ marginTop: 10 }}><Busy progress={progress} note={note} /></div>}
        {error && <Callout kind="err">{error}</Callout>}
      </Card>
      {result && (
        <Card title="3 · Stage counts" sub={result.stages.unmerged ? `${result.stages.unmerged.toLocaleString()} pairs could not be merged.` : 'Counts are reads before denoising and ASVs afterwards.'}>
          <div className="cols-4">
            <Stat label="ASVs" value={`${result.rows.length} ASVs`} hint={`${result.chimeras.length} chimera${result.chimeras.length === 1 ? '' : 's'} removed`} />
            <Stat label="Raw" value={result.stages.raw.toLocaleString()} />
            <Stat label="Merged reads" value={result.stages.merged.toLocaleString()} />
            <Stat label="Samples" value={result.samples.length} />
          </div>
          <DataTable rows={stageRows} rowKey={(r) => r.stage} cols={[
            { key: 'stage', label: 'Stage', sort: (r) => r.stage },
            { key: 'n', label: 'Count', num: true, sort: (r) => r.n, render: (r) => r.n.toLocaleString() },
            { key: 'note', label: 'What it counts', render: (r) => <span className="faint">{r.note}</span> },
          ]} />
        </Card>
      )}
    </>
  );
}
