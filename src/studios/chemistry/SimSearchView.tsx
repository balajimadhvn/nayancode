import { useEffect, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { detectDevice, detectGpuDetailed, rememberGpu } from '@/compute/device';
import { classifyDevice, recommendedLimits, type Tier } from '@/compute/hardware';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { chemCall } from './chemClient';
import {
  MAX_BUTINA, butina, tanimotoCpu, topK, type ButinaResult, type Neighbour,
} from './simsearch';
import { butinaFitsGpu, gpuButina, gpuTanimoto } from './simsearchGpu';

const RADIUS = 2;
const BITS = 2048;
const WORDS = BITS / 32;

const REFERENCE: [string, string][] = [
  ['Aspirin', 'CC(=O)OC1=CC=CC=C1C(=O)O'],
  ['Ibuprofen', 'CC(C)CC1=CC=C(C=C1)C(C)C(=O)O'],
  ['Paracetamol', 'CC(=O)NC1=CC=C(O)C=C1'],
  ['Caffeine', 'CN1C=NC2=C1C(=O)N(C)C(=O)N2C'],
  ['Naproxen', 'COC1=CC2=CC=C(C=C2C=C1)C(C)C(=O)O'],
  ['Diclofenac', 'OC(=O)CC1=CC=CC=C1NC1=C(Cl)C=CC=C1Cl'],
  ['Celecoxib', 'CC1=CC=C(C=C1)C1=CC(=NN1C1=CC=C(C=C1)S(N)(=O)=O)C(F)(F)F'],
  ['Metformin', 'CN(C)C(=N)N=C(N)N'],
  ['Atorvastatin', 'CC(C)C1=C(C(=C(N1CC[C@H](C[C@H](CC(=O)O)O)O)C2=CC=C(C=C2)F)C3=CC=CC=C3)C(=O)NC4=CC=CC=C4'],
  ['Sildenafil', 'CCCC1=NN(C2=C1N=C(NC2=O)C3=C(C=CC(=C3)S(=O)(=O)N4CCN(CC4)C)OCC)C'],
];
const EXAMPLE = `name,smiles\n${REFERENCE.map(([name, smiles]) => `${name},${smiles}`).join('\n')}`;

const TOOL = (id: string, name: string, describe: ToolInfo['describe']): ToolInfo => ({
  id, name, version: '0.1.0', engine: 'RDKit (WebAssembly) + TypeScript/WebGPU',
  citations: ['rdkit', 'rogers2010', 'butina1999'], describe,
});
const PARSE_TOOL = TOOL('chem.simparse', 'Library parsing for similarity search', (p) => `${p.n} SMILES strings were parsed and standardised with RDKit; Morgan fingerprints (radius 2, 2048 bits) were computed for similarity search`);
const SEARCH_TOOL = TOOL('chem.simsearch', 'Tanimoto similarity search', (p) => `A query was compared with ${p.n} molecules by Tanimoto similarity of Morgan fingerprints (radius ${p.radius}, ${p.bits} bits) on the ${p.engine === 'gpu' ? 'GPU' : 'CPU'}; the top ${p.k} were reported`);
const CLUSTER_TOOL = TOOL('chem.butina', 'Butina clustering', (p) => `${p.n} molecules were clustered by the Taylor–Butina algorithm on Tanimoto distance (cutoff ${p.cutoff}) on the ${p.engine === 'gpu' ? 'GPU' : 'CPU'}`);

interface Row { name: string; smiles: string }
interface LibMol { name: string; smiles: string; canon: string; fp: Uint32Array }
interface Hit { mol: LibMol; sim: number; svg: string }
interface ClusterRun { res: ButinaResult; used: 'gpu' | 'cpu'; ms: number; cutoff: number }

function parseRows(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return [];
  const head = lines[0].split(/[,\t;]/).map((h) => h.trim().toLowerCase());
  const si = head.findIndex((h) => h === 'smiles' || h === 'smile' || h === 'canonical_smiles');
  if (si >= 0) {
    const ni = head.findIndex((h) => h === 'name' || h === 'id' || h === 'compound');
    const out: Row[] = [];
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split(/[,\t;]/).map((s) => s.trim().replace(/^"|"$/g, ''));
      if (f[si]) out.push({ smiles: f[si], name: ni >= 0 ? (f[ni] || `mol${i}`) : `mol${i}` });
    }
    return out;
  }
  const d = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : lines[0].includes(';') ? ';' : /[\s]+/;
  return lines.map((line, i) => {
    const f = line.split(d).filter(Boolean);
    return { smiles: f[0] ?? '', name: f.slice(1).join(' ').replace(/^"|"$/g, '') || `mol${i + 1}` };
  }).filter((r) => r.smiles);
}

