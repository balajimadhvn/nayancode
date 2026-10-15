import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { Histogram } from '@/viz/charts';
import { chemCall } from './chemClient';
import { createRemote } from '@/compute/rpc';
import { MultiLine, SigBars as _SigBars, catColors } from '@/viz/more';
import { Scatter, BarChart, cssVar, type Pt } from '@/viz/charts';
import { aggregateActivities, chemblActivities, chemblTargets, pubchemByName, type ChemblTarget } from './sources';
import { toPActivity } from './qsar';
import type { QsarKernels, QsarResult } from './qsar.worker';

void _SigBars; void MultiLine;
const qsarRemote = createRemote<QsarKernels>(() => new Worker(new URL('./qsar.worker.ts', import.meta.url), { type: 'module' }));

interface Mol { id: string; name: string; smiles: string; canon: string; svg: string; mw: number; logp: number; tpsa: number; hbd: number; hba: number; rotb: number; fsp3: number; rings: number; lipinskiViolations: number; alerts: string[]; fp: Uint32Array; desc: Float32Array; extra: Record<string, string> }

const V = '0.1.0';
const T = (id: string, name: string, describe: ToolInfo['describe'], citations: string[] = ['rdkit']): ToolInfo => ({ id, name, version: V, engine: 'RDKit (WebAssembly)', citations, describe });
const TOOLS = {
  props: T('chem.properties', 'Descriptor calculation', (p) => `Molecules (n = ${p.n}) were parsed and standardised to canonical SMILES, and physicochemical descriptors (molecular weight, Crippen logP, TPSA, H-bond donors/acceptors, rotatable bonds, Fsp3) were computed with RDKit; rule-of-five violations were counted`, ['rdkit', 'lipinski2001']),
  sim: T('chem.similarity', 'Similarity search', (p) => `Similarity to the query was computed as Tanimoto coefficients of Morgan fingerprints (radius ${p.radius}, ${p.bits} bits)`, ['rdkit', 'rogers2010']),
  sub: T('chem.substructure', 'Substructure search', (p) => `Substructure matches were found for the SMARTS pattern ${p.smarts}`),
};

const EXAMPLE = `name,smiles
Aspirin,CC(=O)OC1=CC=CC=C1C(=O)O
Ibuprofen,CC(C)CC1=CC=C(C=C1)C(C)C(=O)O
Paracetamol,CC(=O)NC1=CC=C(O)C=C1
Caffeine,CN1C=NC2=C1C(=O)N(C)C(=O)N2C
Naproxen,COC1=CC2=CC=C(C=C2C=C1)C(C)C(=O)O
Diclofenac,OC(=O)CC1=CC=CC=C1NC1=C(Cl)C=CC=C1Cl
Celecoxib,CC1=CC=C(C=C1)C1=CC(=NN1C1=CC=C(C=C1)S(N)(=O)=O)C(F)(F)F
Metformin,CN(C)C(=N)N=C(N)N
Atorvastatin,CC(C)C1=C(C(=C(N1CC[C@H](C[C@H](CC(=O)O)O)O)C2=CC=C(C=C2)F)C3=CC=CC=C3)C(=O)NC4=CC=CC=C4
Sildenafil,CCCC1=NN(C2=C1N=C(NC2=O)C3=C(C=CC(=C3)S(=O)(=O)N4CCN(CC4)C)OCC)C
Imatinib,CC1=C(C=C(C=C1)NC(=O)C2=CC=C(C=C2)CN3CCN(CC3)C)NC4=NC=CC(=N4)C5=CN=CC=C5
Gefitinib,COC1=C(OCCCN2CCOCC2)C=C2C(NC3=CC(Cl)=C(F)C=C3)=NC=NC2=C1
Erlotinib,COCCOC1=C(OCCOC)C=C2C(NC3=CC=CC(=C3)C#C)=NC=NC2=C1
Propranolol,CC(C)NCC(O)COC1=CC=CC2=CC=CC=C21
Atenolol,CC(C)NCC(O)COC1=CC=C(CC(N)=O)C=C1
Diazepam,CN1C(=O)CN=C(C2=CC=CC=C2)C2=C1C=CC(Cl)=C2
Fluoxetine,CNCCC(OC1=CC=C(C=C1)C(F)(F)F)C1=CC=CC=C1
Warfarin,CC(=O)CC(C1=CC=CC=C1)C1=C(O)C2=CC=CC=C2OC1=O
Penicillin G,CC1(C)SC2C(NC(=O)CC3=CC=CC=C3)C(=O)N2C1C(=O)O
Ciprofloxacin,OC(=O)C1=CN(C2CC2)C2=CC(N3CCNCC3)=C(F)C=C2C1=O
Omeprazole,COC1=CC2=C(C=C1)N=C(N2)S(=O)CC1=NC=C(C)C(OC)=C1C
Losartan,CCCCC1=NC(Cl)=C(CO)N1CC1=CC=C(C=C1)C1=CC=CC=C1C1=NNN=N1
Cholesterol,CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C
Morphine,CN1CCC23C4C1CC5=C2C(=C(C=C5)O)OC3C(C=C4)O
Sucrose,OCC1OC(OC2(CO)OC(CO)C(O)C2O)C(O)C(O)C1O
Benzene,c1ccccc1
Ethanol,CCO`;

