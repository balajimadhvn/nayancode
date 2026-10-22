import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { createRemote } from '@/compute/rpc';
import { Busy, Callout, Card, DataTable, Field, Tabs, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import type { MolToolKernels } from './moltools.worker';
import { REACTIONS } from './moltools';

interface M { id: string; name: string; smiles: string; canon: string; svg: string }
const remote = createRemote<MolToolKernels>(() => new Worker(new URL('./moltools.worker.ts', import.meta.url), { type: 'module' }));
const tool = (id: string, name: string, describe: ToolInfo['describe'], citations: string[] = ['rdkit']): ToolInfo => ({ id, name, version: '0.1.0', engine: 'RDKit (WebAssembly) + TypeScript', citations, describe });
const T = {
  scaf: tool('chem.scaffolds', 'Bemis–Murcko scaffolds', (p) => `Bemis–Murcko scaffolds were extracted for ${p.n} molecules and grouped by generic framework`, ['rdkit', 'bemis1996']),
  mcs: tool('chem.mcs', 'Maximum common substructure', (p) => `The maximum common substructure of ${p.n} molecules was found with the RDKit FMCS algorithm (${p.smarts})`, ['rdkit', 'dalke2008']),
  rg: tool('chem.rgroups', 'R-group decomposition', (p) => `Substituents were tabulated by R-group decomposition on the core ${p.core}`),
  rxn: tool('chem.enumeration', 'Reaction enumeration', (p) => `A virtual library of ${p.products} products was enumerated with the reaction ${p.rxn}`),
  sim: tool('chem.pharmshape', 'Pharmacophore and shape similarity', (p) => `Molecules were ranked by ${p.method === 'usr' ? 'USR 3-D shape similarity' : '2-D pharmacophore pair similarity'} to the query`, ['rdkit', 'ballester2007', 'gobbi1998']),
};
interface RgRow { smiles: string; matched: boolean; groups: Record<string, string> }
type Sub = 'scaffolds' | 'mcs' | 'enum' | 'sim';

export default function MolToolsView({ mols }: { mols: M[] }) {
  const [sub, setSub] = useState<Sub>('scaffolds');
  return (
    <div className="stack">
      <Tabs<Sub> value={sub} onChange={setSub} items={[{ id: 'scaffolds', label: 'Scaffolds' }, { id: 'mcs', label: 'MCS & R-groups' }, { id: 'enum', label: 'Reaction enumeration' }, { id: 'sim', label: 'Pharmacophore & shape' }]} />
      {sub === 'scaffolds' && <Scaffolds mols={mols} />}{sub === 'mcs' && <McsRg mols={mols} />}{sub === 'enum' && <Enum mols={mols} />}{sub === 'sim' && <Sim mols={mols} />}
    </div>
  );
}

const Svg = ({ svg }: { svg: string }) => <div className="mol-svg" dangerouslySetInnerHTML={{ __html: svg }} />;

function Scaffolds({ mols }: { mols: M[] }) {
  const [res, setRes] = useState<{ scaffold: string; generic: string; names: string[]; svg: string }[] | null>(null), [generic, setGeneric] = useState(false), { run, busy, progress, error } = useRunner();
  const go = () => void run({ label: 'Scaffold analysis', tool: T.scaf, params: { n: mols.length }, inputs: [{ name: 'library', data: mols.map((m) => m.canon).join('\n') }], run: async (h) => {
    const r = await remote.scaffolds({ smiles: mols.map((m) => m.smiles) }, { signal: h.signal, onProgress: h.onProgress });
    const groups = new Map<string, { scaffold: string; generic: string; names: string[] }>();
    r.forEach((x, i) => { const sc = x.scaffold?.scaffold ?? ''; const g = groups.get(sc) ?? { scaffold: sc, generic: x.scaffold?.generic ?? '', names: [] }; g.names.push(mols[i].name); groups.set(sc, g); });
    const list = [...groups.values()].sort((a, b) => b.names.length - a.names.length);
    const svgs = await remote.svgs({ smiles: list.slice(0, 40).map((g) => g.scaffold || 'C') }, { signal: h.signal });
    return list.map((g, i) => ({ ...g, svg: i < 40 && g.scaffold ? svgs[i] : '' }));
  } }).then((r) => r && setRes(r));
  const view = useMemo(() => {
    if (!res) return null;
    if (!generic) return res;
    const m = new Map<string, { scaffold: string; generic: string; names: string[]; svg: string }>();
    for (const r of res) { const g = m.get(r.generic) ?? { scaffold: r.generic, generic: r.generic, names: [], svg: r.svg }; g.names.push(...r.names); m.set(r.generic, g); }
    return [...m.values()].sort((a, b) => b.names.length - a.names.length);
  }, [res, generic]);
  return (
    <Card title="Bemis–Murcko scaffolds" sub={`${mols.length} molecules`} actions={<button className="btn primary sm" onClick={go} disabled={busy}>Analyse</button>}>
      <div className="stack" style={{ gap: 10 }}>
        {busy && <Busy progress={progress} />}{error && <Callout kind="err">{error}</Callout>}
        {!view ? <div className="faint">Groups the library by ring systems and linkers (side chains removed). Use it to see how many chemical series a library contains.</div> : <>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={generic} onChange={(e) => setGeneric(e.target.checked)} />Group by generic framework (all atoms C, all bonds single)</label>
          <div className="faint" style={{ fontSize: 12 }}>{view.length} {generic ? 'generic frameworks' : 'scaffolds'} for {mols.length} molecules ({view.filter((v) => v.names.length === 1).length} singletons).</div>
          <DataTable rowKey={(r) => r.scaffold || '(none)'} limit={60} rows={view} cols={[
            { key: 'svg', label: 'Scaffold', render: (r) => (r.scaffold ? (r.svg ? <Svg svg={r.svg} /> : <span className="mono">{r.scaffold}</span>) : <span className="faint">no ring (acyclic)</span>) },
            { key: 'n', label: 'Molecules', num: true, render: (r) => r.names.length, sort: (r) => r.names.length },
            { key: 'names', label: 'Examples', render: (r) => r.names.slice(0, 4).join(', ') + (r.names.length > 4 ? ` +${r.names.length - 4}` : '') },
            { key: 'smi', label: 'SMILES', render: (r) => <span className="mono" style={{ fontSize: 11 }}>{r.scaffold}</span> }]} />
          <div className="row"><button className="btn sm" onClick={() => downloadText('scaffolds.csv', toCsv(view.map((v) => ({ scaffold: v.scaffold, count: v.names.length, molecules: v.names.join(';') }))), 'text/csv')}>Download CSV</button></div>
        </>}
      </div>
    </Card>
  );
}

function McsRg({ mols }: { mols: M[] }) {
  const [limit, setLimit] = useState('40'), [timeout, setTimeoutS] = useState('10'), [ringsOnly, setRings] = useState(true), [anyEl, setAny] = useState(false), [core, setCore] = useState('');
  const [res, setRes] = useState<{ smarts: string; atoms: number; bonds: number; canceled: boolean; svgs: string[] } | null>(null), [rg, setRg] = useState<{ rows: { smiles: string; matched: boolean; groups: Record<string, string> }[]; columns: string[]; unmatched: number } | null>(null);
  const { run, busy, progress, error } = useRunner();
  const n = Math.max(2, Math.min(mols.length, Number(limit) || 40));
  const go = () => void run({ label: 'Maximum common substructure', tool: T.mcs, params: { n, smarts: '' }, inputs: [{ name: 'molecules', data: mols.slice(0, n).map((m) => m.canon).join('\n') }], run: async (h) => {
    const r = await remote.mcs({ smiles: mols.slice(0, n).map((m) => m.smiles), timeout: Number(timeout) || 10, ringsOnly, anyElement: anyEl }, { signal: h.signal });
    const svgs = await remote.svgs({ smiles: mols.slice(0, 12).map((m) => m.smiles), smarts: r.smarts }, { signal: h.signal });
    setCore(r.smarts); return { ...r, svgs };
  } }).then((r) => { if (r) { setRes(r); setRg(null); } });
  const decompose = () => void run({ label: 'R-group decomposition', tool: T.rg, params: { core }, inputs: [{ name: 'library', data: mols.map((m) => m.canon).join('\n') }], run: async (h) => remote.rgroups({ core, smiles: mols.map((m) => m.smiles) }, { signal: h.signal }) }).then((r) => r && setRg(r));
  return (
    <div className="split"><div className="stack">
      <Card title="Maximum common substructure"><div className="stack" style={{ gap: 10 }}>
        <div className="cols-2" style={{ gap: 8 }}><Field label="Use the first N molecules"><input className="input" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field><Field label="Time limit (s)"><input className="input" value={timeout} onChange={(e) => setTimeoutS(e.target.value)} /></Field></div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={ringsOnly} onChange={(e) => setRings(e.target.checked)} />Complete rings only</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={anyEl} onChange={(e) => setAny(e.target.checked)} />Ignore element and bond type (topology only)</label>
        <button className="btn primary" onClick={go} disabled={busy || mols.length < 2}>Find common core</button>
        {busy && <Busy progress={progress} />}{error && <Callout kind="err">{error}</Callout>}
      </div></Card>
      {res && <Card title="R-group decomposition" sub="core from MCS, or type your own SMILES or SMARTS"><div className="stack" style={{ gap: 8 }}>
        <input className="input mono" value={core} onChange={(e) => setCore(e.target.value)} />
        <button className="btn" onClick={decompose} disabled={busy || !core}>Decompose the library</button>
      </div></Card>}
    </div>
    <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Find the largest substructure shared by your molecules, then tabulate the substituents around it.</div></Card> : <>
      <Card title={`Common core: ${res.atoms} atoms, ${res.bonds} bonds`}>
        {res.canceled && <Callout kind="warn">The time limit was reached; this is the best core found so far, not necessarily the largest.</Callout>}
        {res.atoms === 0 && <Callout kind="warn">No common substructure. Try “ignore element and bond type”, or fewer molecules.</Callout>}
        <div className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all', margin: '6px 0' }}>{res.smarts}</div>
        <div className="mol-grid">{res.svgs.map((s, i) => <Svg key={i} svg={s} />)}</div>
      </Card>
      {rg && <Card title="R-group table" sub={`${rg.rows.length - rg.unmatched} of ${rg.rows.length} matched`}>
        <DataTable rowKey={(r) => r.smiles} limit={80} rows={rg.rows} cols={[{ key: 'smiles', label: 'Molecule', render: (r) => <span className="mono" style={{ fontSize: 11 }}>{r.smiles}</span> }, ...rg.columns.map((c) => ({ key: c, label: c, render: (r: RgRow) => <span className="mono" style={{ fontSize: 11 }}>{r.groups[c] ?? ''}</span> })), { key: 'm', label: 'Matched', render: (r) => (r.matched ? 'yes' : 'no') }]} />
        <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => downloadText('rgroups.csv', toCsv(rg.rows.map((r) => ({ molecule: r.smiles, matched: r.matched, ...r.groups }))), 'text/csv')}>Download CSV</button></div>
      </Card>}
    </>}</div></div>
  );
}

