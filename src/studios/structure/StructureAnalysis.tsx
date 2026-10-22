import { useEffect, useMemo, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import { trackedFetch } from '@/core/net';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { BarChart, Histogram, LineChart, cssVar } from '@/viz/charts';
import type { StructureKernels } from './structure.worker';
import { StructureUtils } from './StructureUtils';

const remote = createRemote<StructureKernels>(() => new Worker(new URL('./structure.worker.ts', import.meta.url), { type: 'module' }));
export interface Src { text: string; label: string }
export interface ResRef { chain: string; seq: number }
const V = '0.2.0', ENG = 'TypeScript worker kernels (clean-room, geometric criteria)';
const T = (id: string, name: string, describe: ToolInfo['describe'], citations: string[] = []): ToolInfo => ({ id, name, version: V, engine: ENG, citations, describe });
const TOOLS = {
  inter: T('structure.interactions', 'Protein–ligand interaction profiling', (p) => `Non-covalent protein–ligand interactions for ${p.ligand} were profiled from heavy-atom geometry: hydrogen bonds (D···A 2.5–3.5 Å), hydrophobic contacts (≤ 4.0 Å), salt bridges (≤ 5.0 Å), π-stacking, π-cation (≤ 6.0 Å), halogen bonds (≤ 3.5 Å, ≥ 140°), metal coordination (≤ 2.8 Å) and water bridges`),
  pockets: T('structure.pockets', 'Binding-pocket detection', () => 'Buried cavities were detected with a LIGSITE-style grid method (1 Å grid, protein–solvent–protein events along 7 directions, ≥ 6 events, 26-connected clustering) and ranked by volume and buriedness', ['hendlich1997']),
  sasa: T('structure.sasa', 'Solvent accessible surface area', () => 'Solvent-accessible surface area was calculated with the Shrake–Rupley algorithm (1.4 Å probe, Bondi radii, 128 points per atom); relative accessibility used Miller et al. (1987) maximum values', ['shrake1973']),
  compare: T('structure.compare', 'Structure superposition', (p) => `Chains were paired by local sequence alignment (BLOSUM62) and superposed on Cα atoms with the Kabsch/Horn method with 3σ outlier rejection (${p.paired} residues); TM-score used d0 = 1.24(L−15)^(1/3) − 1.8`, ['kabsch1976', 'horn1987', 'zhang2004']),
};
type Tab = 'interactions' | 'pockets' | 'sasa' | 'compare' | 'tools';
const TYPE_COLOR: Record<string, string> = { 'hydrogen bond': 'live', hydrophobic: 'planned', 'salt bridge': 'building', 'pi-stacking': 'live', 'pi-cation': 'building', 'halogen bond': 'live', 'metal coordination': 'building', 'water bridge': 'planned' };

export function StructureAnalysis({ src, onFocus, onShowSuperposition }: { src: Src | null; onFocus(list: ResRef[]): void; onShowSuperposition(a: string, bPdb: string): void }) {
  const [tab, setTab] = useState<Tab>('interactions');
  const meta = useRunner(); const [info, setInfo] = useState<Awaited<ReturnType<typeof remote.ligands>> | null>(null), [lig, setLig] = useState('');
  useEffect(() => { setInfo(null); if (!src) return; void meta.run({ label: `Inspect ${src.label}`, tool: TOOLS.sasa, params: {}, inputs: [], run: () => remote.ligands({ text: src.text }), summary: () => 'The structure was parsed' }).then((r) => { if (r) { setInfo(r); setLig(r.ligands[0]?.key ?? ''); } }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [src]);
  if (!src) return <Callout>Load a structure above to analyse interactions, pockets, solvent accessibility and superpositions. All calculations run locally on the coordinates.</Callout>;
  return (
    <Card title="Structure analysis" sub={info ? `${info.atoms.toLocaleString()} atoms · ${info.chains.length} protein chain(s) · ${info.ligands.length} ligand(s)` : 'parsing…'}>
      {meta.error && <Callout kind="err">{meta.error}</Callout>}
      <div className="stack" style={{ gap: 14 }}>
        <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'interactions', label: 'Interactions' }, { id: 'pockets', label: 'Pockets' }, { id: 'sasa', label: 'Solvent accessibility' }, { id: 'compare', label: 'Compare / superpose' }, { id: 'tools', label: 'Analysis tools' }]} />
        {info && tab === 'interactions' && <Interactions src={src} info={info} lig={lig} setLig={setLig} onFocus={onFocus} />}
        {info && tab === 'pockets' && <Pockets src={src} lig={lig} info={info} onFocus={onFocus} />}
        {info && tab === 'sasa' && <Sasa src={src} />}
        {info && tab === 'compare' && <Compare src={src} info={info} onShow={onShowSuperposition} />}
        {info && tab === 'tools' && <StructureUtils src={src} />}
      </div>
    </Card>
  );
}
type Info = Awaited<ReturnType<typeof remote.ligands>>;