const stripQuotes = (s: string) => s.trim().replace(/^"|"$/g, '');
function parseInput(text: string): { items: { name: string; smiles: string; extra: Record<string, string> }[]; columns: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { items: [], columns: [] };
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : ' ';
  const head = lines[0].split(delim).map((h) => stripQuotes(h));
  const hl = head.map((h) => h.toLowerCase()), si = hl.findIndex((h) => h === 'smiles' || h === 'canonical_smiles' || h === 'smile');
  if (si >= 0) { const ni = hl.findIndex((h) => h === 'name' || h === 'id' || h === 'compound'); const cols = head.filter((_, i) => i !== si && i !== ni); return { columns: cols, items: lines.slice(1).map((l, i) => { const f = l.split(delim).map(stripQuotes); const extra: Record<string, string> = {}; head.forEach((h, k) => { if (k !== si && k !== ni) extra[h] = f[k] ?? ''; }); return { name: ni >= 0 ? f[ni] : `mol${i + 1}`, smiles: f[si], extra }; }) }; }
  return { columns: [], items: lines.map((l, i) => { const f = l.split(/[\s,\t]+/); return { name: f[1] ?? `mol${i + 1}`, smiles: f[0], extra: {} }; }) };
}

const pop = (x: number) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
const tanimoto = (a: Uint32Array, b: Uint32Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += pop(a[k] & b[k]); u += pop(a[k] | b[k]); } return u ? i / u : 0; };

const FP_BITS = 2048, FP_RADIUS = 2;
type ChemTab = 'library' | 'properties' | 'similarity' | 'substructure' | 'space' | 'qsar';

export default function ChemistryStudio() {
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [mols, setMols] = useState<Mol[]>([]);
  const [failed, setFailed] = useState<{ name: string; smiles: string }[]>([]);
  const [curation, setCuration] = useState<{ stripped: number; dupes: number } | null>(null);
  const [tab, setTab] = useState<ChemTab>('library');
  const [columns, setColumns] = useState<string[]>([]), [descNames, setDescNames] = useState<string[]>([]);
  const [pcName, setPcName] = useState('imatinib'), [pcMsg, setPcMsg] = useState<string | null>(null);
  const { run, busy, progress, note, error, cancel } = useRunner();

  useEffect(() => { chemCall('init').then(() => setReady(true)).catch((e) => setLoadErr(String(e.message ?? e))); }, []);

  const process = useCallback(async (input: string) => {
    const { items, columns: cols } = parseInput(input);
    if (!items.length) return;
    const out = await run<{ mols: Mol[]; failed: { name: string; smiles: string }[]; stripped: number; dupes: number; descNames: string[] }>({
      label: `Descriptors · ${items.length} molecules`, tool: TOOLS.props, params: { n: items.length }, inputs: [{ name: 'molecules', data: input }],
      run: (h) => chemCall('process', { items, radius: FP_RADIUS, nBits: FP_BITS }, { onProgress: h.onProgress, signal: h.signal }),
    });
    if (out) { setMols(out.mols); setFailed(out.failed); setColumns(cols); setDescNames(out.descNames); setCuration({ stripped: out.stripped, dupes: out.dupes }); setTab('library'); }
  }, [run]);

  const load = (t: string) => { setText(t); void process(t); };
  const addPubchem = async () => { try { setPcMsg('Looking up…'); const h = await pubchemByName(pcName); const base = text.trim() ? text.trimEnd() : 'name,smiles'; const next = `${base}\n${pcName.trim().replace(/,/g, ' ')},${h.smiles}`; setText(next); setPcMsg(`Added ${pcName} (CID ${h.cid}, ${h.formula}, MW ${h.mw}). Press Process.`); } catch (e) { setPcMsg((e as Error).message); } };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Chemistry Studio</h1><p>Curate, filter, search and profile compound libraries with RDKit running in a WebAssembly worker. Structures stay on your device.</p></div>{!ready && !loadErr && <span className="row dim"><span className="spinner" /> Loading RDKit (~6 MB, cached after first visit)…</span>}</div>
      {loadErr && <Callout kind="err">RDKit failed to load: {loadErr}</Callout>}
      <div className="split">
        <div className="stack">
          <Card title="Library" sub="SMILES or CSV with a smiles column">
            <div className="stack" style={{ gap: 10 }}>
              <textarea className="input" spellCheck={false} placeholder={'name,smiles\nAspirin,CC(=O)OC1=CC=CC=C1C(=O)O'} value={text} onChange={(e) => setText(e.target.value)} />
              <FileDrop accept=".csv,.tsv,.txt,.smi" onText={(t) => load(t)} label="Drop CSV / SMILES file" />
              <div className="row"><button className="btn primary" disabled={!ready || busy || !text.trim()} onClick={() => void process(text)}>Process</button><button className="btn" disabled={!ready || busy} onClick={() => load(EXAMPLE)}>Load example (27 compounds)</button></div>
              <div className="row" style={{ alignItems: 'flex-end', gap: 6 }}><Field label="Add by name (PubChem, public domain)"><input className="input" value={pcName} onChange={(e) => setPcName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addPubchem()} /></Field><button className="btn" onClick={() => void addPubchem()}>Add</button></div>{pcMsg && <div className="faint" style={{ fontSize: 12 }}>{pcMsg}</div>}
              {busy && <><Busy progress={progress} note={note} /><button className="btn sm" onClick={cancel}>Cancel</button></>}
              {error && <Callout kind="err">{error}</Callout>}
              {failed.length > 0 && <Callout kind="warn">{failed.length} structure{failed.length > 1 ? 's' : ''} could not be parsed: {failed.slice(0, 3).map((f) => f.name).join(', ')}{failed.length > 3 ? '…' : ''}</Callout>}
              {curation && (curation.stripped > 0 || curation.dupes > 0) && <Callout>Curation: {curation.stripped} multi-fragment structure{curation.stripped === 1 ? '' : 's'} reduced to the largest fragment; {curation.dupes} duplicate{curation.dupes === 1 ? '' : 's'} removed (same canonical SMILES).</Callout>}
            </div>
          </Card>
          {mols.length > 0 && <div className="cols-2" style={{ gap: 10 }}><Stat label="Molecules" value={mols.length} /><Stat label="Ro5 pass" value={`${mols.filter((m) => m.lipinskiViolations <= 1).length}`} hint="≤ 1 Lipinski violation" /></div>}
        </div>
        <div className="stack">
          <Tabs<ChemTab> value={tab} onChange={setTab} items={[{ id: 'library', label: 'Library' }, { id: 'properties', label: 'Properties' }, { id: 'similarity', label: 'Similarity' }, { id: 'substructure', label: 'Substructure' }, { id: 'space', label: 'Chemical space' }, { id: 'qsar', label: 'QSAR Lab' }]} />
          {tab === 'qsar' ? <QsarLab mols={mols} columns={columns} descNames={descNames} ready={ready} /> : mols.length === 0 ? <Card><div className="faint" style={{ textAlign: 'center', padding: '36px 6px' }}>Load the example set of approved drugs, or paste your own SMILES. The QSAR Lab can also fetch a target's bioactivity from ChEMBL.</div></Card> : <>
            {tab === 'library' && <LibraryView mols={mols} />}
            {tab === 'properties' && <PropertiesView mols={mols} />}
            {tab === 'similarity' && <SimilarityView mols={mols} />}
            {tab === 'substructure' && <SubstructureView mols={mols} />}
            {tab === 'space' && <SpaceView mols={mols} />}
          </>}
        </div>
      </div>
    </div>
  );
}

