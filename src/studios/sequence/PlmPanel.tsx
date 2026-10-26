import { useMemo, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, Stat, downloadText, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import { AMINO_ACIDS, effectFromScan, parseMutation, positionConstraint, type ScanResult } from './plm';
import { PLM_MODELS, getModelDef } from './plmModels';
import type { PlmKernels } from './plm.worker';
import EmbedPanel from './EmbedPanel';
import ScanPanel from './ScanPanel';

const remote = createRemote<PlmKernels>(() => new Worker(new URL('./plm.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = { id: 'sequence.plm', name: 'Protein language model scan (ESM-2)', version: '0.2.0', engine: 'ESM-2 (ONNX Runtime Web)', citations: ['lin2023', 'meier2021'], describe: (p) => `Every position of a ${p.len}-residue protein was masked in turn and scored with ESM-2 (Lin et al. 2023), giving masked-marginal substitution effects (Meier et al. 2021) and a pseudo-perplexity of ${p.ppl}; scores are weak zero-shot predictors, not measurements` };
const UBIQUITIN = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG';

export default function PlmPanel() {
  const [sequence, setSequence] = useState(''),
    [ready, setReady] = useState(false),
    [muts, setMuts] = useState('L8D\nL8I'),
    [scan, setScan] = useState<{ seq: string; result: ScanResult } | null>(null),
    [modelId, setModelId] = useState('esm2_t6_8M_UR50D'),
    [provider, setProvider] = useState<'webgpu' | 'wasm'>('wasm'),
    [tab, setTab] = useState('scan');
  const loader = useRunner(),
    scanner = useRunner();
  const modelDef = getModelDef(modelId);
  const loadModel = () =>
    void loader
      .run({
        label: `Load ${modelDef.label}`,
        tool: TOOL,
        params: { len: 0, ppl: '' },
        inputs: [],
        run: (h) => remote.load({ modelId: modelDef.bundled ? undefined : modelDef.source, provider }, { signal: h.signal, onProgress: h.onProgress }),
        summary: () => `${modelDef.label} was loaded in the browser`,
      })
      .then((r) => r && setReady(true));
  const runScan = () =>
    void scanner
      .run({
        label: 'Protein language-model scan',
        tool: TOOL,
        params: { len: sequence.length, ppl: '' },
        inputs: [{ name: 'protein', data: sequence }],
        run: (h) => remote.scan({ seq: sequence }, { signal: h.signal, onProgress: h.onProgress }),
        summary: (r) => `Every position of a ${r.seq.length}-residue protein was masked in turn and scored with ESM-2, giving masked-marginal substitution effects and a pseudo-perplexity of ${r.result.pseudoPerplexity.toFixed(2)}`,
      })
      .then((r) => r && setScan(r));
  const scored = useMemo(() => {
    if (!scan) return [];
    return muts
      .split(/\s+/)
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean)
      .map((m) => {
        try {
          const p = parseMutation(m, scan.seq);
          return { m, effect: effectFromScan(scan.result, scan.seq, p.pos, p.mut), err: '' };
        } catch (e) {
          return { m, effect: NaN, err: (e as Error).message };
        }
      });
  }, [scan, muts]);
  const constraint = useMemo(() => (scan ? positionConstraint(scan.result, scan.seq) : []), [scan]);
  const ranked = useMemo(() => {
    if (!scan) return null;
    const all: { m: string; e: number }[] = [];
    for (let i = 0; i < scan.seq.length; i++)
      for (const a of AMINO_ACIDS)
        if (a !== scan.seq[i]) all.push({ m: `${scan.seq[i]}${i + 1}${a}`, e: effectFromScan(scan.result, scan.seq, i, a) });
    all.sort((x, y) => x.e - y.e);
    return { low: all.slice(0, 12), high: all.slice(-12).reverse() };
  }, [scan]);
  const csv = () => {
    if (!scan) return;
    const rows = ['position,wild_type,' + [...AMINO_ACIDS].join(',')];
    scan.result.logP.forEach((_, i) => rows.push(`${i + 1},${scan.seq[i]},${[...AMINO_ACIDS].map((a) => effectFromScan(scan.result, scan.seq, i, a).toFixed(4)).join(',')}`));
    downloadText('plm_substitution_effects.csv', rows.join('\n'), 'text/csv');
  };

  const tabs = [
    {
      id: 'scan',
      label: 'Scan',
      content: (
        <div className="stack">
          {scan && (
            <>
              <div className="cols-3">
                <Stat label="Pseudo-perplexity" value={fmt(scan.result.pseudoPerplexity, 2)} hint="exp(−mean log p(wild type)); lower = more natural" />
                <Stat label="Residues scanned" value={scan.seq.length} />
                <Stat label="Substitutions scored" value={(scan.seq.length * 19).toLocaleString()} />
              </div>
              <Card title="Score specific mutations" sub="log p(mutant) − log p(wild type); negative = disfavoured by the model">
                <div className="stack" style={{ gap: 8 }}>
                  <textarea className="input mono" rows={3} value={muts} onChange={(e) => setMuts(e.target.value)} aria-label="Mutations" style={{ fontSize: 12 }} placeholder={'One per line, e.g. L8D'} />
                  <DataTable rowKey={(r: any) => r.m} rows={scored} cols={[{ key: 'm', label: 'Mutation', render: (r: any) => <span className="mono">{r.m}</span> }, { key: 'e', label: 'Effect', num: true, render: (r: any) => (r.err ? <span className="faint">{r.err}</span> : fmt(r.effect, 3)), sort: (r: any) => (Number.isFinite(r.effect) ? r.effect : 1e9) }]} />
                </div>
              </Card>
              <Card title="Positional constraint" sub="mean effect of the 19 substitutions at each residue; lower = more constrained">
                <CurvePlot height={240} exportName="plm-constraint" spec={{ series: [{ name: 'mean effect', color: cssVar('--chart-a'), curve: constraint.map((y: number, i: number) => ({ x: i + 1, y })) }], xLabel: 'Residue', yLabel: 'Mean log-likelihood ratio' }} />
              </Card>
              {ranked && (
                <div className="cols-2">
                  <Card title="Most disfavoured substitutions" pad={false}>
                    <DataTable rowKey={(r: any) => r.m} rows={ranked.low} cols={[{ key: 'm', label: 'Mutation', render: (r: any) => <span className="mono">{r.m}</span> }, { key: 'e', label: 'Effect', num: true, render: (r: any) => fmt(r.e, 2) }]} />
                  </Card>
                  <Card title="Most tolerated substitutions" pad={false}>
                    <DataTable rowKey={(r: any) => r.m} rows={ranked.high} cols={[{ key: 'm', label: 'Mutation', render: (r: any) => <span className="mono">{r.m}</span> }, { key: 'e', label: 'Effect', num: true, render: (r: any) => fmt(r.e, 2) }]} />
                  </Card>
                </div>
              )}
              <div className="row">
                <button className="btn sm" onClick={csv}>
                  Download all substitution effects (CSV)
                </button>
              </div>
            </>
          )}
        </div>
      ),
    },
    { id: 'heatmap', label: 'Mutation heatmap', content: <ScanPanel scan={scan} /> },
    { id: 'embeddings', label: 'Embeddings', content: <EmbedPanel /> },
  ];

  return (
    <div className="stack">
      <Card title="Protein language model (experimental)" sub="ESM-2 · runs in your browser on your device">
        <Callout kind="warn">
          Experimental. Uses an 8-million-parameter ESM-2 model. Model weights are downloaded from the public repository you see above, after your confirmation, and then run on your device. ESM-2 is released under the MIT licence. Scores are model-based predictions, not experimental measurements and must not be used for clinical or diagnostic decisions. Your sequence stays on your device.
        </Callout>
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Field label="Model">
              <select className="input" value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {PLM_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.params}, ~{m.sizeMb} MB) {m.bundled ? '[bundled]' : '[download]'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Provider order">
              <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as any)}>
                <option value="webgpu">webgpu, wasm</option>
                <option value="wasm">wasm only</option>
              </select>
            </Field>
          </div>
          {!modelDef.bundled && (
            <Callout kind="warn">
              {modelDef.label} (~{modelDef.sizeMb} MB) will be downloaded from Hugging Face after confirmation. Cached in browser. Verify licence: {modelDef.licence}. If unavailable, use 8M or upload weights per OWNER notes.
            </Callout>
          )}
          <Field label="Protein sequence (up to 400 residues)">
            <textarea
              className="input mono"
              rows={3}
              value={sequence}
              onChange={(e) => {
                setSequence(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''));
                setScan(null);
              }}
              placeholder="Paste a protein sequence (single-letter amino acid codes)"
              style={{ fontSize: 12 }}
            />
          </Field>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => { setSequence(UBIQUITIN); setScan(null); }}>
              Example: ubiquitin
            </button>
            <button className="btn" disabled={ready || loader.busy} onClick={loadModel}>
              Load model (~30 MB)
            </button>
            <button className="btn primary" disabled={!ready || scanner.busy || sequence.length < 5} onClick={runScan}>
              Scan all substitutions
            </button>
          </div>
          {loader.busy && <Busy progress={loader.progress} note={loader.note} />}
          {scanner.busy && <Busy progress={scanner.progress} note={scanner.note} />}
          {(loader.error || scanner.error) && <Callout kind="err">{loader.error ?? scanner.error}</Callout>}
          {ready && !scan && !scanner.busy && <div className="faint" style={{ fontSize: 12 }}>Model loaded. Provider active as configured.</div>}
        </div>
      </Card>
      {ready && (
        <div className="stack">
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {tabs.map((t) => (
              <button key={t.id} className={`btn sm ${tab === t.id ? 'primary' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {tabs.find((t) => t.id === tab)?.content}
        </div>
      )}
      <Callout>
        <div>Scores are zero-shot masked-marginal log-likelihood ratios (Meier et al. 2021). They correlate only modestly with measured fitness.</div>
      </Callout>
    </div>
  );
}