function Interactions({ src, info, lig, setLig, onFocus }: { src: Src; info: Info; lig: string; setLig(v: string): void; onFocus(l: ResRef[]): void }) {
  const { run, busy, error } = useRunner(); const [res, setRes] = useState<Awaited<ReturnType<typeof remote.interactions>> | null>(null);
  useEffect(() => setRes(null), [src, lig]);
  if (!info.ligands.length) return <Callout>No drug-like ligand found in this structure (waters, ions and common crystallisation additives are ignored). Load a protein–ligand complex such as 1HSG.</Callout>;
  const go = () => void run({ label: `Interactions · ${lig}`, tool: TOOLS.inter, params: { ligand: lig }, inputs: [], run: () => remote.interactions({ text: src.text, ligandKey: lig }) }).then((r) => r && setRes(r));
  const counts = res ? res.interactions.reduce<Record<string, number>>((m, i) => ((m[i.type] = (m[i.type] ?? 0) + 1), m), {}) : {};
  return (<>
    <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Ligand"><select className="select" value={lig} onChange={(e) => setLig(e.target.value)}>{info.ligands.map((l) => <option key={l.key} value={l.key}>{l.res} · chain {l.chain} {l.seq} · {l.heavy} heavy atoms</option>)}</select></Field><button className="btn primary" disabled={busy} onClick={go}>Profile interactions</button>{res && <button className="btn" onClick={() => onFocus([...new Map(res.interactions.map((i) => [`${i.chain}${i.seq}`, { chain: i.chain, seq: i.seq }])).values()])}>Show contacts in 3D</button>}</div>
    {error && <Callout kind="err">{error}</Callout>}
    {res && <>
      <div className="row" style={{ gap: 8 }}>{Object.entries(counts).map(([t, n]) => <span key={t} className={`badge ${TYPE_COLOR[t] ?? ''}`}>{t} · {n}</span>)}{!res.interactions.length && <span className="faint">no interactions found</span>}</div>
      <DataTable rows={res.interactions} rowKey={(r, i) => `${r.type}${r.ligAtom}${r.chain}${r.seq}${r.protAtom}${i}`} onRow={(r) => onFocus([{ chain: r.chain, seq: r.seq }])} cols={[{ key: 'type', label: 'Type', sort: (r) => r.type, render: (r) => <span className={`badge ${TYPE_COLOR[r.type] ?? ''}`}>{r.type}</span> }, { key: 'lig', label: 'Ligand atom', render: (r) => r.ligAtom }, { key: 'res', label: 'Protein residue', sort: (r) => r.seq, render: (r) => `${r.protRes} ${r.seq} (${r.chain})` }, { key: 'atom', label: 'Atom', render: (r) => r.protAtom }, { key: 'd', label: 'Distance (Å)', num: true, sort: (r) => r.distance, render: (r) => fmt(r.distance, 2) }, { key: 'detail', label: 'Detail', render: (r) => <span className="dim">{r.detail ?? ''}</span> }]} />
      <div className="row"><button className="btn sm" onClick={() => downloadText('interactions.csv', toCsv(res.interactions), 'text/csv')}>CSV</button><span className="faint" style={{ fontSize: 12 }}>Heavy-atom geometry only (hydrogens are not placed); donors/acceptors on the ligand are inferred from N/O. Click a row to focus the residue in 3D.</span></div>
    </>}
  </>);
}