const MolSvg = ({ svg }: { svg: string }) => <div className="svgwrap" dangerouslySetInnerHTML={{ __html: svg }} />;

function LibraryView({ mols }: { mols: Mol[] }) {
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const exportCsv = () => downloadText('library.csv', toCsv(mols.map((m) => ({ name: m.name, canonical_smiles: m.canon, MW: m.mw.toFixed(2), cLogP: m.logp.toFixed(2), TPSA: m.tpsa.toFixed(1), HBD: m.hbd, HBA: m.hba, RotB: m.rotb, Fsp3: m.fsp3.toFixed(2), Ro5_violations: m.lipinskiViolations }))), 'text/csv');
  return (
    <Card title="Compounds" sub={`${mols.length}`} actions={<><div className="tabs"><button className="tab" aria-selected={view === 'grid'} onClick={() => setView('grid')}><span>Grid</span></button><button className="tab" aria-selected={view === 'table'} onClick={() => setView('table')}><span>Table</span></button></div><button className="btn sm" onClick={exportCsv}>Export CSV</button></>} pad={false}>
      {view === 'grid' ? <div className="mol-grid" style={{ maxHeight: 640, overflow: 'auto' }}>{mols.slice(0, 400).map((m) => <div key={m.id} className="mol-card"><MolSvg svg={m.svg} /><div className="nm" title={m.name}>{m.name}</div><div className="pp"><span>MW {fmt(m.mw, 0)}</span><span>logP {fmt(m.logp, 1)}</span><span>TPSA {fmt(m.tpsa, 0)}</span></div></div>)}</div>
        : <DataTable rows={mols} rowKey={(m) => m.id} limit={500} cols={[{ key: 'name', label: 'Name', sort: (m) => m.name }, { key: 'mw', label: 'MW', num: true, render: (m) => fmt(m.mw, 1), sort: (m) => m.mw }, { key: 'logp', label: 'cLogP', num: true, render: (m) => fmt(m.logp, 2), sort: (m) => m.logp }, { key: 'tpsa', label: 'TPSA', num: true, render: (m) => fmt(m.tpsa, 1), sort: (m) => m.tpsa }, { key: 'hbd', label: 'HBD', num: true, sort: (m) => m.hbd }, { key: 'hba', label: 'HBA', num: true, sort: (m) => m.hba }, { key: 'rotb', label: 'RotB', num: true, sort: (m) => m.rotb }, { key: 'fsp3', label: 'Fsp3', num: true, render: (m) => fmt(m.fsp3, 2), sort: (m) => m.fsp3 }, { key: 'alerts', label: 'Alerts', render: (m) => (m.alerts.length ? <span className="badge building" title={m.alerts.join(', ')}>{m.alerts.length}</span> : <span className="faint">–</span>), sort: (m) => m.alerts.length }, { key: 'ro5', label: 'Ro5', render: (m) => <span className={`badge ${m.lipinskiViolations <= 1 ? 'live' : 'building'}`}>{m.lipinskiViolations} viol.</span>, sort: (m) => m.lipinskiViolations }]} />}
    </Card>
  );
}

function PropertiesView({ mols }: { mols: Mol[] }) {
  const items: { label: string; get: (m: Mol) => number; marker?: number }[] = [
    { label: 'Molecular weight (Da)', get: (m) => m.mw, marker: 500 }, { label: 'cLogP', get: (m) => m.logp, marker: 5 }, { label: 'TPSA (Å²)', get: (m) => m.tpsa, marker: 140 },
    { label: 'H-bond donors', get: (m) => m.hbd, marker: 5 }, { label: 'H-bond acceptors', get: (m) => m.hba, marker: 10 }, { label: 'Rotatable bonds', get: (m) => m.rotb, marker: 10 },
  ];
  return (
    <>
      <div className="cols-2">{items.map((it) => <Card key={it.label} title={it.label} sub={it.marker !== undefined ? 'dashed line = rule threshold' : undefined}><Histogram values={mols.map(it.get)} label={it.label} marker={it.marker} bins={Math.min(24, Math.max(6, Math.ceil(Math.sqrt(mols.length))))} /></Card>)}</div>
      <Callout>Thresholds shown are Lipinski (MW 500, logP 5, HBD 5, HBA 10), Veber (TPSA 140, RotB 10). They are guidelines for oral drug-likeness, not hard filters.</Callout>
    </>
  );
}

