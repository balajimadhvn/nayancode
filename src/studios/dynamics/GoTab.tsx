import { useMemo, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import { Busy, Callout, Card, Field, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { BarChart, CurvePlot, cssVar } from '@/viz/charts';
import type { ToolInfo } from '@/core/provenance';
import type { CurveSeries } from '@/viz/figure';
import type { GoKernels, GoRunResult, GoScanResult } from './go.worker';
import ubq from './fixtures/1ubq.pdb?raw';
import pga from './fixtures/1pga.pdb?raw';

const remote = createRemote<GoKernels>(() => new Worker(new URL('./go.worker.ts', import.meta.url), { type: 'module' }));
const DEMOS = [{ id: '1pga', name: '1PGA · protein G B1 domain (56 residues)', text: pga }, { id: '1ubq', name: '1UBQ · ubiquitin (76 residues)', text: ubq }];
const TOOLS: Record<'fold' | 'scan', ToolInfo> = {
  fold: { id: 'dyn.go', name: 'C-alpha Go-model folding', version: '0.1.0', engine: 'TypeScript BAOAB Langevin in a Web Worker', citations: ['clementi2000', 'leimkuhler2013'], describe: (p) => `A C-alpha structure-based Go model of ${p.residues} residues was integrated with BAOAB Langevin dynamics at T = ${p.T} for ${p.steps} steps (dt = 0.005, friction 0.05).` },
  scan: { id: 'dyn.goscan', name: 'Go-model temperature scan', version: '0.1.0', engine: 'TypeScript BAOAB Langevin in a Web Worker', citations: ['clementi2000', 'leimkuhler2013'], describe: (p) => `Mean native-contact fraction Q was measured at ${p.temps} temperatures (${p.steps} steps each) for a C-alpha Go model of ${p.residues} residues.` },
};

export default function GoTab() {
  const [pdb, setPdb] = useState(pga), [source, setSource] = useState('1PGA demo');
  const [T, setT] = useState(0.5), [steps, setSteps] = useState(2000);
  const [res, setRes] = useState<GoRunResult | null>(null), [scan, setScan] = useState<GoScanResult | null>(null);
  const [pdbId, setPdbId] = useState(''), [fetching, setFetching] = useState(false), [fetchNote, setFetchNote] = useState<string | null>(null);
  const { run, busy, progress, note, error } = useRunner();
  const frames = res?.frames ?? [];
  const last = frames.at(-1);

  const runFold = () => void run({
    label: 'Go-model folding', tool: TOOLS.fold,
    params: { residues: res?.n ?? '—', T, steps },
    inputs: [{ name: 'structure', data: pdb }],
    run: async (h) => {
      const r = await remote.run({ pdb, T, steps, seed: 7, every: 100 }, { signal: h.signal, onProgress: h.onProgress });
      setRes(r); setScan(null);
    },
  });

  const runScan = () => void run({
    label: 'Go-model temperature scan', tool: TOOLS.scan,
    params: { temps: 10, steps: 20_000, residues: res?.n ?? '—' },
    inputs: [{ name: 'structure', data: pdb }],
    run: async (h) => {
      const r = await remote.scan({ pdb, steps: 20_000, seed: 3 }, { signal: h.signal, onProgress: h.onProgress });
      setScan(r); setRes(null);
    },
  });

  const fetchPdb = async () => {
    const id = pdbId.trim().toUpperCase();
    if (!/^[0-9A-Z]{4}$/.test(id)) { setFetchNote('Enter a four-character PDB ID, for example 1UBQ.'); return; }
    setFetching(true); setFetchNote(null);
    try {
      const r = await fetch(`https://files.rcsb.org/download/${id}.pdb`);
      if (!r.ok) throw new Error(`RCSB returned ${r.status}`);
      const text = await r.text();
      setPdb(text); setSource(`${id} from RCSB`); setFetchNote(`Fetched ${id} from RCSB. This request was made only because you clicked.`);
    } catch (e) {
      setFetchNote(`Could not fetch ${id}: ${e instanceof Error ? e.message : 'network error'}. You can paste a PDB file instead.`);
    } finally { setFetching(false); }
  };

  const series = useMemo(() => {
    const at = (f: (typeof frames)[number]) => f.t;
    return {
      q: [{ name: 'Q (native contacts)', color: cssVar('--chart-a'), curve: frames.map((f) => ({ x: at(f), y: f.Q })) }] as CurveSeries[],
      rmsd: [{ name: 'RMSD (Å)', color: cssVar('--chart-b'), curve: frames.map((f) => ({ x: at(f), y: f.rmsd })) }] as CurveSeries[],
      rg: [{ name: 'Rg (Å)', color: cssVar('--chart-c'), curve: frames.map((f) => ({ x: at(f), y: f.rg })) }] as CurveSeries[],
      energy: [{ name: 'Energy ε', color: cssVar('--chart-a'), curve: frames.map((f) => ({ x: at(f), y: f.energy })) }] as CurveSeries[],
    };
  }, [frames]);

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Structure"><div className="stack" style={{ gap: 10 }}>
        <Field label="Demo"><select className="select" defaultValue="1pga" onChange={(e) => { const d = DEMOS.find((x) => x.id === e.target.value); if (d) { setPdb(d.text); setSource(d.name); setRes(null); } }}>{DEMOS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <div className="cols-2" style={{ gap: 8 }}>
          <Field label="Fetch a PDB ID (RCSB)"><input className="input" value={pdbId} placeholder="1UBQ" onChange={(e) => setPdbId(e.target.value)} /></Field>
          <button className="btn" style={{ alignSelf: 'end', marginBottom: 1 }} disabled={fetching} onClick={() => void fetchPdb()}>{fetching ? 'Fetching…' : 'Fetch'}</button>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>Loaded: {source}. The structure stays in your browser; a fetch happens only when you click.</div>
        {fetchNote && <div className="faint" style={{ fontSize: 12 }}>{fetchNote}</div>}
        <Field label="Temperature T (ε/kB)"><input className="range" type="range" min="0.2" max="2.5" step="0.05" value={T} onChange={(e) => setT(Number(e.target.value))} /></Field>
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="faint">T = {T.toFixed(2)}</span><span className="faint">Fold at low T, unfold at high T</span></div>
        <Field label="Steps"><select className="select" value={steps} onChange={(e) => setSteps(Number(e.target.value))}><option value={2000}>2,000</option><option value={10000}>10,000</option><option value={30000}>30,000</option></select></Field>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy} onClick={runFold}>Run</button>
          <button className="btn" disabled={busy} onClick={runScan}>Temperature scan (10 × 20,000)</button>
        </div>
        {busy && <Busy progress={progress} note={note} />}
        {error && <Callout kind="err">{error}</Callout>}
      </div></Card>
      <Card title="Summary" sub={res ? `${res.n} residues · ${res.contacts} native contacts · ${fmt(res.ms, 0)} ms` : scan ? `${scan.points.length} temperatures · ${fmt(scan.ms, 0)} ms` : undefined}>
        {last ? <div className="cols-2" style={{ gap: 8 }}>
          <Stat label="Q" value={fmt(last.Q, 3)} /><Stat label="RMSD (Å)" value={fmt(last.rmsd, 2)} />
          <Stat label="Rg (Å)" value={fmt(last.rg, 2)} /><Stat label="Energy" value={fmt(last.energy, 2)} />
        </div> : <div className="faint">Run the model to see Q, RMSD, Rg and energy.</div>}
      </Card>
    </div>
    <div className="stack">
      {scan && <Card title="Temperature scan"><BarChart labels={scan.points.map((p) => p.T.toFixed(1))} values={scan.points.map((p) => p.meanQ)} colors={scan.points.map(() => cssVar('--chart-a'))} yLabel="mean Q" height={260} fmt={(v) => v.toFixed(2)} /></Card>}
      <Card title="Native contacts (Q)"><CurvePlot spec={{ series: series.q, xLabel: 'Time τ', yLabel: 'Q', yMin: 0, yMax: 1 }} height={210} exportName="go-q" /></Card>
      <Card title="RMSD and radius of gyration"><CurvePlot spec={{ series: [...series.rmsd, ...series.rg], xLabel: 'Time τ', yLabel: 'Å' }} height={230} exportName="go-rmsd" /></Card>
      <Card title="Energy"><CurvePlot spec={{ series: series.energy, xLabel: 'Time τ', yLabel: 'Energy ε' }} height={200} exportName="go-energy" /></Card>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" disabled={!res} onClick={() => res && downloadText('go-trajectory.pdb', res.pdb)}>Download PDB trajectory</button>
        <button className="btn" disabled={!frames.length} onClick={() => frames.length && downloadText('go-observables.csv', toCsv(frames))}>Download CSV</button>
      </div>
      <div className="faint" style={{ fontSize: 12 }}>Coarse-grained structure-based model. It shows folding and unfolding tendencies of a known fold; it is not a force field for predicting structures or binding. For all-atom molecular dynamics use the Native MD tab (needs the Nayancode Bridge).</div>
      <div className="faint" style={{ fontSize: 12 }}>Runs in your browser, on your own processor, in a background worker. Your structures are not uploaded. Results are research-grade and not clinical.</div>
    </div></div>
  );
}
