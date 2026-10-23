import { Busy, Callout, Card, Field } from '@/ui/kit';

interface Props {
  file: File | null;
  setFile(f: File | null): void;
  minIdentity: number;
  setMinIdentity(v: number): void;
  minCoverage: number;
  setMinCoverage(v: number): void;
  busy: boolean;
  progress: number;
  note?: string;
  error: string | null;
  cancel(): void;
  screen(): void;
  demo(which: 'synthetic' | 'ecoli'): void;
}

/** Assembly input, thresholds and the two bundled demos. */
export default function ScreenTab(p: Props) {
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Card title="1 · Assembly" sub="assembled contigs or a draft genome, FASTA only">
        <div className="stack" style={{ gap: 10 }}>
          <label className="dropzone">
            <input type="file" hidden accept=".fa,.fasta,.fna,.txt,.gz" onChange={(e) => p.setFile(e.target.files?.[0] ?? null)} />
            {p.file ? `${p.file.name} · ${(p.file.size / 1e6).toFixed(1)} MB` : 'Drop or choose a FASTA of contigs (≤ 100 MB, .gz accepted)'}
          </label>
          {p.file && <button className="btn sm" onClick={() => p.setFile(null)}>Remove file</button>}
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Minimum identity">
              <input className="input" type="number" min={0.5} max={1} step={0.01} value={p.minIdentity} onChange={(e) => p.setMinIdentity(Math.min(1, Math.max(0, +e.target.value)))} />
            </Field>
            <Field label="Minimum reference coverage">
              <input className="input" type="number" min={0.05} max={1} step={0.05} value={p.minCoverage} onChange={(e) => p.setMinCoverage(Math.min(1, Math.max(0, +e.target.value)))} />
            </Field>
          </div>
          <div className="faint" style={{ fontSize: 12 }}>Currently {pct(p.minIdentity)} identity over {pct(p.minCoverage)} of the reference gene.</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={p.busy || !p.file} onClick={p.screen}>Screen</button>
            {p.busy && <button className="btn" onClick={p.cancel}>Cancel</button>}
            <button className="btn" disabled={p.busy} onClick={() => p.demo('synthetic')}>Demo: synthetic contig with 5 resistance genes</button>
            <button className="btn" disabled={p.busy} onClick={() => p.demo('ecoli')}>Demo: E. coli K-12 (bundled)</button>
          </div>
          {p.busy && <Busy progress={p.progress} note={p.note} />}
          {p.error && <Callout kind="err">{p.error}</Callout>}
          <div className="faint" style={{ fontSize: 12 }}>
            The NCBI reference gene set (about 2 MB compressed) and the drug-class catalogue load on first use and stay in the worker for the rest of the session.
            Building the seed index takes a few seconds once; screening a bacterial genome then takes about 20 seconds.
          </div>
        </div>
      </Card>
    </div>
  );
}