function SimilarityView({ mols }: { mols: Mol[] }) {
  const [q, setQ] = useState('CC(=O)OC1=CC=CC=C1C(=O)O');
  const [hits, setHits] = useState<{ m: Mol; s: number }[]>([]);
  const [qsvg, setQsvg] = useState('');
  const { run, error } = useRunner();
  const go = () => {
    void run({ label: 'Similarity search', tool: TOOLS.sim, params: { radius: FP_RADIUS, bits: FP_BITS, n: mols.length }, inputs: [{ name: 'query', data: q }, { name: 'library', data: mols.map((m) => m.canon).join('\n') }], run: async (h) => {
      const { fp, svg } = await chemCall<{ fp: Uint32Array; svg: string }>('fp', { smiles: q, radius: FP_RADIUS, nBits: FP_BITS }, { signal: h.signal });
      setQsvg(svg); return mols.map((x) => ({ m: x, s: tanimoto(fp, x.fp) })).sort((a, b) => b.s - a.s);
    } }).then((r) => r && setHits(r));
  };
  return (
    <>
      <Card title="Query" sub={`Morgan r=${FP_RADIUS}, ${FP_BITS} bits, Tanimoto`}>
        <div className="row" style={{ alignItems: 'flex-end' }}><div style={{ flex: 1, minWidth: 260 }}><Field label="SMILES"><input className="input mono" value={q} onChange={(e) => setQ(e.target.value)} /></Field></div><select className="select" style={{ width: 170 }} onChange={(e) => e.target.value && setQ(e.target.value)} value=""><option value="">Pick from library…</option>{mols.map((m) => <option key={m.id} value={m.canon}>{m.name}</option>)}</select><button className="btn primary" onClick={go}>Search</button></div>
        {error && <div style={{ marginTop: 10 }}><Callout kind="err">{error}</Callout></div>}
      </Card>
      {hits.length > 0 && <Card title="Nearest neighbours" sub={`${hits.length} compared`} pad={false}>
        <div className="mol-grid" style={{ maxHeight: 620, overflow: 'auto' }}>
          {qsvg && <div className="mol-card" style={{ borderColor: 'var(--accent)' }}><MolSvg svg={qsvg} /><div className="nm">Query</div></div>}
          {hits.slice(0, 23).map(({ m, s }) => <div key={m.id} className="mol-card"><MolSvg svg={m.svg} /><div className="nm" title={m.name}>{m.name}</div><div className="pp"><span style={{ color: s > 0.5 ? 'var(--accent-3)' : undefined }}>Tc {s.toFixed(2)}</span></div></div>)}
        </div></Card>}
    </>
  );
}

function SubstructureView({ mols }: { mols: Mol[] }) {
  const [smarts, setSmarts] = useState('c1ccccc1C(=O)O');
  const [hits, setHits] = useState<{ m: Mol; svg: string }[] | null>(null);
  const { run, error } = useRunner();
  const presets = useMemo(() => [['Benzene ring', 'c1ccccc1'], ['Carboxylic acid', 'C(=O)[OH]'], ['Basic amine', '[NX3;H2,H1,H0;!$(NC=O)]'], ['Halogen', '[F,Cl,Br,I]'], ['Sulfonamide', 'S(=O)(=O)N']], []);
  const ref = useRef(0);
  const go = () => {
    const id = ++ref.current;
    void run({ label: 'Substructure search', tool: TOOLS.sub, params: { smarts, n: mols.length }, inputs: [{ name: 'library', data: mols.map((m) => m.canon).join('\n') }], run: async (h) => {
      const r = await chemCall<{ i: number; svg: string }[]>('substruct', { smarts, smiles: mols.map((m) => m.smiles) }, { signal: h.signal });
      return r.map((x) => ({ m: mols[x.i], svg: x.svg }));
    } }).then((r) => { if (r && id === ref.current) setHits(r); });
  };
  return (
    <>
      <Card title="SMARTS query">
        <div className="row" style={{ alignItems: 'flex-end' }}><div style={{ flex: 1, minWidth: 240 }}><Field label="SMARTS"><input className="input mono" value={smarts} onChange={(e) => setSmarts(e.target.value)} /></Field></div><button className="btn primary" onClick={go}>Search</button></div>
        <div className="row" style={{ marginTop: 10 }}>{presets.map(([n, s]) => <button key={n} className="btn sm" onClick={() => setSmarts(s)}>{n}</button>)}</div>
        {error && <div style={{ marginTop: 10 }}><Callout kind="err">{error}</Callout></div>}
      </Card>
      {hits && <Card title="Matches" sub={`${hits.length} of ${mols.length}`} pad={false}>{hits.length ? <div className="mol-grid" style={{ maxHeight: 620, overflow: 'auto' }}>{hits.map(({ m, svg }) => <div key={m.id} className="mol-card"><MolSvg svg={svg} /><div className="nm">{m.name}</div></div>)}</div> : <div className="faint" style={{ padding: 18 }}>No molecules match.</div>}</Card>}
    </>
  );
}