const EXAMPLES: Record<string, [string, string]> = { amide: ['CC(=O)O\nOC(=O)c1ccccc1\nOC(=O)c1ccc(Cl)cc1\nOC(=O)C1CC1', 'NCc1ccccc1\nNC1CC1\nNc1ccncc1\nNC1CCOCC1'], reductive: ['O=Cc1ccccc1\nO=Cc1ccc(F)cc1\nO=CC1CC1', 'NC1CCNCC1\nNCc1ccccc1\nNC1CCCC1'], suzuki: ['Brc1ccccc1\nBrc1ccncc1\nIc1ccc(C)cc1', 'OB(O)c1ccccc1\nOB(O)c1ccc(F)cc1\nOB(O)c1cccs1'], sulfonamide: ['CS(=O)(=O)Cl\nO=S(=O)(Cl)c1ccccc1', 'NC1CC1\nNc1ccccc1\nNCc1ccncc1'], ester: ['CC(=O)O\nOC(=O)c1ccccc1', 'OCC\nOCc1ccccc1\nOC1CCCC1'] };
function Enum({ mols: _m }: { mols: M[] }) {
  const [rid, setRid] = useState('amide'), [smarts, setSmarts] = useState(REACTIONS[0].smarts), [a, setA] = useState(EXAMPLES.amide[0]), [b, setB] = useState(EXAMPLES.amide[1]);
  const [res, setRes] = useState<{ products: string[]; combos: number; truncated: boolean; invalid: number; svgs: string[] } | null>(null), { run, busy, error } = useRunner();
  const pick = (id: string) => { const r = REACTIONS.find((x) => x.id === id)!; setRid(id); setSmarts(r.smarts); setA(EXAMPLES[id][0]); setB(EXAMPLES[id][1]); setRes(null); };
  const lines = (t: string) => t.split(/\n/).map((s) => s.trim()).filter(Boolean);
  const go = () => void run({ label: 'Reaction enumeration', tool: T.rxn, params: { rxn: smarts, products: 0 }, inputs: [{ name: 'reactants A', data: a }, { name: 'reactants B', data: b }], run: async (h) => {
    const r = await remote.enumerate({ smarts, lists: [lines(a), lines(b)], max: 2000 }, { signal: h.signal });
    const svgs = await remote.svgs({ smiles: r.products.slice(0, 12) }, { signal: h.signal }); return { ...r, svgs };
  } }).then((r) => r && setRes(r));
  const rx = REACTIONS.find((x) => x.id === rid);
  return (
    <div className="split"><div className="stack">
      <Card title="Reaction"><div className="stack" style={{ gap: 10 }}>
        <Field label="Template"><select className="select" value={rid} onChange={(e) => pick(e.target.value)}>{REACTIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Reaction SMARTS (edit to define your own)"><textarea className="input mono" rows={3} value={smarts} onChange={(e) => setSmarts(e.target.value)} style={{ fontSize: 11.5 }} /></Field>
        <Field label={`Reactant set 1: ${rx?.hint[0] ?? ''} (one SMILES per line)`}><textarea className="input mono" rows={5} value={a} onChange={(e) => setA(e.target.value)} style={{ fontSize: 12 }} /></Field>
        <Field label={`Reactant set 2: ${rx?.hint[1] ?? ''}`}><textarea className="input mono" rows={5} value={b} onChange={(e) => setB(e.target.value)} style={{ fontSize: 12 }} /></Field>
        <button className="btn primary" onClick={go} disabled={busy}>Enumerate products</button>{error && <Callout kind="err">{error}</Callout>}
      </div></Card>
    </div>
    <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Combine two reactant lists with a reaction template to build a virtual library. Products are sanitised by RDKit; synthetic feasibility is not assessed.</div></Card> : <Card title={`${res.products.length} products`} sub={`${res.combos} reactant combinations`}>
      {res.truncated && <Callout kind="warn">Stopped at 2,000 products.</Callout>}{res.invalid > 0 && <Callout kind="warn">{res.invalid} reactant SMILES could not be read and were skipped.</Callout>}
      {res.products.length === 0 && <Callout kind="warn">No products. A reactant probably does not contain the functional group the template expects.</Callout>}
      <div className="mol-grid">{res.svgs.map((s, i) => <Svg key={i} svg={s} />)}</div>
      <div className="row" style={{ marginTop: 8, gap: 6 }}><button className="btn sm" onClick={() => downloadText('enumerated.smi', res.products.join('\n'))}>Download SMILES</button><button className="btn sm" onClick={() => downloadText('enumerated.csv', toCsv(res.products.map((p, i) => ({ id: `P${i + 1}`, smiles: p }))), 'text/csv')}>Download CSV</button></div>
    </Card>}</div></div>
  );
}