function Pockets({ src, lig, info, onFocus }: { src: Src; lig: string; info: Info; onFocus(l: ResRef[]): void }) {
  const { run, busy, progress, note, error } = useRunner(); const [res, setRes] = useState<Awaited<ReturnType<typeof remote.pockets>> | null>(null);
  useEffect(() => setRes(null), [src]);
  const go = () => void run({ label: 'Pocket detection', tool: TOOLS.pockets, params: {}, inputs: [], run: (h) => remote.pockets({ text: src.text, ligandKey: info.ligands.length ? lig : undefined }, h) }).then((r) => r && setRes(r));
  const dists = res?.ligandCentroid ? res.pockets.map((p) => Math.hypot(p.center.x - res.ligandCentroid![0], p.center.y - res.ligandCentroid![1], p.center.z - res.ligandCentroid![2])) : [];
  return (<>
    <div className="row"><button className="btn primary" disabled={busy} onClick={go}>Find pockets</button><span className="faint" style={{ fontSize: 12 }}>LIGSITE-style buried-cavity search (clean-room; fpocket is not used)</span></div>
    {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
    {res && (res.pockets.length ? <>
      {res.ligandCentroid && <Callout><b style={{ color: 'var(--text)' }}>Check against the bound ligand ({res.ligandName}):</b>&nbsp;{dists.some((d) => d < 6) ? `pocket ${dists.findIndex((d) => d < 6) + 1} is ${fmt(Math.min(...dists), 1)} Å from the ligand centroid.` : `no pocket within 6 Å of the ligand centroid (closest ${fmt(Math.min(...dists), 1)} Å).`}</Callout>}
      <DataTable rows={res.pockets} rowKey={(p) => String(p.rank)} onRow={(p) => onFocus(p.residues.map((r) => ({ chain: r.chain, seq: r.seq })))} cols={[{ key: 'rank', label: '#', sort: (p) => p.rank }, { key: 'vol', label: 'Volume (Å³)', num: true, sort: (p) => p.volume, render: (p) => fmt(p.volume, 0) }, { key: 'bur', label: 'Buriedness', num: true, render: (p) => fmt(p.maxBuriedness, 1) + ' / 7' }, { key: 'hyd', label: 'Hydrophobic', num: true, render: (p) => `${fmt(p.hydrophobic * 100, 0)}%` }, { key: 'n', label: 'Lining residues', num: true, render: (p) => p.residues.length }, { key: 'sc', label: 'Score', num: true, sort: (p) => p.score, render: (p) => fmt(p.score, 2) }, { key: 'c', label: 'Centre (x, y, z)', render: (p) => <code>{fmt(p.center.x, 1)}, {fmt(p.center.y, 1)}, {fmt(p.center.z, 1)}</code> }]} />
      <div className="faint" style={{ fontSize: 12 }}>Click a pocket to select its lining residues in 3D. Volume is the grid-point count × 1 Å³ (an approximation of cavity volume). The score is a heuristic (size × buriedness × hydrophobicity), not a validated druggability model.</div>
    </> : <Callout>No buried pockets found (this fold may be flat, or the structure is too small).</Callout>)}
  </>);
}

function Sasa({ src }: { src: Src }) {
  const { run, busy, error } = useRunner(); const [res, setRes] = useState<Awaited<ReturnType<typeof remote.solvent>> | null>(null);
  useEffect(() => setRes(null), [src]);
  const go = () => void run({ label: 'Solvent accessibility', tool: TOOLS.sasa, params: {}, inputs: [], run: () => remote.solvent({ text: src.text }) }).then((r) => r && setRes(r));
  const rel = res?.rows.map((r) => r.rel).filter((v): v is number => v !== null) ?? [], buried = rel.filter((v) => v < 0.1).length;
  return (<>
    <div className="row"><button className="btn primary" disabled={busy} onClick={go}>Calculate SASA</button></div>{error && <Callout kind="err">{error}</Callout>}
    {res && <>
      <div className="cols-4"><Stat label="Total SASA (Å²)" value={fmt(res.total, 0)} /><Stat label="Residues" value={res.rows.length} /><Stat label="Buried (rel < 10%)" value={`${buried} (${fmt((buried / (rel.length || 1)) * 100, 0)}%)`} /><Stat label="Exposed (rel > 50%)" value={rel.filter((v) => v > 0.5).length} /></div>
      <div className="cols-2"><div><div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>Relative accessibility along the sequence</div><LineChart xs={res.rows.map((_, i) => i + 1)} ys={res.rows.map((r) => Math.min(1.5, r.rel ?? 0))} xLabel="Residue index" yLabel="Relative SASA" yMin={0} height={210} /></div><div><div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>Distribution</div><Histogram values={rel} label="relative SASA" bins={24} height={190} marker={0.1} /></div></div>
      <button className="btn sm" onClick={() => downloadText('sasa.csv', toCsv(res.rows), 'text/csv')}>CSV</button>
    </>}
  </>);
}

function Compare({ src, info, onShow }: { src: Src; info: Info; onShow(a: string, bPdb: string): void }) {
  const { run, busy, error } = useRunner(); const [b, setB] = useState<{ text: string; label: string } | null>(null), [pdbB, setPdbB] = useState('1HSI'), [chA, setChA] = useState(info.chains[0]?.id ?? 'A'), [chB, setChB] = useState('A'), [infoB, setInfoB] = useState<Info | null>(null);
  const [res, setRes] = useState<Awaited<ReturnType<typeof remote.compare>> | null>(null), load = useRunner();
  useEffect(() => { setChA(info.chains[0]?.id ?? 'A'); setRes(null); }, [info]);
  const loadId = () => void load.run({ label: `Fetch ${pdbB}`, tool: TOOLS.compare, params: { paired: 0 }, inputs: [], run: async () => { const id = pdbB.trim().toUpperCase(); if (!/^[0-9][A-Z0-9]{3}$/.test(id)) throw new Error('A PDB ID is 4 characters.'); const text = await trackedFetch(`https://files.rcsb.org/download/${id}.cif`).then((r) => r.text()); const inf = await remote.ligands({ text }); setB({ text, label: id }); setInfoB(inf); setChB(inf.chains[0]?.id ?? 'A'); return inf; }, summary: () => `Comparison structure ${pdbB.toUpperCase()} was retrieved from RCSB PDB (CC0)` });
  const loadFile = async (text: string, name: string) => { try { const inf = await remote.ligands({ text }); setB({ text, label: name }); setInfoB(inf); setChB(inf.chains[0]?.id ?? 'A'); } catch (e) { alert((e as Error).message); } };
  const go = () => b && void run({ label: `Superpose ${src.label} / ${b.label}`, tool: TOOLS.compare, params: { paired: '…' }, inputs: [{ name: src.label, data: src.text.slice(0, 20000) }, { name: b.label, data: b.text.slice(0, 20000) }], run: () => remote.compare({ textA: src.text, chainA: chA, textB: b.text, chainB: chB }), summary: (r) => `Chains were paired by local sequence alignment (BLOSUM62) and superposed on Cα atoms with the Kabsch/Horn method with 3σ outlier rejection (${r.sup.nPaired} residues); TM-score used d0 = 1.24(L−15)^(1/3) − 1.8` }).then((r) => r && setRes(r));
  const d = useMemo(() => res?.sup.perResidue ?? [], [res]);
  return (<>
    <div className="cols-2">
      <Card title="Structure A (loaded)"><div className="row" style={{ alignItems: 'flex-end' }}><div className="dim">{src.label}</div><Field label="Chain"><select className="select" value={chA} onChange={(e) => setChA(e.target.value)}>{info.chains.map((c) => <option key={c.id} value={c.id}>{c.id} ({c.length} aa)</option>)}</select></Field></div></Card>
      <Card title="Structure B"><div className="stack" style={{ gap: 8 }}><div className="row" style={{ alignItems: 'flex-end' }}><Field label="PDB ID"><input className="input mono" value={pdbB} maxLength={4} onChange={(e) => setPdbB(e.target.value)} style={{ width: 90 }} /></Field><button className="btn" disabled={load.busy} onClick={loadId}>Fetch</button>{infoB && <Field label="Chain"><select className="select" value={chB} onChange={(e) => setChB(e.target.value)}>{infoB.chains.map((c) => <option key={c.id} value={c.id}>{c.id} ({c.length} aa)</option>)}</select></Field>}</div><FileDrop accept=".pdb,.cif,.ent" onText={(t, n) => void loadFile(t, n)} label={b ? `Loaded ${b.label}` : 'or drop a PDB / mmCIF file'} />{load.error && <Callout kind="err">{load.error}</Callout>}</div></Card>
    </div>
    <div className="row"><button className="btn primary" disabled={!b || busy} onClick={go}>Superpose B onto A</button>{res && <button className="btn" onClick={() => onShow(src.text, res.transformedPdb)}>Show superposition in 3D</button>}{res && <button className="btn sm" onClick={() => downloadText('B_superposed.pdb', res.transformedPdb)}>Download superposed B</button>}</div>
    {error && <Callout kind="err">{error}</Callout>}
    {res && <>
      <div className="cols-4"><Stat label="Cα RMSD (Å)" value={fmt(res.sup.rmsd, 2)} hint={`over ${res.sup.nPaired} core residues after outlier rejection`} /><Stat label="RMSD, all aligned (Å)" value={fmt(res.sup.rmsdAll, 2)} hint={`${res.pairsN} sequence-aligned pairs`} /><Stat label="TM-score" value={fmt(res.sup.tmScore, 3)} hint="normalised by chain A length; fixed sequence alignment + Kabsch (a lower bound of the optimum). > 0.5 suggests the same fold" /><Stat label="Seq identity" value={`${fmt(res.sup.identity * 100, 0)}%`} /></div>
      <div className="faint" style={{ fontSize: 12 }}>Per-residue Cα deviation after superposition (Å)</div>
      <BarChart labels={d.map((x) => String(x.seq))} values={d.map((x) => Math.min(x.d, 12))} colors={d.map((x) => (x.d > 3 ? cssVar('--danger') : cssVar('--chart-a')))} yLabel="Å" fmt={(v) => v.toFixed(0)} height={200} />
    </>}
  </>);
}