const SPACE_TOOL: ToolInfo = { id: 'chem.space', name: 'Chemical space & clustering', version: V, engine: 'TypeScript worker kernels on RDKit fingerprints', citations: ['rdkit', 'rogers2010', 'butina1999'], describe: (p) => `Compounds (n = ${p.n}) were clustered with the Taylor–Butina algorithm on Morgan-fingerprint Tanimoto similarity (cutoff ${p.cutoff}) and projected into two dimensions by principal component analysis of the fingerprint bit matrix` };
function SpaceView({ mols }: { mols: Mol[] }) {
  const { run, busy, error } = useRunner(); const [cutoff, setCutoff] = useState(0.6); const [res, setRes] = useState<Awaited<ReturnType<typeof qsarRemote.space>> | null>(null);
  const go = () => void run({ label: `Clustering · ${mols.length}`, tool: SPACE_TOOL, params: { n: mols.length, cutoff }, inputs: [{ name: 'library', data: mols.map((m) => m.canon).join('\n') }], run: (h) => qsarRemote.space({ fp: mols.map((m) => m.fp), cutoff }, h) }).then((r) => r && setRes(r));
  const top = res ? res.sizes.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 10).map((x) => x[1]) : [], col = catColors(11);
  const pts: Pt[] = res ? res.xy.map((p, i) => { const t = top.indexOf(res.cluster[i]); return { x: p.x, y: p.y, cat: t < 0 ? 0 : t + 1, label: `${mols[i].name} · cluster ${res.cluster[i]}` }; }) : [];
  return (
    <>
      <Card title="Chemical space" sub="Taylor–Butina clusters + PCA of Morgan fingerprints" actions={<><label className="row dim" style={{ fontSize: 12 }}>Tanimoto ≥ <input className="input" type="number" step={0.05} min={0.2} max={0.95} value={cutoff} onChange={(e) => setCutoff(+e.target.value)} style={{ width: 70 }} /></label><button className="btn primary sm" disabled={busy || mols.length < 3} onClick={go}>Cluster</button></>}>
        {error && <Callout kind="err">{error}</Callout>}
        {res ? <><div className="cols-4" style={{ marginBottom: 12 }}><Stat label="Clusters" value={res.sizes.length} /><Stat label="Singletons" value={res.sizes.filter((s) => s === 1).length} /><Stat label="Largest" value={Math.max(...res.sizes)} /><Stat label="Diversity" value={fmt(res.sizes.length / mols.length, 2)} hint="clusters ÷ compounds" /></div><Scatter points={pts} colors={[cssVar('--chart-mute'), ...col]} names={['other', ...top.map((c) => `cluster ${c}`)]} xLabel="PC1" yLabel="PC2" height={420} radius={4} /></> : <div className="faint">Cluster to see structural families and the library's coverage of chemical space.</div>}
      </Card>
      {res && <Card title="Cluster representatives" pad={false} actions={<button className="btn sm" onClick={() => downloadText('clusters.csv', toCsv(mols.map((m, i) => ({ name: m.name, smiles: m.canon, cluster: res.cluster[i], centroid: res.centroids[res.cluster[i]] === i }))), 'text/csv')}>CSV</button>}><div className="mol-grid" style={{ maxHeight: 460, overflow: 'auto' }}>{top.map((c) => { const m = mols[res.centroids[c]]; return <div key={c} className="mol-card"><MolSvg svg={m.svg} /><div className="nm" title={m.name}>{m.name}</div><div className="pp"><span>cluster {c}</span><span>n = {res.sizes[c]}</span></div></div>; })}</div></Card>}
    </>
  );
}

