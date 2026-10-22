import { useMemo, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, Stat, downloadText, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import { AMINO_ACIDS, effectFromScan, parseMutation, positionConstraint, type ScanResult } from './plm';
import type { PlmKernels } from './plm.worker';

const remote = createRemote<PlmKernels>(() => new Worker(new URL('./plm.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = { id: 'sequence.plm', name: 'Protein language model scan (ESM-2 8M)', version: '0.1.0', engine: 'ESM-2 t6 8M (ONNX Runtime Web, WebAssembly)', citations: ['lin2023', 'meier2021'], describe: (p) => `Every position of a ${p.len}-residue protein was masked in turn and scored with the 8M-parameter ESM-2 model (Lin et al. 2023), giving masked-marginal substitution effects (Meier et al. 2021) and a pseudo-perplexity of ${p.ppl}; scores are weak zero-shot predictors, not measurements` };
const UBIQUITIN = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG';

/** Protein language-model tab (experimental). Needs a ~30 MB download from huggingface.co on first use (then cached by the browser). */
export default function PlmPanel() {
  const [sequence, setSequence] = useState(''), [ready, setReady] = useState(false), [muts, setMuts] = useState('L8D\nL8I'), [scan, setScan] = useState<{ seq: string; result: ScanResult } | null>(null);
  const loader = useRunner(), scanner = useRunner();
  const loadModel = () => void loader.run({ label: 'Load ESM-2 8M', tool: TOOL, params: { len: 0, ppl: '' }, inputs: [], run: (h) => remote.load(undefined, { signal: h.signal, onProgress: h.onProgress }), summary: () => 'The ESM-2 8M model was loaded in the browser' }).then((r) => r && setReady(true));
  const runScan = () => void scanner.run({ label: 'Protein language-model scan', tool: TOOL, params: { len: sequence.length, ppl: '' }, inputs: [{ name: 'protein', data: sequence }], run: (h) => remote.scan({ seq: sequence }, { signal: h.signal, onProgress: h.onProgress }), summary: (r) => `Every position of a ${r.seq.length}-residue protein was masked in turn and scored with the 8M-parameter ESM-2 model (Lin et al. 2023), giving masked-marginal substitution effects (Meier et al. 2021) and a pseudo-perplexity of ${r.result.pseudoPerplexity.toFixed(2)}; scores are weak zero-shot predictors, not measurements` }).then((r) => r && setScan(r));
  const scored = useMemo(() => {
    if (!scan) return [];
    return muts.split(/\s+/).map((m) => m.trim().toUpperCase()).filter(Boolean).map((m) => { try { const p = parseMutation(m, scan.seq); return { m, effect: effectFromScan(scan.result, scan.seq, p.pos, p.mut), err: '' }; } catch (e) { return { m, effect: NaN, err: (e as Error).message }; } });
  }, [scan, muts]);
  const constraint = useMemo(() => (scan ? positionConstraint(scan.result, scan.seq) : []), [scan]);
  const ranked = useMemo(() => { if (!scan) return null; const all: { m: string; e: number }[] = []; for (let i = 0; i < scan.seq.length; i++) for (const a of AMINO_ACIDS) if (a !== scan.seq[i]) all.push({ m: `${scan.seq[i]}${i + 1}${a}`, e: effectFromScan(scan.result, scan.seq, i, a) }); all.sort((x, y) => x.e - y.e); return { low: all.slice(0, 12), high: all.slice(-12).reverse() }; }, [scan]);
  const csv = () => { if (!scan) return; const rows = ['position,wild_type,' + [...AMINO_ACIDS].join(',')]; scan.result.logP.forEach((_, i) => rows.push(`${i + 1},${scan.seq[i]},${[...AMINO_ACIDS].map((a) => effectFromScan(scan.result, scan.seq, i, a).toFixed(4)).join(',')}`)); downloadText('plm_substitution_effects.csv', rows.join('\n'), 'text/csv'); };
  return (
    <div className="stack">
      <Card title="Protein language model (experimental)" sub="ESM-2 8M · runs in your browser">
        <Callout kind="warn">Experimental. Uses an 8-million-parameter ESM-2 model; scores are weak predictors and must not be used for clinical or diagnostic decisions. The model is downloaded from huggingface.co to your browser; your sequence stays on your device. The model is MIT-licensed (Lin et al. 2023).</Callout>
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          <Field label="Protein sequence (up to 400 residues)"><textarea className="input mono" rows={3} value={sequence} onChange={(e) => { setSequence(e.target.value.toUpperCase().replace(/[^A-Z]/g, '')); setScan(null); }} placeholder="Paste a protein sequence (single-letter amino acid codes)" style={{ fontSize: 12 }} /></Field>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => { setSequence(UBIQUITIN); setScan(null); }}>Example: ubiquitin</button>
            <button className="btn" disabled={ready || loader.busy} onClick={loadModel}>Load model (~30 MB)</button>
            <button className="btn primary" disabled={!ready || scanner.busy || sequence.length < 5} onClick={runScan}>Scan all substitutions</button>
          </div>
          {loader.busy && <Busy progress={loader.progress} note={loader.note} />}{scanner.busy && <Busy progress={scanner.progress} note={scanner.note} />}
          {(loader.error || scanner.error) && <Callout kind="err">{loader.error ?? scanner.error}</Callout>}
          {ready && !scan && !scanner.busy && <div className="faint" style={{ fontSize: 12 }}>Model loaded. Each position is masked in turn, so scanning takes about a second per 20 residues.</div>}
        </div>
      </Card>
      {scan && <>
        <div className="cols-3"><Stat label="Pseudo-perplexity" value={fmt(scan.result.pseudoPerplexity, 2)} hint="exp(−mean log p(wild type)); lower = the model finds the sequence more natural (20 = random)" /><Stat label="Residues scanned" value={scan.seq.length} /><Stat label="Substitutions scored" value={(scan.seq.length * 19).toLocaleString()} /></div>
        <Card title="Score specific mutations" sub="log p(mutant) − log p(wild type); negative = disfavoured by the model"><div className="stack" style={{ gap: 8 }}>
          <textarea className="input mono" rows={3} value={muts} onChange={(e) => setMuts(e.target.value)} aria-label="Mutations" style={{ fontSize: 12 }} placeholder={'One per line, e.g. L8D'} />
          <DataTable rowKey={(r) => r.m} rows={scored} cols={[{ key: 'm', label: 'Mutation', render: (r) => <span className="mono">{r.m}</span> }, { key: 'e', label: 'Effect', num: true, render: (r) => (r.err ? <span className="faint">{r.err}</span> : fmt(r.effect, 3)), sort: (r) => (Number.isFinite(r.effect) ? r.effect : 1e9) }]} />
        </div></Card>
        <Card title="Positional constraint" sub="mean effect of the 19 substitutions at each residue; lower = more constrained"><CurvePlot height={240} exportName="plm-constraint" spec={{ series: [{ name: 'mean effect', color: cssVar('--chart-a'), curve: constraint.map((y, i) => ({ x: i + 1, y })) }], xLabel: 'Residue', yLabel: 'Mean log-likelihood ratio' }} /></Card>
        {ranked && <div className="cols-2"><Card title="Most disfavoured substitutions" pad={false}><DataTable rowKey={(r) => r.m} rows={ranked.low} cols={[{ key: 'm', label: 'Mutation', render: (r) => <span className="mono">{r.m}</span> }, { key: 'e', label: 'Effect', num: true, render: (r) => fmt(r.e, 2) }]} /></Card>
          <Card title="Most tolerated substitutions" pad={false}><DataTable rowKey={(r) => r.m} rows={ranked.high} cols={[{ key: 'm', label: 'Mutation', render: (r) => <span className="mono">{r.m}</span> }, { key: 'e', label: 'Effect', num: true, render: (r) => fmt(r.e, 2) }]} /></Card></div>}
        <div className="row"><button className="btn sm" onClick={csv}>Download all substitution effects (CSV)</button></div>
      </>}
      <Callout><div>Scores are zero-shot masked-marginal log-likelihood ratios (Meier et al. 2021) from a small model. They correlate only modestly with measured fitness. Sequence embeddings are not offered because the browser (ONNX) export of this model exposes only its output logits.</div></Callout>
    </div>
  );
}
