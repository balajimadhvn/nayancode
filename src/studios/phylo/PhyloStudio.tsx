import { useMemo, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, Field, FileDrop, Stat, Tabs, downloadText, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { Histogram, cssVar } from '@/viz/charts';
import { buildMsa, buildTree } from '@/viz/figure';
import { ExportBar } from '@/viz/FigureExport';
import { MatrixHeat, MsaView, TreeView } from '@/viz/more';
import { detectAlphabet, parseFasta, toDNA } from '../sequence/kernels';
import { parseNewick, supportFromTrees, syntheticFamily, toNewick, type DistModel, type TreeNode } from './kernels';
import type { MlStats, PhyloKernels } from './phylo.worker';
import type { MlModel } from './ml';

const spawn = () => new Worker(new URL('./phylo.worker.ts', import.meta.url), { type: 'module' });
const remote = createRemote<PhyloKernels>(spawn);
const cores = () => Math.max(1, Math.min(8, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1);

/** ML bootstrap spread over parallel workers (one per spare CPU core); the replicate trees are pooled for support. */
async function parallelMlBootstrap(job: { names: string[]; aligned: string[]; model: MlModel; gamma: boolean; alpha: number | null; kappa: number | null }, reps: number, onProgress: (done: number) => void, signal?: AbortSignal): Promise<TreeNode[]> {
  const n = Math.min(cores(), reps), workers = Array.from({ length: n }, spawn), done = new Array(n).fill(0);
  const stop = () => workers.forEach((w) => w.terminate()); signal?.addEventListener('abort', stop);
  try {
    const shares = workers.map((w, i) => {
      const r = createRemote<PhyloKernels>(() => w), share = Math.floor(reps / n) + (i < reps % n ? 1 : 0);
      return r.mlReplicates({ ...job, reps: share, seed: 1000 + i * 7919 }, { signal, onProgress: (f) => { done[i] = Math.round(f * share); onProgress(done.reduce((a, b) => a + b, 0)); } });
    });
    return (await Promise.all(shares)).flat().map((nw) => parseNewick(nw));
  } finally { stop(); signal?.removeEventListener('abort', stop); }
}
const V = '0.1.0', ENGINE = 'TypeScript worker kernels (clean-room)';
const TOOLS: Record<string, ToolInfo> = {
  msa: { id: 'phylo.msa', name: 'Progressive multiple sequence alignment', version: V, engine: ENGINE, citations: ['gotoh1982', 'henikoff1992'], describe: (p) => `Multiple sequence alignment of ${p.n} ${p.kind} sequences was built progressively along a k-mer-distance UPGMA guide tree using affine-gap profile alignment${p.kind === 'protein' ? ' with the BLOSUM62 matrix' : ''}` },
  tree: { id: 'phylo.tree', name: 'Phylogenetic tree inference', version: V, engine: ENGINE, citations: ['saitou1987', 'felsenstein1985', 'felsenstein1981', 'hasegawa1985', 'yang1994'], describe: (p) => p.method === 'ml' ? `A maximum-likelihood tree was inferred under ${p.mlModel}${p.gamma ? '+Γ4' : ''} by Felsenstein pruning with branch-length optimisation and nearest-neighbour-interchange search from a neighbour-joining start${p.reps ? `; branch support was estimated from ${p.reps} non-parametric bootstrap replicates, each searched from its own neighbour-joining tree` : ''}${p.root === 'midpoint' ? '; the tree was midpoint-rooted' : ''}` : `A ${p.method === 'nj' ? 'neighbour-joining' : 'UPGMA'} tree was inferred from ${p.model} distances${p.reps ? ` with ${p.reps} bootstrap replicates` : ''}${p.root === 'midpoint' ? ' and midpoint-rooted' : ''}` },
};

type Tab = 'input' | 'msa' | 'tree' | 'matrix';
export default function PhyloStudio() {
  const [text, setText] = useState(''), [tab, setTab] = useState<Tab>('input');
  const [msa, setMsa] = useState<Awaited<ReturnType<PhyloKernels['msa']>> | null>(null), [newick, setNewick] = useState('');
  const [model, setModel] = useState<DistModel>('poisson'), [method, setMethod] = useState<'nj' | 'upgma' | 'ml'>('nj'), [mlModel, setMlModel] = useState<MlModel>('HKY85'), [gamma, setGamma] = useState(true), [ml, setMl] = useState<MlStats | null>(null), [reps, setReps] = useState(50), [phylogram, setPhylogram] = useState(true), [minSup, setMinSup] = useState(0);
  const recs = useMemo(() => (text.trim() ? parseFasta(text.trim().startsWith('>') ? text : '>seq\n' + text) : []), [text]);
  const kind: 'dna' | 'protein' = recs.length && detectAlphabet(recs[0].seq) === 'protein' ? 'protein' : 'dna';
  const alnLike = recs.length > 1 && new Set(recs.map((r) => r.seq.length)).size === 1 && text.includes('-');
  const a = useRunner(), b = useRunner();
  const tree = useMemo<TreeNode | null>(() => { try { return newick ? parseNewick(newick) : null; } catch { return null; } }, [newick]);
  const load = (t: string) => { setText(t); setMsa(null); setNewick(''); setTab('input'); };
  const runMsa = () => void a.run({ label: `MSA · ${recs.length} sequences`, tool: TOOLS.msa, params: { n: recs.length, kind }, inputs: [{ name: 'sequences', data: text }], run: (h) => remote.msa({ names: recs.map((r) => r.id), seqs: recs.map((r) => (kind === 'dna' ? toDNA(r.seq) : r.seq)), kind }, h) }).then((r) => { if (r) { setMsa(r); setNewick(''); setTab('msa'); } });
  const names = msa?.names ?? recs.map((r) => r.id), alns = msa?.aligned ?? (alnLike ? recs.map((r) => r.seq) : null);
  const runTree = () => alns && void b.run({ label: `Tree · ${method.toUpperCase()}`, tool: TOOLS.tree, params: { model, method, reps, root: 'midpoint', mlModel: kind === 'protein' ? 'Poisson' : mlModel, gamma }, inputs: [{ name: 'alignment', data: alns.join('\n') }], run: async (h) => {
    const mlm: MlModel = kind === 'protein' ? 'Poisson' : mlModel;
    if (method !== 'ml' || !reps) return remote.tree({ names, aligned: alns, model, method, reps, root: 'midpoint', ml: { model: mlm, gamma } }, h);
    const main = await remote.tree({ names, aligned: alns, model, method, reps: 0, root: 'midpoint', ml: { model: mlm, gamma } }, { signal: h.signal, onProgress: (f, n) => h.onProgress(0.4 * f, n) });
    const trees = await parallelMlBootstrap({ names, aligned: alns, model: mlm, gamma, alpha: main.ml?.alpha ?? null, kappa: main.ml?.kappa ?? null }, reps, (d) => h.onProgress(0.4 + 0.6 * (d / reps), `Bootstrap ${d}/${reps} on ${Math.min(cores(), reps)} cores`), h.signal);
    return { ...main, newick: toNewick(supportFromTrees(parseNewick(main.newick), names, trees)), supported: true };
  } }).then((r) => { if (r) { setNewick(r.newick); setMl(r.ml ?? null); setTab('tree'); } });
  const idMat = msa?.identity;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Alignment & Phylogenetics</h1><p>Align sequences, inspect conservation, infer trees with bootstrap support and export publication figures. Clean-room algorithms, no GPL code, all local.</p></div></div>
      <div className="split">
        <div className="stack">
          <Card title="1 · Sequences" sub="unaligned or aligned FASTA">
            <div className="stack" style={{ gap: 10 }}>
              <textarea className="input" spellCheck={false} value={text} onChange={(e) => load(e.target.value)} placeholder=">seq1&#10;MKT…" />
              <FileDrop accept=".fa,.fasta,.faa,.fna,.aln,.txt" onText={load} label="Drop a FASTA / aligned FASTA" />
              <div className="row"><button className="btn" onClick={() => load(syntheticFamily(3, 12, 260))}>Demo: 12-protein family</button><button className="btn ghost" onClick={() => load('')}>Clear</button></div>
              {recs.length > 0 && <div className="faint" style={{ fontSize: 12 }}>{recs.length} sequences · {kind} · lengths {Math.min(...recs.map((r) => r.seq.length))}–{Math.max(...recs.map((r) => r.seq.length))}{alnLike ? ' · looks aligned' : ''}</div>}
            </div>
          </Card>
          <Card title="2 · Align">
            <div className="stack" style={{ gap: 10 }}>
              <button className="btn primary" disabled={recs.length < 2 || a.busy} onClick={runMsa}>Run progressive alignment</button>
              {a.busy && <><Busy progress={a.progress} note={a.note} /><button className="btn sm" onClick={a.cancel}>Cancel</button></>}
              {a.error && <Callout kind="err">{a.error}</Callout>}
              <div className="faint" style={{ fontSize: 11.5 }}>Limits: 300 sequences, ~3,000 columns. For larger sets, align with MAFFT or MUSCLE on your computer and load the aligned FASTA here.</div>
            </div>
          </Card>
          <Card title="3 · Tree">
            <div className="stack" style={{ gap: 10 }}>
              <div className="cols-2" style={{ gap: 8 }}>
                <Field label="Method"><select className="select" value={method} onChange={(e) => setMethod(e.target.value as 'nj' | 'upgma' | 'ml')}><option value="nj">Neighbour-joining</option><option value="upgma">UPGMA</option><option value="ml">Maximum likelihood (NJ start + NNI)</option></select></Field>
                <Field label="Distance"><select className="select" value={model} onChange={(e) => setModel(e.target.value as DistModel)}>{kind === 'protein' ? <><option value="poisson">Poisson</option><option value="p">p-distance</option></> : <><option value="jc">Jukes–Cantor</option><option value="k2p">Kimura 2P</option><option value="p">p-distance</option></>}</select></Field>
              </div>
              {method === 'ml' && <div className="cols-2" style={{ gap: 8 }}><Field label="Substitution model"><select className="select" value={kind === 'protein' ? 'Poisson' : mlModel} disabled={kind === 'protein'} onChange={(e) => setMlModel(e.target.value as MlModel)}>{kind === 'protein' ? <option value="Poisson">Poisson (equal rates)</option> : <><option value="JC69">JC69</option><option value="K80">K80 (κ)</option><option value="HKY85">HKY85 (κ + base freqs)</option></>}</select></Field><label className="row dim" style={{ fontSize: 12.5, alignSelf: 'end' }}><input type="checkbox" checked={gamma} onChange={(e) => setGamma(e.target.checked)} /> +Γ (4 rate classes)</label></div>}
              <Field label={`Bootstrap replicates: ${reps}${method === 'ml' && reps ? ` (ML, in parallel on ${Math.min(cores(), reps)} cores)` : ''}`}><input type="range" min={0} max={method === 'ml' ? 100 : 200} step={10} value={reps} onChange={(e) => setReps(+e.target.value)} /></Field>
              <button className="btn primary" disabled={!alns || b.busy} onClick={runTree}>Build tree</button>
              {b.busy && <><Busy progress={b.progress} note={b.note} /><button className="btn sm" onClick={b.cancel}>Cancel</button></>}
              {b.error && <Callout kind="err">{b.error}</Callout>}
              {!alns && <div className="faint" style={{ fontSize: 12 }}>Align first, or load an already-aligned FASTA.</div>}
            </div>
          </Card>
          <Callout>Maximum likelihood handles up to 150 sequences: NNI hill-climbing from the neighbour-joining tree, with bootstrap replicates spread over your CPU cores. Rough cost per replicate: ~0.3 s for 12 sequences, ~3 s for 30. The search is local (NNI only), so for large or difficult data sets confirm the topology with IQ-TREE or RAxML-NG; their Newick output can be pasted below.</Callout>
        </div>
        <div className="stack">
          {recs.length === 0 && !newick ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load sequences or the demo family to start.</div></Card> : <>
            <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'input', label: 'Sequences' }, { id: 'msa', label: 'Alignment' }, { id: 'tree', label: 'Tree' }, { id: 'matrix', label: 'Identity' }]} />
            {tab === 'input' && <Card title="Records" pad={false}><div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="t"><thead><tr><th>ID</th><th className="num">Length</th><th>Start</th></tr></thead><tbody>{recs.map((r) => <tr key={r.id}><td>{r.id}</td><td className="num">{r.seq.length}</td><td><code>{r.seq.slice(0, 40)}…</code></td></tr>)}</tbody></table></div></Card>}
            {tab === 'msa' && (alns ? <>
              {msa && <div className="cols-4"><Stat label="Sequences" value={names.length} /><Stat label="Columns" value={msa.columns} /><Stat label="Mean identity" value={`${fmt(msa.cons.meanIdentity * 100, 1)}%`} /><Stat label="Fully conserved" value={msa.cons.identity.filter((v) => v >= 0.999).length} /></div>}
              <Card title="Alignment" sub="bars = conservation (1 − normalised entropy)" actions={<><button className="btn sm" onClick={() => downloadText('alignment.fasta', names.map((n, i) => `>${n}\n${alns[i]}`).join('\n') + '\n')}>Export FASTA</button><ExportBar name="alignment" defaults={{ xLabel: '', yLabel: '' }} build={(o) => buildMsa({ names, seqs: alns, type: kind }, o)} /></>}>
                <MsaView names={names} aln={alns} kind={kind} entropy={msa?.cons.entropy ?? alns[0].split('').map(() => 0.5)} consensus={msa?.cons.consensus ?? ''} /></Card>
              {msa && <Card title="Conservation profile"><Histogram values={msa.cons.entropy} bins={20} label="column conservation (0 = variable, 1 = invariant)" /></Card>}
            </> : <Callout>Run the alignment first.</Callout>)}
            {tab === 'tree' && (<>
              <Card title="Tree" sub={tree ? `${names.length} tips${reps ? ` · bootstrap ${reps}` : ''}` : ''} actions={<><label className="row dim" style={{ fontSize: 12 }}><input type="checkbox" checked={phylogram} onChange={(e) => setPhylogram(e.target.checked)} /> branch lengths</label><label className="row dim" style={{ fontSize: 12 }}>min support <input type="range" min={0} max={100} step={10} value={minSup} onChange={(e) => setMinSup(+e.target.value)} /> {minSup}</label>{newick && <button className="btn sm" onClick={() => downloadText('tree.nwk', newick + '\n')}>Newick</button>}{tree && <ExportBar name="tree" defaults={{ xLabel: '', yLabel: '' }} build={(o) => buildTree({ newick: toNewick(tree), showSupport: minSup < 100, showScale: true }, o)} />}</>}>
                {ml && <div className="cols-4" style={{ marginBottom: 12 }}><Stat label="Model" value={<span style={{ fontSize: 15 }}>{ml.model}</span>} /><Stat label="log-likelihood" value={fmt(ml.logL, 1)} /><Stat label="AIC" value={fmt(ml.aic, 1)} hint={`${ml.k} free parameters`} /><Stat label="BIC" value={fmt(ml.bic, 1)} /></div>}
                {tree ? <TreeView tree={tree} phylogram={phylogram} minSupport={minSup} /> : <div className="faint">Build a tree, or paste Newick below.</div>}
                <div className="row" style={{ marginTop: 10 }}><span className="legend"><span style={{ color: cssVar('--accent-3') }}>● ≥90</span><span style={{ color: cssVar('--warn') }}>● 70–89</span><span>● &lt;70 bootstrap %</span></span></div>
              </Card>
              <Card title="Paste a Newick tree" sub="from IQ-TREE, RAxML, FastTree…"><textarea className="input" spellCheck={false} value={newick} onChange={(e) => setNewick(e.target.value)} style={{ minHeight: 70 }} />{newick && !tree && <Callout kind="err">Could not parse this Newick string.</Callout>}{tree && <div className="faint mono" style={{ fontSize: 11, marginTop: 6, wordBreak: 'break-all' }}>{toNewick(tree).slice(0, 220)}…</div>}</Card>
            </>)}
            {tab === 'matrix' && (idMat ? <Card title="Pairwise identity" sub="over co-aligned residues"><MatrixHeat labels={names} m={idMat} min={Math.min(...idMat.flat())} max={1} fmt={(v) => `${Math.round(v * 100)}`} cell={names.length > 14 ? 26 : 38} /></Card> : <Callout>Run the alignment to see pairwise identity.</Callout>)}
          </>}
        </div>
      </div>
    </div>
  );
}