const QSAR_TOOL: ToolInfo = { id: 'chem.qsar', name: 'QSAR modelling', version: V, engine: 'RDKit fingerprints/descriptors; TypeScript random forest / kNN / ridge', citations: ['rdkit', 'rogers2010', 'breiman2001', 'butina1999', 'oecd2007'], describe: (p) => `A ${p.task} QSAR model (${p.kind === 'rf' ? `random forest, ${p.nTrees} trees` : p.kind === 'knn' ? `${p.k}-nearest-neighbour on Tanimoto similarity` : 'ridge regression'}) was trained on ${p.n} compounds with ${p.features} features; performance was estimated by ${p.kFold}-fold ${p.cv}-split cross-validation${p.yRand ? ' with Y-randomisation' : ''} and applicability domain by maximum Tanimoto similarity to the training set` };
interface QDataset { names: string[]; smiles: string[]; y: number[]; desc: Float32Array[]; fp: Uint32Array[]; descNames: string[]; source: string }
const fpToX = (w: Uint32Array) => { const x = new Float32Array(w.length * 32); for (let i = 0; i < x.length; i++) x[i] = (w[i >> 5] >>> (i & 31)) & 1; return x; };
function QsarLab({ mols, columns, descNames, ready }: { mols: Mol[]; columns: string[]; descNames: string[]; ready: boolean }) {
  const prep = useRunner(), fit = useRunner(), pred = useRunner();
  const [src, setSrc] = useState<'library' | 'chembl'>(columns.length ? 'library' : 'chembl'), [col, setCol] = useState(columns[0] ?? ''), [tr, setTr] = useState<'asis' | 'nm'>('asis');
  const [ds, setDs] = useState<QDataset | null>(null), [msg, setMsg] = useState('');
  const [tq, setTq] = useState('EGFR'), [targets, setTargets] = useState<ChemblTarget[]>([]), [target, setTarget] = useState(''), [maxRec, setMaxRec] = useState(1500), [fetching, setFetching] = useState(false);
  const [task, setTask] = useState<'regression' | 'classification'>('regression'), [thr, setThr] = useState(6.5), [feat, setFeat] = useState<'fp' | 'desc' | 'both'>('fp'), [kind, setKind] = useState<'rf' | 'knn' | 'ridge'>('rf'), [nTrees, setNTrees] = useState(150), [k, setK] = useState(5), [kFold, setKFold] = useState(5), [cv, setCv] = useState<'random' | 'cluster'>('cluster'), [yRand, setYRand] = useState(true), [adCut] = useState(0.3);
  const [res, setRes] = useState<QsarResult | null>(null), [q, setQ] = useState('CC(=O)OC1=CC=CC=C1C(=O)O\nCOCCOC1=C(OCCOC)C=C2C(NC3=CC=CC(=C3)C#C)=NC=NC2=C1'), [qres, setQres] = useState<{ name: string; smiles: string; pred: number; maxSim: number; svg: string }[] | null>(null);
  useEffect(() => { if (columns.length && !col) setCol(columns[0]); }, [columns, col]);
  const fromLibrary = () => { const rows = mols.map((m) => ({ m, v: Number(m.extra[col]) })).filter((r) => Number.isFinite(r.v) && String(r.m.extra[col]).trim() !== ''); if (rows.length < 20) { setMsg(`Only ${rows.length} compounds have a numeric “${col}” value. QSAR needs at least 20.`); return; } setDs({ names: rows.map((r) => r.m.name), smiles: rows.map((r) => r.m.canon), y: rows.map((r) => (tr === 'nm' ? toPActivity(r.v) : r.v)), desc: rows.map((r) => r.m.desc), fp: rows.map((r) => r.m.fp), descNames, source: `library column “${col}”${tr === 'nm' ? ' (nM → pActivity)' : ''}` }); setMsg(''); setRes(null); };
  const search = async () => { try { setMsg('Searching ChEMBL…'); const t = await chemblTargets(tq); setTargets(t); setTarget(t[0]?.id ?? ''); setMsg(t.length ? '' : 'No single-protein targets found.'); } catch (e) { setMsg((e as Error).message); } };
  const fetchChembl = async () => { if (!confirm(`This sends the target ID "${target}" to the ChEMBL web service (EMBL-EBI) to download its measured activities. No molecules from your library are sent.\n\nContinue?`)) return; setFetching(true); try { setMsg('Downloading activities…'); const { rows, total } = await chemblActivities(target, maxRec, (f) => setMsg(`Downloading activities… ${Math.round(f * 100)}%`)); const agg = aggregateActivities(rows); if (agg.length < 20) throw new Error(`Only ${agg.length} unique compounds with pChEMBL values (of ${total} records).`); setMsg(`Preparing ${agg.length} compounds…`); const out = await prep.run<{ mols: Mol[]; descNames: string[]; failed: unknown[] }>({ label: `ChEMBL ${target} features`, tool: QSAR_TOOL, params: { task: 'regression', kind: 'features', nTrees: 0, k: 0, n: agg.length, features: 'fp+desc', kFold: 0, cv: '-', yRand: false }, inputs: [{ name: target, data: agg.map((a) => a.id).join(',') }], run: (h) => chemCall('process', { items: agg.map((a) => ({ name: a.id, smiles: a.smiles, extra: { y: String(a.y) } })), radius: FP_RADIUS, nBits: FP_BITS, light: true }, { onProgress: h.onProgress, signal: h.signal }), summary: () => `Bioactivity data for ${target} were retrieved from ChEMBL (CC BY-SA 3.0), aggregated to the median pChEMBL per compound` }); if (!out) return; const byId = new Map(agg.map((a) => [a.id, a.y])); setDs({ names: out.mols.map((m) => m.name), smiles: out.mols.map((m) => m.canon), y: out.mols.map((m) => byId.get(m.name)!), desc: out.mols.map((m) => m.desc), fp: out.mols.map((m) => m.fp), descNames: out.descNames, source: `ChEMBL ${target}, median pChEMBL (n = ${out.mols.length})` }); setMsg(''); setRes(null); } catch (e) { setMsg((e as Error).message); } finally { setFetching(false); } };
  const build = (d: { desc: Float32Array[]; fp: Uint32Array[] }, f = feat) => d.desc.map((ds_, i) => { if (f === 'desc') return ds_; const fx = fpToX(d.fp[i]); if (f === 'fp') return fx; const x = new Float32Array(fx.length + ds_.length); x.set(fx); x.set(ds_, fx.length); return x; });
  const names = (f = feat) => (f === 'desc' ? ds?.descNames ?? [] : [...(f === 'both' || f === 'fp' ? Array.from({ length: FP_BITS }, (_, i) => `Morgan bit ${i}`) : []), ...(f === 'both' ? ds?.descNames ?? [] : [])]);
  const run_ = () => { if (!ds) return; const fe = kind === 'ridge' ? 'desc' : feat; const y = task === 'classification' ? ds.y.map((v) => (v >= thr ? 1 : 0)) : ds.y; void fit.run({ label: `QSAR · ${kind} · ${task}`, tool: QSAR_TOOL, params: { task, kind, nTrees, k, n: ds.y.length, features: fe, kFold, cv, yRand }, inputs: [{ name: 'dataset', data: ds.smiles.join('\n') + ds.y.join(',') }], run: (h) => qsarRemote.run({ task, kind, nTrees, k, kFold, cv, yRand, y, X: build(ds, fe), fp: ds.fp, featNames: names(fe), adCut }, h) }).then((r) => r && setRes(r)); };
  const predict = async () => { if (!ds || !res) return; const smiles = q.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 200); const fe = kind === 'ridge' ? 'desc' : feat; const out = await pred.run<{ mols: Mol[] }>({ label: `QSAR predict · ${smiles.length}`, tool: QSAR_TOOL, params: { task, kind, nTrees, k, n: smiles.length, features: fe, kFold, cv, yRand: false }, inputs: [{ name: 'query', data: smiles.join('\n') }], run: async (h) => { const f = await chemCall<{ mols: Mol[] }>('process', { items: smiles.map((s, i) => ({ name: `q${i + 1}`, smiles: s, extra: {} })), radius: FP_RADIUS, nBits: FP_BITS }, { signal: h.signal }); const p = await qsarRemote.predict({ X: build({ desc: f.mols.map((m) => m.desc), fp: f.mols.map((m) => m.fp) }, fe), fp: f.mols.map((m) => m.fp) }, { signal: h.signal }); return { mols: f.mols.map((m, i) => ({ ...m, extra: { pred: String(p.pred[i]), sim: String(p.maxSim[i]) } })) }; }, summary: () => 'New compounds were scored with the trained model; applicability domain was assessed by maximum Tanimoto similarity to the training set' }); if (out) setQres(out.mols.map((m) => ({ name: m.name, smiles: m.canon, pred: Number(m.extra.pred), maxSim: Number(m.extra.sim), svg: m.svg }))); };
  const isReg = task === 'regression', met = res?.metrics ?? {};
  return (
    <>
      <Card title="1 · Dataset" sub={ds ? ds.source : 'activity values for a set of compounds'}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="row"><div className="tabs"><button className="tab" aria-selected={src === 'library'} onClick={() => setSrc('library')}><span>My library</span></button><button className="tab" aria-selected={src === 'chembl'} onClick={() => setSrc('chembl')}><span>ChEMBL target</span></button></div></div>
          {src === 'library' ? <div className="row" style={{ alignItems: 'flex-end' }}>{columns.length ? <><Field label="Activity column"><select className="select" value={col} onChange={(e) => setCol(e.target.value)}>{columns.map((c) => <option key={c}>{c}</option>)}</select></Field><Field label="Values are"><select className="select" value={tr} onChange={(e) => setTr(e.target.value as 'asis' | 'nm')}><option value="asis">already pIC50 / pKi / numeric</option><option value="nm">IC50 / Ki in nM → −log10(M)</option></select></Field><button className="btn primary" disabled={!mols.length} onClick={fromLibrary}>Use column</button></> : <div className="faint">Load a CSV with a smiles column <i>and</i> an activity column in the Library tab (e.g. <code>name,smiles,pIC50</code>), or switch to ChEMBL.</div>}</div>
          : <div className="stack" style={{ gap: 10 }}><div className="row" style={{ alignItems: 'flex-end' }}><Field label="Target name or gene"><input className="input" value={tq} onChange={(e) => setTq(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} style={{ width: 160 }} /></Field><button className="btn" onClick={() => void search()}>Search ChEMBL</button>{targets.length > 0 && <Field label="Target"><select className="select" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 260 }}>{targets.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.organism} · {t.id}</option>)}</select></Field>}<Field label="Max records"><select className="select" value={maxRec} onChange={(e) => setMaxRec(+e.target.value)}>{[500, 1000, 1500, 3000].map((v) => <option key={v}>{v}</option>)}</select></Field><button className="btn primary" disabled={!target || fetching || !ready} onClick={() => void fetchChembl()}>Fetch activities</button></div><div className="faint" style={{ fontSize: 12 }}>pChEMBL = ChEMBL's standardised −log10 molar potency (exact “=” measurements only), median per compound. Data: ChEMBL, CC BY-SA 3.0, EMBL-EBI.</div></div>}
          {(prep.busy || fetching) && <Busy progress={prep.progress} note={prep.note ?? msg} />}{msg && !fetching && <Callout kind={ds ? undefined : 'warn'}>{msg}</Callout>}{prep.error && <Callout kind="err">{prep.error}</Callout>}
          {ds && <div className="cols-4"><Stat label="Compounds" value={ds.y.length} /><Stat label="Mean y" value={fmt(ds.y.reduce((a, b) => a + b, 0) / ds.y.length, 2)} /><Stat label="Min" value={fmt(Math.min(...ds.y), 2)} /><Stat label="Max" value={fmt(Math.max(...ds.y), 2)} /></div>}
          {ds && <Histogram values={ds.y} label="activity" bins={24} height={150} />}
        </div>
      </Card>
      {ds && <Card title="2 · Model & validation" actions={<button className="btn primary sm" disabled={fit.busy} onClick={run_}>Train & validate</button>}>
        <div className="cols-3" style={{ gap: 10 }}>
          <Field label="Task"><select className="select" value={task} onChange={(e) => setTask(e.target.value as typeof task)}><option value="regression">Regression (activity value)</option><option value="classification">Classification (active / inactive)</option></select></Field>
          {task === 'classification' && <Field label="Active if y ≥"><input className="input" type="number" step={0.1} value={thr} onChange={(e) => setThr(+e.target.value)} /></Field>}
          <Field label="Model"><select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="rf">Random forest</option><option value="knn">kNN (Tanimoto)</option><option value="ridge">Ridge regression</option></select></Field>
          <Field label="Features"><select className="select" value={kind === 'ridge' ? 'desc' : feat} disabled={kind === 'ridge' || kind === 'knn'} onChange={(e) => setFeat(e.target.value as typeof feat)}><option value="fp">Morgan fingerprint (2048)</option><option value="desc">RDKit descriptors ({ds.descNames.length})</option><option value="both">Both</option></select></Field>
          {kind === 'rf' && <Field label="Trees"><input className="input" type="number" min={20} max={500} value={nTrees} onChange={(e) => setNTrees(+e.target.value)} /></Field>}
          {kind === 'knn' && <Field label="k neighbours"><input className="input" type="number" min={1} max={25} value={k} onChange={(e) => setK(+e.target.value)} /></Field>}
          <Field label="Cross-validation"><select className="select" value={cv} onChange={(e) => setCv(e.target.value as typeof cv)}><option value="cluster">Cluster-grouped (stricter)</option><option value="random">Random</option></select></Field>
          <Field label="Folds"><input className="input" type="number" min={3} max={10} value={kFold} onChange={(e) => setKFold(+e.target.value)} /></Field>
          <label className="row dim" style={{ fontSize: 12.5, alignSelf: 'end' }}><input type="checkbox" checked={yRand} onChange={(e) => setYRand(e.target.checked)} /> Y-randomisation test</label>
        </div>
        {fit.busy && <div style={{ marginTop: 12 }}><Busy progress={fit.progress} note={fit.note} /></div>}{fit.error && <div style={{ marginTop: 12 }}><Callout kind="err">{fit.error}</Callout></div>}
        <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>Cluster-grouped CV keeps near-duplicate analogues in the same fold, which gives a more honest estimate of performance on genuinely new chemotypes.</div>
      </Card>}
      {res && ds && <>
        <div className="cols-4">{isReg ? <><Stat label="CV R²" value={fmt(met.r2, 3)} /><Stat label="CV RMSE" value={fmt(met.rmse, 3)} /><Stat label="CV MAE" value={fmt(met.mae, 3)} /><Stat label="Spearman ρ" value={fmt(met.spearman, 3)} /></> : <><Stat label="CV AUC" value={fmt(met.auc, 3)} /><Stat label="Balanced acc." value={fmt(met.balancedAccuracy, 3)} /><Stat label="MCC" value={fmt(met.mcc, 3)} /><Stat label="Sens / Spec" value={`${fmt(met.sensitivity, 2)} / ${fmt(met.specificity, 2)}`} /></>}</div>
        {res.oob && <Callout>Out-of-bag estimate (internal, from the final forest): {isReg ? `R² ${fmt(res.oob.r2, 3)}, RMSE ${fmt(res.oob.rmse, 3)}` : `AUC ${fmt(res.oob.auc, 3)}`}. Trust the cross-validated numbers above for new chemotypes.</Callout>}
        <div className="cols-2">
          {isReg ? <Card title="Predicted vs experimental" sub="cross-validated"><Scatter points={[...res.pred.map((p, i) => ({ x: ds.y[i], y: p, cat: 0, label: ds.names[i] })).filter((p) => Number.isFinite(p.y)), ...[Math.min(...ds.y), Math.max(...ds.y)].map((v) => ({ x: v, y: v, cat: 1, label: 'ideal' }))]} colors={[cssVar('--chart-a'), cssVar('--text-faint')]} xLabel="Experimental" yLabel="Predicted (CV)" height={340} equalAspect /></Card>
            : <Card title="ROC curve" sub={`AUC ${fmt(met.auc, 3)}`}><MultiLine xs={res.roc.map((r) => r.fpr)} yMin={0} yMax={1} series={[{ name: 'model', ys: res.roc.map((r) => r.tpr), color: cssVar('--chart-a') }, { name: 'chance', ys: res.roc.map((r) => r.fpr), color: cssVar('--text-faint') }]} xLabel="False positive rate" yLabel="True positive rate" height={320} /></Card>}
          <Card title="Top features" sub={kind === 'ridge' ? '|standardised coefficient|' : 'impurity importance'}>{res.importance.length ? <BarChart labels={res.importance.slice(0, 12).map((f) => f.name.replace('Morgan bit ', 'bit '))} values={res.importance.slice(0, 12).map((f) => f.value)} colors={[cssVar('--chart-c')]} yLabel="Relative importance" fmt={(v) => v.toFixed(2)} height={320} /> : <div className="faint">kNN has no feature importance.</div>}</Card>
          <Card title="Applicability domain" sub="CV error vs similarity to nearest other compound"><BarChart labels={res.errByAd.map((b) => `${b.lo.toFixed(1)}–${Math.min(1, b.hi).toFixed(1)} (n=${b.n})`)} values={res.errByAd.map((b) => (Number.isFinite(b.err) ? b.err : 0))} colors={[cssVar('--chart-b')]} yLabel={isReg ? 'RMSE' : 'RMSE (prob.)'} fmt={(v) => v.toFixed(2)} height={300} /><div className="faint" style={{ fontSize: 12 }}>Error rises as compounds get less similar to the training set. Treat predictions with max similarity below {adCut} as outside the domain.</div></Card>
          {res.yRand.length > 0 && <Card title="Y-randomisation" sub="should collapse to ~0"><div className="stack" style={{ gap: 8 }}><div className="cols-2"><Stat label={`Real ${isReg ? 'R²' : 'AUC'}`} value={fmt(isReg ? met.r2 : met.auc, 3)} /><Stat label="Scrambled (max)" value={fmt(Math.max(...res.yRand), 3)} /></div><Callout kind={Math.max(...res.yRand) > (isReg ? 0.2 : 0.65) ? 'warn' : undefined}>{Math.max(...res.yRand) > (isReg ? 0.2 : 0.65) ? 'Scrambled labels still give signal: the model may be exploiting chance correlations or leakage.' : 'Scrambled labels give no predictive power, as expected for a model that learned real structure–activity signal.'}</Callout></div></Card>}
          <Card title="Dataset" sub={`${res.nTrain} compounds · ${res.nFeat} features · ${res.clusters} Butina clusters`}><div className="faint" style={{ fontSize: 13 }}>A high compound-to-cluster ratio means many close analogues; random-split metrics will then be optimistic. Compare random vs cluster-grouped CV.</div></Card>
        </div>
        <Card title="3 · Predict new compounds" sub="SMILES, one per line" actions={<><button className="btn primary sm" disabled={pred.busy} onClick={() => void predict()}>Predict</button><button className="btn sm" onClick={() => downloadText('model_card.json', JSON.stringify({ standard: 'OECD QSAR validation principles', endpoint: ds.source, task, algorithm: kind, features: kind === 'ridge' ? 'descriptors' : feat, nTrain: ds.y.length, validation: { kFold, split: cv, metrics: met, oob: res.oob, yRandomisation: res.yRand }, applicabilityDomain: `max Tanimoto (Morgan r=2, 2048) to training set; flagged below ${adCut}`, software: 'Workbench ' + V, license: 'model trained on user data; ChEMBL-derived data are CC BY-SA 3.0' }, null, 2), 'application/json')}>Model card</button></>}>
          <textarea className="input" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} style={{ minHeight: 90 }} />{pred.error && <Callout kind="err">{pred.error}</Callout>}
          {qres && <div style={{ marginTop: 10 }}><DataTable rows={qres} rowKey={(r) => r.name} cols={[{ key: 'svg', label: '', render: (r) => <div style={{ width: 80, height: 60, background: '#fff', borderRadius: 6, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: r.svg }} /> }, { key: 'name', label: 'ID' }, { key: 'smiles', label: 'SMILES', render: (r) => <code>{r.smiles.slice(0, 40)}</code> }, { key: 'pred', label: isReg ? 'Predicted' : 'P(active)', num: true, render: (r) => fmt(r.pred, 3), sort: (r) => r.pred }, { key: 'maxSim', label: 'Max Tanimoto', num: true, render: (r) => fmt(r.maxSim, 2), sort: (r) => r.maxSim }, { key: 'ad', label: 'Domain', render: (r) => <span className={`badge ${r.maxSim >= adCut ? 'live' : 'building'}`}>{r.maxSim >= adCut ? 'inside' : 'outside'}</span> }]} /></div>}
        </Card>
      </>}
    </>
  );
}