function pack(mols: LibMol[]): Uint32Array {
  const db = new Uint32Array(mols.length * WORDS);
  mols.forEach((m, i) => db.set(m.fp.subarray(0, WORDS), i * WORDS));
  return db;
}

function rankSims(sims: Float32Array, k: number): Neighbour[] {
  return Array.from(sims.keys()).sort((a, b) => sims[b] - sims[a] || a - b).slice(0, k).map((index) => ({ index, sim: sims[index] }));
}

async function fetchSvgs(smiles: string[], signal: AbortSignal): Promise<string[]> {
  if (!smiles.length) return [];
  const out = await chemCall<{ mols: { name: string; svg: string }[] }>('process', {
    items: smiles.map((s, i) => ({ name: String(i), smiles: s })), radius: RADIUS, nBits: BITS, light: false,
  }, { signal });
  const by = new Map(out.mols.map((m) => [m.name, m.svg]));
  return smiles.map((_, i) => by.get(String(i)) ?? '');
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Diagnostic hook for e2e/gpu/simsearch.spec.ts; installed only with ?simParity=1. */
type Parity = { gpu: boolean; n: number; maxDiff: number; topSame: boolean; values: number[] };
function useParityHook() {
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('simParity')) return;
    const w = window as unknown as { __ncSimParity?: () => Promise<Parity> };
    w.__ncSimParity = async () => {
      const parsed = await chemCall<{ mols: { name: string; fp: Uint32Array }[] }>('process', {
        items: REFERENCE.map(([name, smiles]) => ({ name, smiles })), radius: RADIUS, nBits: BITS, light: true,
      });
      const fps = parsed.mols.map((m) => m.fp);
      const values: number[] = [];
      for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) values.push(tanimotoCpu(fps[i], 0, fps[j], 0));
      const rnd = mulberry32(20261026);
      const n = 5000;
      const db = new Uint32Array(n * WORDS);
      for (let m = 0; m < n; m++) for (let b = 0; b < BITS; b++) if (rnd() < 0.1) db[m * WORDS + (b >> 5)] |= 1 << (b & 31);
      const query = new Uint32Array(WORDS);
      for (let b = 0; b < BITS; b++) if (rnd() < 0.1) query[b >> 5] |= 1 << (b & 31);
      const g = await gpuTanimoto(db, query);
      if (!g) return { gpu: false, n, maxDiff: -1, topSame: false, values };
      let maxDiff = 0;
      for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(g.sims[i] - tanimotoCpu(query, 0, db, i)));
      const cpuTop = topK(query, db, 10).map((x) => x.index);
      const gpuTop = rankSims(g.sims, 10).map((x) => x.index);
      return { gpu: true, n, maxDiff, topSame: cpuTop.every((v, i) => v === gpuTop[i]), values };
    };
    return () => { delete w.__ncSimParity; };
  }, []);
}

const MolSvg = ({ svg }: { svg: string }) => (
  <div style={{ width: 104, height: 76, background: '#fff', borderRadius: 6, display: 'grid', placeItems: 'center', overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: svg }} />
);