function Sim({ mols }: { mols: M[] }) {
  const [q, setQ] = useState('CC(=O)OC1=CC=CC=C1C(=O)O'), [method, setMethod] = useState<'pharmacophore' | 'usr'>('pharmacophore'), [res, setRes] = useState<{ m: M; s: number }[] | null>(null);
  const { run, busy, progress, error } = useRunner();
  const go = () => void run({ label: 'Pharmacophore / shape similarity', tool: T.sim, params: { method }, inputs: [{ name: 'query', data: q }, { name: 'library', data: mols.map((m) => m.canon).join('\n') }], run: async (h) => {
    const r = await remote.similarity({ query: q.trim(), smiles: mols.map((m) => m.smiles), method }, { signal: h.signal, onProgress: h.onProgress });
    return mols.map((m, i) => ({ m, s: r[i].s })).filter((x) => Number.isFinite(x.s)).sort((a, b) => b.s - a.s);
  } }).then((r) => r && setRes(r));
  return (
    <div className="split"><div className="stack">
      <Card title="Query"><div className="stack" style={{ gap: 10 }}>
        <Field label="Query SMILES"><input className="input mono" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="Method"><select className="select" value={method} onChange={(e) => setMethod(e.target.value as 'pharmacophore' | 'usr')}><option value="pharmacophore">2-D pharmacophore pairs (fast)</option><option value="usr">3-D shape (USR, embeds one conformer each)</option></select></Field>
        <button className="btn primary" onClick={go} disabled={busy || mols.length === 0}>Rank the library</button>
        {busy && <Busy progress={progress} />}{error && <Callout kind="err">{error}</Callout>}
      </div></Card>
      <Callout><div>Pharmacophore similarity counts pairs of features (donor, acceptor, aromatic ring, hydrophobe, charge) at matching bond distances. USR compares molecular shape from one embedded conformer and needs no alignment. Both are fast screening aids, not docking.</div></Callout>
    </div>
    <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Rank the loaded library by pharmacophore or 3-D shape similarity to a query.</div></Card> : <Card title="Most similar" sub={method === 'usr' ? 'USR shape' : 'pharmacophore pairs'}>
      <DataTable rowKey={(r) => r.m.id} limit={50} rows={res} cols={[{ key: 'svg', label: '', render: (r) => <Svg svg={r.m.svg} /> }, { key: 'name', label: 'Compound', render: (r) => r.m.name }, { key: 's', label: 'Similarity', num: true, render: (r) => fmt(r.s, 3), sort: (r) => r.s }]} />
    </Card>}</div></div>
  );
}