export default function SimSearchView() {
  useParityHook();
  const [text, setText] = useState(EXAMPLE);
  const [library, setLibrary] = useState<LibMol[]>([]);
  const [failed, setFailed] = useState<Row[]>([]);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [clusters, setClusters] = useState<ClusterRun | null>(null);
  const [q, setQ] = useState('CC(=O)OC1=CC=CC=C1C(=O)O');
  const [qsvg, setQsvg] = useState('');
  const [k, setK] = useState('10');
  const [cutoff, setCutoff] = useState(0.4);
  const [engine, setEngine] = useState<'gpu' | 'cpu'>('cpu');
  const [ms, setMs] = useState<number | null>(null);
  const [tier, setTier] = useState<Tier>('cpu-threads');
  const [device, setDevice] = useState('detecting…');
  const [gpuUsable, setGpuUsable] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const { run, busy, progress, note, error, cancel, setError } = useRunner();
  const recommend = recommendedLimits(tier).simsearchMolecules;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const det = await detectGpuDetailed();
      rememberGpu(det);
      const d = detectDevice(undefined, undefined, det);
      if (!alive) return;
      setTier(classifyDevice(d).tier);
      const usable = !!det.info && !det.info.fallback;
      setGpuUsable(usable);
      setDevice(usable && det.info ? `GPU: ${det.info.vendor} ${det.info.architecture || det.info.description}`.trim() : `CPU: ${d.threads} threads`);
    })();
    return () => { alive = false; };
  }, []);

  const parse = () => {
    const items = parseRows(text);
    if (!items.length) { setError('No SMILES found. Paste one SMILES per line, optionally after a name separated by a comma or space.'); return; }
    void run<{ mols: LibMol[]; failed: Row[]; stripped: number; dupes: number }>({
      label: `Parse & fingerprint · ${items.length} molecules`, tool: PARSE_TOOL, params: { n: items.length },
      inputs: [{ name: 'molecules', data: text }],
      run: async (h) => chemCall('process', { items, radius: RADIUS, nBits: BITS, light: true }, { onProgress: h.onProgress, signal: h.signal }),
    }).then((out) => {
      if (!out) return;
      setLibrary(out.mols.map((m) => ({ name: m.name, smiles: m.smiles, canon: m.canon, fp: m.fp })));
      setFailed(out.failed); setHits(null); setClusters(null); setQsvg(''); setFallback(null); setMs(null);
    });
  };

  const search = () => {
    if (!library.length || !q.trim()) return;
    const kk = Math.max(1, Math.min(50, Math.round(Number(k) || 10)));
    const db = pack(library);
    void run<Hit[]>({
      label: `Tanimoto · ${library.length} molecules`, tool: SEARCH_TOOL,
      params: { n: library.length, k: kk, radius: RADIUS, bits: BITS, engine: gpuUsable && library.length <= recommend ? 'gpu' : 'cpu' },
      inputs: [{ name: 'query', data: q.trim() }, { name: 'library', data: library.map((m) => m.canon).join('\n') }],
      run: async (h) => {
        const t0 = performance.now();
        const qr = await chemCall<{ fp: Uint32Array; svg: string }>('fp', { smiles: q.trim(), radius: RADIUS, nBits: BITS }, { signal: h.signal });
        setQsvg(qr.svg);
        let sims: Float32Array | null = null, used: 'gpu' | 'cpu' = 'cpu';
        if (gpuUsable) {
          h.onProgress(0.05, 'GPU comparison');
          try {
            const g = await gpuTanimoto(db, qr.fp, (p) => h.onProgress(0.05 + 0.8 * p, 'GPU comparison'));
            if (g) { sims = g.sims; used = 'gpu'; }
          } catch { setFallback('The GPU path was unavailable, so the CPU computed the same comparison.'); }
        }
        h.onProgress(0.9, used === 'gpu' ? 'Selecting top hits' : 'CPU comparison');
        await new Promise((r) => setTimeout(r, used === 'gpu' ? 0 : 20));
        const picks = sims ? rankSims(sims, kk) : topK(qr.fp, db, kk);
        const svgs = await fetchSvgs(picks.map((p) => library[p.index].smiles), h.signal);
        setEngine(used); setMs(performance.now() - t0);
        return picks.map((p, i) => ({ mol: library[p.index], sim: p.sim, svg: svgs[i] ?? '' }));
      },
    }).then((r) => r && setHits(r));
  };

  const cluster = () => {
    const n = library.length;
    if (n > MAX_BUTINA) { setError(`Butina clustering is limited to ${MAX_BUTINA.toLocaleString()} molecules in the browser because it compares every pair; this library has ${n.toLocaleString()}.`); return; }
    const db = pack(library);
    const cut = Math.max(0, Math.min(1, cutoff));
    void run<ClusterRun>({
      label: `Butina · ${n} molecules`, tool: CLUSTER_TOOL,
      params: { n, cutoff: cut, engine: gpuUsable && butinaFitsGpu(n, {}) ? 'gpu' : 'cpu' },
      inputs: [{ name: 'library', data: library.map((m) => m.canon).join('\n') }],
      run: async (h) => {
        const t0 = performance.now();
        let res: ButinaResult | null = null, used: 'gpu' | 'cpu' = 'cpu';
        if (gpuUsable && butinaFitsGpu(n, {})) {
          h.onProgress(0.03, 'GPU neighbour bitmap');
          try {
            const g = await gpuButina(db, n, cut, (p) => h.onProgress(0.05 + 0.8 * p, 'GPU neighbour bitmap'));
            if (g) { res = g; used = 'gpu'; }
          } catch { setFallback('The GPU path was unavailable, so the CPU built the same neighbour lists.'); }
        }
        if (!res) {
          h.onProgress(0.15, n > 3000 ? 'CPU all-pairs clustering (slow)' : 'CPU neighbour lists');
          await new Promise((r) => setTimeout(r, 20));
          res = butina(db, n, cut); used = 'cpu';
          h.onProgress(0.95, 'CPU clustering');
        }
        const elapsed = performance.now() - t0;
        setMs(elapsed);
        return { res, used, ms: elapsed, cutoff: cut };
      },
    }).then((r) => r && setClusters(r));
  };

  const clusterRows = (() => {
    if (!clusters) return [];
    const by = new Map<number, number[]>();
    clusters.res.cluster.forEach((c, i) => { const a = by.get(c) ?? []; a.push(i); by.set(c, a); });
    return clusters.res.centroids.map((c, id) => {
      const members = by.get(id) ?? [];
      return { id, size: members.length, centroid: library[c]?.name ?? `#${c}`, members: members.slice(0, 6).map((i) => library[i]?.name ?? `#${i}`).join(', ') + (members.length > 6 ? ` +${members.length - 6}` : '') };
    });
  })();

  return (
    <div className="stack">
      <Card title="Library" sub="SMILES, one per line (optional name); a CSV with a smiles column also works" actions={<button className="btn primary sm" disabled={busy || !text.trim()} onClick={parse}>Parse & fingerprint</button>}>
        <div className="stack" style={{ gap: 10 }}>
          <textarea className="input mono" rows={8} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} style={{ fontSize: 12 }} />
          <FileDrop accept=".smi,.csv,.tsv,.txt" onText={(t) => setText(t)} label="Drop a .smi / .csv file" />
          <div className="row"><button className="btn sm" disabled={busy} onClick={() => setText(EXAMPLE)}>Load example (10 drugs)</button><span className="faint" style={{ fontSize: 12 }}>{device}</span></div>
          {busy && <><Busy progress={progress} note={note} /><button className="btn sm" onClick={cancel}>Cancel</button></>}
          {error && <Callout kind="err">{error}</Callout>}
          {failed.length > 0 && <Callout kind="warn">{failed.length} SMILES could not be parsed: {failed.slice(0, 3).map((f) => f.name).join(', ')}{failed.length > 3 ? '…' : ''}</Callout>}
          {library.length > 0 && <div className="cols-2" style={{ gap: 10 }}><Stat label="Molecules" value={library.length} /><Stat label="Engine used" value={engine === 'gpu' ? 'GPU' : 'CPU'} hint={ms !== null ? `${Math.round(ms)} ms for the last run` : undefined} /></div>}
        </div>
      </Card>

      <Card title="Query" sub="Morgan radius 2, 2048 bits, Tanimoto similarity">
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 220 }}><Field label="Query SMILES"><input className="input mono" value={q} onChange={(e) => setQ(e.target.value)} /></Field></div>
            <div style={{ width: 92 }}><Field label="Top K"><input className="input" type="number" min={1} max={50} value={k} onChange={(e) => setK(e.target.value)} /></Field></div>
            <button className="btn primary" disabled={busy || !library.length || !q.trim()} onClick={search}>Search</button>
          </div>
          <div className="row" style={{ gap: 12 }}>
            {qsvg && <MolSvg svg={qsvg} />}
            <div className="faint" style={{ fontSize: 12 }}>{library.length ? `${library.length.toLocaleString()} molecules are fingerprinted and ready.` : 'Parse a library first.'}</div>
          </div>
          {fallback && <Callout kind="warn">{fallback}</Callout>}
        </div>
      </Card>

      <Callout>
        <div>Similarity depends on the fingerprint (Morgan radius 2, 2048 bits). Parsing molecules is the slow part; the GPU speeds up the comparison step.</div>
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Uses your graphics card through WebGPU when your browser supports it, and falls back to your CPU when it does not. Your data stays on your device. Results are research-grade, not clinical or diagnostic.</div>
      </Callout>

      {library.length > recommend && <Callout kind="warn">Your hardware tier ({tier}) is rated for about {recommend.toLocaleString()} molecules. This library has {library.length.toLocaleString()} and may take more than a minute to compare.</Callout>}
      {library.length > MAX_BUTINA && <Callout kind="warn">Butina clustering is limited to {MAX_BUTINA.toLocaleString()} molecules because it compares every pair; similarity search still works on the whole library.</Callout>}

      {hits && <Card title="Top hits" sub={`${hits.length} shown · ${engine.toUpperCase()}${ms !== null ? ` · ${Math.round(ms)} ms` : ''}`} pad={false}>
        <DataTable rows={hits} rowKey={(r) => r.mol.canon} limit={50} cols={[
          { key: 'svg', label: 'Structure', render: (r) => (r.svg ? <MolSvg svg={r.svg} /> : <span className="faint">–</span>) },
          { key: 'name', label: 'Compound', render: (r) => r.mol.name },
          { key: 'sim', label: 'Tanimoto', num: true, render: (r) => fmt(r.sim, 3), sort: (r) => r.sim },
          { key: 'smi', label: 'SMILES', render: (r) => <span className="mono" style={{ fontSize: 11 }}>{r.mol.canon}</span> },
        ]} />
      </Card>}

      <Card title="Butina clusters" sub="Taylor–Butina on Tanimoto distance" actions={<button className="btn" disabled={busy || library.length < 2 || library.length > MAX_BUTINA} onClick={cluster}>Cluster (Butina)</button>}>
        <div className="stack" style={{ gap: 10 }}>
          <Field label={`Distance cutoff ${cutoff.toFixed(2)} — pairs with similarity ≥ ${(1 - cutoff).toFixed(2)} are neighbours`}>
            <input type="range" min={0.1} max={0.9} step={0.05} value={cutoff} style={{ width: '100%' }} onChange={(e) => setCutoff(+e.target.value)} />
          </Field>
          {clusters && <>
            <div className="cols-2" style={{ gap: 10 }}>
              <Stat label="Clusters" value={clusters.res.centroids.length} />
              <Stat label="Singletons" value={clusters.res.sizes.filter((s) => s === 1).length} hint={`${clusters.used.toUpperCase()} · ${Math.round(clusters.ms)} ms`} />
            </div>
            <div className="faint" style={{ fontSize: 12 }}>Each centroid is the molecule with the most unassigned neighbours at its turn; ties go to the lowest index. This is a greedy heuristic, not a globally optimal partition.</div>
            <DataTable rows={clusterRows} rowKey={(r) => String(r.id)} limit={200} cols={[
              { key: 'id', label: 'Cluster', num: true, render: (r) => r.id + 1 },
              { key: 'size', label: 'Size', num: true, render: (r) => r.size, sort: (r) => r.size },
              { key: 'centroid', label: 'Centroid', render: (r) => r.centroid },
              { key: 'members', label: 'Members', render: (r) => r.members },
            ]} />
          </>}
        </div>
      </Card>
    </div>
  );
}
