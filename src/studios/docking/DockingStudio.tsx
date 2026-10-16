import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import { assetUrl } from '@/core/asset';
import { trackedFetch } from '@/core/net';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, toCsv, type Col } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { listLigands, parseStructure, type Interaction, type Structure } from '../structure/geometry';
import { pubchemByName } from '../chemistry/sources';
import type { DockingKernels, LigandPrep } from './docking.worker';
import { boxFromAtoms, boxFromResidues, manualBox, type Box } from './box';
import { crystalLigand, redockRmsd, type CrystalLigand } from './crystal';
import { parseMolBlock } from './molgraph';
import { poseToPdb, posesToPdbqt, posesToSdf, typeElement, type Pose } from './pdbqt';
import { DockViewer } from './DockViewer';
import { LIMITS, type DockParams } from './vina';

const remote = createRemote<DockingKernels>(() => new Worker(new URL('./docking.worker.ts', import.meta.url), { type: 'module' }));

const TOOL: ToolInfo = {
  id: 'docking.vina', name: 'Molecular docking', version: '0.1.0', engine: 'AutoDock Vina 1.2.7 (WebAssembly) + RDKit + TypeScript preparation',
  citations: ['trott2010', 'eberhardt2021', 'rdkit', 'gasteiger1980', 'blaney1994', 'rcsb', 'alphafold'],
  describe: (p) => `${p.ligands} ligand(s) were docked into ${p.receptor} with AutoDock Vina 1.2.7 (exhaustiveness ${p.exhaustiveness}, ${p.nPoses} poses, seed ${p.seed}, ${p.scoring} scoring, ${p.threads} thread(s)) in a ${(p.size as number[]).map((x) => (x as number).toFixed(0)).join('×')} Å box centred at (${(p.center as number[]).map((x) => (x as number).toFixed(1)).join(', ')}). The receptor was protonated at pH 7.4 with polar hydrogens and Gasteiger charges; ligands were protonated at pH 7.4, embedded in 3-D by distance geometry and given Gasteiger charges`,
};

type RecSrc = 'pdb' | 'af' | 'file';
type LigSrc = 'smiles' | 'pubchem' | 'file';
type BoxMode = 'ligand' | 'residues' | 'manual';
interface Receptor { text: string; label: string; format: 'pdb' | 'mmcif'; struct: Structure; chains: string[]; ligands: ReturnType<typeof listLigands>; af?: boolean }
interface Result { name: string; smiles?: string; prep?: LigandPrep; poses: Pose[]; seconds: number; rmsd?: number[] | null; error?: string; threads?: number }
interface PoseRow { p: Pose; i: number }
const poseCols = (cur: Result, poseIdx: number): Col<PoseRow>[] => [
  { key: 'pose', label: 'Pose', num: true, render: (r) => (r.i === poseIdx ? `▶ ${r.i + 1}` : String(r.i + 1)), sort: (r) => r.i },
  { key: 'aff', label: 'Affinity (kcal/mol)', num: true, render: (r) => r.p.affinity.toFixed(2), sort: (r) => r.p.affinity },
  { key: 'lb', label: 'RMSD l.b. (Å)', num: true, render: (r) => r.p.rmsdLb.toFixed(2), sort: (r) => r.p.rmsdLb },
  { key: 'ub', label: 'RMSD u.b. (Å)', num: true, render: (r) => r.p.rmsdUb.toFixed(2), sort: (r) => r.p.rmsdUb },
  ...(cur.rmsd ? [{ key: 'xl', label: 'RMSD to crystal (Å)', num: true, render: (r: PoseRow) => cur.rmsd![r.i].toFixed(2), sort: (r: PoseRow) => cur.rmsd![r.i] }] : []),
];
const EXAMPLES = [['1HSG', 'HIV-1 protease'], ['3PTB', 'trypsin + benzamidine'], ['4DFR', 'DHFR + methotrexate'], ['1STP', 'streptavidin + biotin']];
const INDINAVIR = 'CC(C)(C)NC(=O)[C@@H]1CN(CCN1C[C@H](C[C@@H](Cc2ccccc2)C(=O)N[C@H]3[C@H](Cc4ccccc34)O)O)Cc5cccnc5';
const ELEMENT_BY_TYPE = (t: string) => typeElement(t);

function parseLigandLines(text: string): { name: string; smiles: string }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l, i) => {
    const parts = l.split(/[\s,;\t]+/); const smiles = parts[0]; const name = parts.slice(1).join('_') || `ligand${i + 1}`;
    return { name: name.replace(/[^\w.-]+/g, '_').slice(0, 40), smiles };
  }).filter((x) => x.smiles.toLowerCase() !== 'smiles');
}
const parseResidues = (s: string) => s.split(/[\s,;]+/).filter(Boolean).map((t) => { const m = t.match(/^([A-Za-z0-9]?)[:_]?(-?\d+)$/); return m ? { chain: m[1] || 'A', seq: +m[2] } : null; }).filter((x): x is { chain: string; seq: number } => !!x);

export default function DockingStudio() {
  const { run, busy, progress, note, error, cancel, setError } = useRunner();
  const [recSrc, setRecSrc] = useState<RecSrc>('pdb');
  const [pdbId, setPdbId] = useState('1HSG'), [uni, setUni] = useState('P69905');
  const [rec, setRec] = useState<Receptor | null>(null);
  const [chains, setChains] = useState<string[]>([]);
  const [ligSrc, setLigSrc] = useState<LigSrc>('smiles');
  const [smilesText, setSmilesText] = useState(INDINAVIR + ' indinavir'), [pubName, setPubName] = useState('imatinib'), [fileLig, setFileLig] = useState<{ text: string; name: string; kind: 'sdf' | 'mol2' } | null>(null);
  const [protonate, setProtonate] = useState(true);
  const [boxMode, setBoxMode] = useState<BoxMode>('ligand');
  const [ligKey, setLigKey] = useState(''), [resText, setResText] = useState(''), [pad, setPad] = useState(6);
  const [man, setMan] = useState({ cx: 0, cy: 0, cz: 0, sx: 22, sy: 22, sz: 22 });
  const [exh, setExh] = useState(8), [nPoses, setNPoses] = useState(9), [seed, setSeed] = useState(1), [scoring, setScoring] = useState<'vina' | 'vinardo'>('vina'), [threads, setThreads] = useState(1);
  const [caps, setCaps] = useState<{ isolated: boolean; threads: number; rdkit: string } | null>(null);
  const [results, setResults] = useState<Result[]>([]), [sel, setSel] = useState(0), [poseIdx, setPoseIdx] = useState(0);
  const [runInfo, setRunInfo] = useState<{ box: Box; receptor: string; atoms: number; warnings: string[]; seconds: number; threads: number } | null>(null);
  const [inter, setInter] = useState<Interaction[] | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { void remote.caps(undefined as never).then((c) => { setCaps(c); setThreads(c.isolated ? Math.min(8, c.threads) : 1); }).catch(() => setCaps({ isolated: false, threads: 1, rdkit: '?' })); }, []);

  const setReceptor = useCallback((text: string, label: string, af = false) => {
    const struct = parseStructure(text);
    if (!struct.atoms.length) throw new Error('No atoms found in this file.');
    const format = /^data_|^_atom_site/m.test(text.slice(0, 4000)) && !/^ATOM  /m.test(text.slice(0, 4000)) ? 'mmcif' : 'pdb';
    const ligands = listLigands(struct), chainIds = [...new Set(struct.atoms.filter((a) => !a.het).map((a) => a.chain))];
    setRec({ text, label, format, struct, chains: chainIds, ligands, af }); setChains(chainIds); setLigKey(ligands[0]?.key ?? ''); setBoxMode(ligands.length ? 'ligand' : 'residues');
    setResults([]); setInter(null); setRunInfo(null);
  }, []);

  const loadPdb = (id: string) => void run({ label: `Fetch PDB ${id.toUpperCase()}`, tool: { ...TOOL, id: 'docking.receptor', name: 'Receptor retrieval', describe: () => `Structure ${id.toUpperCase()} was retrieved from the RCSB PDB` }, params: { id }, inputs: [], run: async () => {
    const code = id.trim().toUpperCase(); if (!/^[0-9][A-Z0-9]{3}$/.test(code)) throw new Error('A PDB ID is 4 characters, e.g. 1HSG.');
    const text = await trackedFetch(`https://files.rcsb.org/download/${code}.cif`).then((r) => r.text()); setReceptor(text, code);
  } });
  const loadAf = (acc: string) => void run({ label: `Fetch AlphaFold ${acc.toUpperCase()}`, tool: { ...TOOL, id: 'docking.receptor', name: 'Receptor retrieval', describe: () => `The AlphaFold DB model for ${acc.toUpperCase()} was retrieved` }, params: { acc }, inputs: [], run: async () => {
    const a = acc.trim().toUpperCase(); if (!/^[A-Z0-9]{6,10}$/.test(a)) throw new Error('Enter a UniProt accession, e.g. P69905.');
    const meta = await trackedFetch(`https://alphafold.ebi.ac.uk/api/prediction/${a}`).then((r) => r.json()); const e = meta?.[0]; if (!e?.cifUrl) throw new Error('No AlphaFold model for this accession.');
    setReceptor(await trackedFetch(e.cifUrl).then((r) => r.text()), `AlphaFold ${a}`, true);
  } });
  const loadFile = (text: string, name: string) => { try { setReceptor(text, name); setError(null); } catch (e) { setError((e as Error).message); } };
  const loadDemo = async () => {
    try {
      const text = await (await fetch(assetUrl('data/docking/1HSG.pdb'))).text(); setReceptor(text, '1HSG (bundled copy)');
      setSmilesText(INDINAVIR + ' indinavir'); setLigSrc('smiles'); setBoxMode('ligand'); setLigKey(listLigands(parseStructure(text)).find((l) => l.res === 'MK1')?.key ?? ''); setPad(6);
    } catch (e) { setError((e as Error).message); }
  };

  const ligandList = useMemo(() => (ligSrc === 'smiles' ? parseLigandLines(smilesText) : []), [ligSrc, smilesText]);
  const box = useMemo<{ box?: Box; xl?: CrystalLigand; err?: string }>(() => {
    if (!rec) return {};
    try {
      if (boxMode === 'ligand') { const l = rec.ligands.find((x) => x.key === ligKey); if (!l) return { err: 'This structure has no co-crystallised ligand: use residues or coordinates.' }; const xl = crystalLigand(rec.struct, l.res, l.chain); return { box: boxFromAtoms(xl.atoms, pad, 18), xl }; }
      if (boxMode === 'residues') return { box: boxFromResidues(rec.struct.atoms, parseResidues(resText), pad, 18) };
      return { box: manualBox([man.cx, man.cy, man.cz], [man.sx, man.sy, man.sz]) };
    } catch (e) { return { err: (e as Error).message }; }
  }, [rec, boxMode, ligKey, resText, pad, man]);

  const dockAll = async () => {
    if (!rec || !box.box) return;
    setLocalErr(null); setResults([]); setSel(0); setPoseIdx(0); setInter(null);
    let entries: { name: string; kind: 'smiles' | 'sdf' | 'mol2'; text: string }[] = [];
    try {
      if (ligSrc === 'smiles') entries = ligandList.map((l) => ({ name: l.name, kind: 'smiles' as const, text: l.smiles }));
      else if (ligSrc === 'pubchem') { const h = await pubchemByName(pubName); entries = [{ name: pubName.trim().replace(/[^\w.-]+/g, '_'), kind: 'smiles', text: h.smiles }]; }
      else if (fileLig) entries = [{ name: fileLig.name.replace(/\.[^.]+$/, ''), kind: fileLig.kind, text: fileLig.text }];
      if (!entries.length) throw new Error('Add at least one ligand.');
      if (entries.length > LIMITS.maxScreen) throw new Error(`A screen is limited to ${LIMITS.maxScreen} ligands in the browser (you entered ${entries.length}).`);
    } catch (e) { setLocalErr((e as Error).message); return; }
    const params: DockParams = { center: box.box.center, size: box.box.size, exhaustiveness: exh, nPoses, seed, scoring };
    const nThr = caps?.isolated ? threads : 1;
    abort.current = new AbortController();
    await run({
      label: entries.length > 1 ? `Dock ${entries.length} ligands · ${rec.label}` : `Dock ${entries[0].name} · ${rec.label}`, tool: TOOL,
      params: { ligands: entries.length, receptor: rec.label, exhaustiveness: exh, nPoses, seed, scoring, threads: nThr, size: box.box.size, center: box.box.center },
      inputs: [{ name: rec.label, data: rec.text }, ...entries.slice(0, 5).map((e) => ({ name: e.name, data: e.text }))],
      run: async ({ onProgress, signal }) => {
        const t0 = performance.now();
        onProgress(0, 'Preparing receptor');
        const radius = Math.hypot(...box.box!.size) / 2 + 12;
        const rp = await remote.receptor({ text: rec.text, chains: chains.length === rec.chains.length ? undefined : chains, center: box.box!.center, radius }, { signal });
        if (rp.atomCount > LIMITS.maxReceptorAtoms) throw new Error(`After cropping to the box surroundings the receptor has ${rp.atomCount.toLocaleString()} atoms (limit ${LIMITS.maxReceptorAtoms.toLocaleString()}). Choose fewer chains or a smaller box.`);
        const out: Result[] = []; let usedThreads = 1;
        setRunInfo({ box: box.box!, receptor: rec.label, atoms: rp.atomCount, warnings: rp.warnings.slice(0, 6), seconds: 0, threads: nThr });
        for (let i = 0; i < entries.length; i++) {
          if (signal.aborted) break;
          const e = entries[i]; onProgress(i / entries.length, `Ligand ${i + 1}/${entries.length}: ${e.name}`);
          try {
            const prep = await remote.ligand({ kind: e.kind, text: e.text, name: e.name, protonate, seed }, { signal });
            if (prep.heavyAtoms > LIMITS.maxLigandHeavyAtoms) throw new Error(`${prep.heavyAtoms} heavy atoms (limit ${LIMITS.maxLigandHeavyAtoms})`);
            if (prep.rotatable > LIMITS.maxRotatable) throw new Error(`${prep.rotatable} rotatable bonds (limit ${LIMITS.maxRotatable})`);
            const d = await remote.dock({ receptorPdbqt: rp.pdbqt, ligandPdbqt: prep.pdbqt, params, threads: nThr }, { signal });
            usedThreads = d.threads;
            const mol = parseMolBlock(prep.molblock);
            out.push({ name: e.name, smiles: e.kind === 'smiles' ? e.text : prep.smiles, prep, poses: d.poses, seconds: d.seconds, threads: d.threads, rmsd: box.xl ? redockRmsd(box.xl, mol, prep.atomMap, d.poses) : null });
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') throw err;
            out.push({ name: e.name, smiles: e.text, poses: [], seconds: 0, error: (err as Error).message });
          }
          setResults([...out]);
        }
        setRunInfo((r) => (r ? { ...r, seconds: (performance.now() - t0) / 1000, threads: usedThreads } : r));
        return out;
      },
      summary: (r) => `${r.filter((x) => x.poses.length).length} of ${r.length} ligand(s) docked into ${rec.label} with AutoDock Vina 1.2.7 (exhaustiveness ${exh}, ${nPoses} poses, seed ${seed}, ${scoring} scoring, ${nThr} thread(s)); best affinity ${Math.min(...r.flatMap((x) => x.poses.map((p) => p.affinity))).toFixed(1)} kcal/mol. The receptor was protonated at pH 7.4 with polar hydrogens and Gasteiger charges; ligands were protonated at pH 7.4, embedded in 3-D by distance geometry and given Gasteiger charges`,
    });
  };
  const cancelRun = () => { cancel(); abort.current?.abort(); };

  const cur = results[sel], pose = cur?.poses[poseIdx];
  useEffect(() => { setPoseIdx(0); setInter(null); }, [sel]);
  useEffect(() => { setInter(null); }, [poseIdx]);
  const viewerPose = useMemo(() => (pose && cur ? { pdb: poseToPdb(pose), key: `${cur.name}-${poseIdx}-${results.length}` } : null), [pose, cur, poseIdx, results.length]);
  const viewerRec = useMemo(() => (rec ? { text: rec.text, format: rec.format, key: rec.label + rec.text.length } : null), [rec]);

  const profile = () => { if (!rec || !pose) return; void run({ label: `Interactions · ${cur.name} pose ${poseIdx + 1}`, tool: { ...TOOL, id: 'docking.interactions', name: 'Docked-pose interaction profile', citations: ['hendlich1997'], describe: () => 'Non-covalent interactions of the docked pose were profiled from heavy-atom geometry (the same criteria as Structure Studio)' }, params: { pose: poseIdx + 1 }, inputs: [], run: async () => {
    const r = await remote.interactions({ receptorText: rec.text, pose: pose.atoms.map((a) => ({ name: a.name, el: ELEMENT_BY_TYPE(a.type), x: a.x, y: a.y, z: a.z })) });
    setInter(r.interactions);
  } }); };

  const csv = () => downloadText('docking_results.csv', toCsv(results.flatMap((r): Record<string, string | number>[] => (r.poses.length ? r.poses.map((p, i) => ({ ligand: r.name, smiles: r.smiles ?? '', pose: i + 1, affinity_kcal_mol: p.affinity, rmsd_lb: p.rmsdLb, rmsd_ub: p.rmsdUb, rmsd_to_crystal: r.rmsd?.[i]?.toFixed(2) ?? '', heavy_atoms: r.prep?.heavyAtoms ?? '', rotatable_bonds: r.prep?.rotatable ?? '' })) : [{ ligand: r.name, smiles: r.smiles ?? '', pose: '' as string | number, affinity_kcal_mol: '' as string | number, rmsd_lb: '' as string | number, rmsd_ub: '' as string | number, rmsd_to_crystal: '', heavy_atoms: '', rotatable_bonds: r.error ?? '' }]))), 'text/csv');
  const sdf = () => { if (!cur?.prep) return; downloadText(`docking_${cur.name}_poses.sdf`, posesToSdf(parseMolBlock(cur.prep.molblock), cur.prep.atomMap, cur.poses, cur.name), 'chemical/x-mdl-sdfile'); };

  const docked = results.filter((r) => r.poses.length);
  const success = docked.filter((r) => r.rmsd?.[0] != null && r.rmsd[0] < 2).length, withRef = docked.filter((r) => r.rmsd).length;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Docking Studio</h1><p>Dock small molecules into a protein with AutoDock Vina 1.2.7 compiled to WebAssembly. Structures and ligands stay in your browser; only a PDB ID, UniProt accession or compound name is sent when you ask for a look-up.</p></div></div>
      <div className="split split--narrow">
        <div className="stack">
          <Card title="1 · Receptor" actions={<button className="btn sm" onClick={() => void loadDemo()} disabled={busy}>Demo: HIV protease + indinavir</button>}>
            <div className="stack" style={{ gap: 10 }}>
              <Tabs<RecSrc> value={recSrc} onChange={setRecSrc} items={[{ id: 'pdb', label: 'PDB ID' }, { id: 'af', label: 'AlphaFold DB' }, { id: 'file', label: 'File' }]} />
              {recSrc === 'pdb' && <>
                <Field label="PDB ID"><input className="input mono" value={pdbId} maxLength={4} onChange={(e) => setPdbId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadPdb(pdbId)} /></Field>
                <div className="row" style={{ gap: 6 }}><button className="btn primary" disabled={busy} onClick={() => loadPdb(pdbId)}>Load structure</button>{EXAMPLES.map(([id, n]) => <button key={id} className="btn sm" title={n} disabled={busy} onClick={() => { setPdbId(id); loadPdb(id); }}>{id}</button>)}</div>
              </>}
              {recSrc === 'af' && <>
                <Field label="UniProt accession"><input className="input mono" value={uni} onChange={(e) => setUni(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadAf(uni)} /></Field>
                <button className="btn primary" disabled={busy} onClick={() => loadAf(uni)}>Fetch predicted model</button>
              </>}
              {recSrc === 'file' && <FileDrop accept=".pdb,.cif,.mmcif,.ent" onText={loadFile} label="Drop PDB / mmCIF" />}
              {rec && <div className="stack" style={{ gap: 6 }}>
                <div className="faint" style={{ fontSize: 12 }}>{rec.label} · {rec.struct.atoms.length.toLocaleString()} atoms · {rec.chains.length} protein chain(s) · {rec.ligands.length} ligand(s)</div>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{rec.chains.map((c) => <label key={c} className="row" style={{ gap: 4, fontSize: 12.5 }}><input type="checkbox" checked={chains.includes(c)} onChange={(e) => setChains(e.target.checked ? [...chains, c] : chains.filter((x) => x !== c))} />chain {c}</label>)}</div>
                {rec.af && <Callout kind="warn">Predicted model: check pLDDT around the pocket before trusting docking scores. Side chains are rigid.</Callout>}
              </div>}
            </div>
          </Card>

          <Card title="2 · Ligand">
            <div className="stack" style={{ gap: 10 }}>
              <Tabs<LigSrc> value={ligSrc} onChange={setLigSrc} items={[{ id: 'smiles', label: 'SMILES' }, { id: 'pubchem', label: 'PubChem name' }, { id: 'file', label: 'SDF / MOL2' }]} />
              {ligSrc === 'smiles' && <Field label={`SMILES, optionally followed by a name, one per line (${ligandList.length} ligand${ligandList.length === 1 ? '' : 's'}, up to ${LIMITS.maxScreen})`}><textarea className="input mono" spellCheck={false} style={{ minHeight: 110 }} value={smilesText} onChange={(e) => setSmilesText(e.target.value)} placeholder={'CC(=O)Oc1ccccc1C(=O)O aspirin'} /></Field>}
              {ligSrc === 'pubchem' && <Field label="Compound name"><input className="input" value={pubName} onChange={(e) => setPubName(e.target.value)} /></Field>}
              {ligSrc === 'file' && <>
                <FileDrop accept=".sdf,.mol,.mol2" onText={(t, n) => setFileLig({ text: t, name: n, kind: /\.mol2$/i.test(n) ? 'mol2' : 'sdf' })} label="Drop SDF / MOL / MOL2 (first molecule)" />
                {fileLig && <div className="faint" style={{ fontSize: 12 }}>{fileLig.name} loaded. 3-D coordinates are kept as given; hydrogens are added if missing.</div>}
              </>}
              <label className="row" style={{ gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={protonate} onChange={(e) => setProtonate(e.target.checked)} disabled={ligSrc === 'file'} />Protonate at pH 7.4 (acids deprotonated, aliphatic amines protonated; rule-based, SMILES input only)</label>
            </div>
          </Card>

          <Card title="3 · Search box">
            <div className="stack" style={{ gap: 10 }}>
              <Tabs<BoxMode> value={boxMode} onChange={setBoxMode} items={[{ id: 'ligand', label: 'Co-crystal ligand' }, { id: 'residues', label: 'Residues' }, { id: 'manual', label: 'Manual' }]} />
              {boxMode === 'ligand' && <Field label="Ligand in the structure"><select className="select" value={ligKey} onChange={(e) => setLigKey(e.target.value)} disabled={!rec?.ligands.length}>{(rec?.ligands ?? []).map((l) => <option key={l.key} value={l.key}>{l.res} · chain {l.chain} {l.seq} · {l.heavy} atoms</option>)}</select></Field>}
              {boxMode === 'residues' && <Field label="Residues (chain:number, e.g. A:25 A:27 A:50)"><input className="input mono" value={resText} onChange={(e) => setResText(e.target.value)} placeholder="A:25 A:27 A:50" /></Field>}
              {boxMode === 'manual' && <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {(['cx', 'cy', 'cz', 'sx', 'sy', 'sz'] as const).map((k) => <Field key={k} label={`${k[0] === 'c' ? 'centre' : 'size'} ${k[1]}${k[0] === 's' ? ' (Å)' : ''}`}><input className="input mono" type="number" step="0.5" value={man[k]} onChange={(e) => setMan({ ...man, [k]: +e.target.value })} /></Field>)}
              </div>}
              {boxMode !== 'manual' && <Field label={`Padding around the selection: ${pad} Å`}><input type="range" min={2} max={12} value={pad} onChange={(e) => setPad(+e.target.value)} /></Field>}
              {box.err && <Callout kind="warn">{box.err}</Callout>}
              {box.box && <div className="faint mono" style={{ fontSize: 12 }}>centre {box.box.center.map((x) => x.toFixed(1)).join(', ')} · size {box.box.size.map((x) => x.toFixed(1)).join(' × ')} Å</div>}
            </div>
          </Card>

          <Card title="4 · Docking settings">
            <div className="stack" style={{ gap: 10 }}>
              <Field label={`Exhaustiveness: ${exh} (default 8, limit ${LIMITS.maxExhaustiveness})`}><input type="range" min={1} max={LIMITS.maxExhaustiveness} value={exh} onChange={(e) => setExh(+e.target.value)} /></Field>
              <div className="row" style={{ gap: 10 }}>
                <Field label={`Poses (max ${LIMITS.maxPoses})`}><input className="input mono" type="number" min={1} max={LIMITS.maxPoses} value={nPoses} onChange={(e) => setNPoses(Math.max(1, Math.min(LIMITS.maxPoses, +e.target.value || 1)))} /></Field>
                <Field label="Random seed"><input className="input mono" type="number" value={seed} onChange={(e) => setSeed(+e.target.value || 0)} /></Field>
                <Field label="Scoring"><select className="select" value={scoring} onChange={(e) => setScoring(e.target.value as 'vina' | 'vinardo')}><option value="vina">Vina</option><option value="vinardo">Vinardo</option></select></Field>
              </div>
              {caps?.isolated
                ? <Field label={`CPU threads: ${threads}`}><input type="range" min={1} max={Math.max(1, caps.threads)} value={threads} onChange={(e) => setThreads(+e.target.value)} /></Field>
                : <div className="faint" style={{ fontSize: 12 }}>Single-threaded: this page is not cross-origin isolated (needed for WebAssembly threads), so Vina runs on one core.</div>}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn primary" disabled={busy || !rec || !box.box || chains.length === 0} onClick={() => void dockAll()}>{ligandList.length > 1 ? `Dock ${ligandList.length} ligands` : 'Dock'}</button>
                {busy && <button className="btn" onClick={cancelRun}>Cancel</button>}
              </div>
            </div>
          </Card>
          {busy && <Busy progress={progress} note={note} />}
          {(error || localErr) && <Callout kind="err">{error ?? localErr}</Callout>}
          <Callout>
            <strong>Limits.</strong> Rigid receptor; one search box of {LIMITS.minBox}–{LIMITS.maxBox} Å per side; ligands up to {LIMITS.maxLigandHeavyAtoms} heavy atoms and {LIMITS.maxRotatable} rotatable bonds; up to {LIMITS.maxScreen} compounds per screen; receptor up to {LIMITS.maxReceptorAtoms.toLocaleString()} atoms within {'{box + 12 Å}'}; exhaustiveness up to {LIMITS.maxExhaustiveness}. Vina scores rank poses and compounds; they are not binding free energies. WebAssembly Vina is about twice as slow as the native program: a drug-like ligand with 5 rotatable bonds takes about a minute at exhaustiveness 8 on one core, a 12-bond inhibitor such as indinavir several minutes. Look-ups send only the PDB ID, UniProt accession or compound name; coordinates and SMILES never leave the browser.
          </Callout>
        </div>

        <div className="stack">
          <DockViewer receptor={viewerRec} pose={viewerPose} />
          {runInfo && <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Stat label="Ligands docked" value={`${docked.length}/${results.length}`} />
            {docked.length > 0 && <Stat label="Best affinity" value={`${fmt(Math.min(...docked.map((r) => r.poses[0].affinity)), 2)} kcal/mol`} />}
            {withRef > 0 && <Stat label="Top pose < 2 Å from crystal" value={`${success}/${withRef}`} hint="Symmetry-corrected heavy-atom RMSD to the co-crystallised ligand (redocking)" />}
            <Stat label="Run time" value={`${fmt(runInfo.seconds, 0)} s`} hint={`${runInfo.threads} thread(s)`} />
            <Stat label="Receptor atoms" value={runInfo.atoms.toLocaleString()} hint="after cropping to the box surroundings" />
          </div>}
          {runInfo?.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}
          {results.length > 0 && (
            <Card title={results.length > 1 ? 'Virtual screen' : 'Result'} actions={<button className="btn sm" onClick={csv}>CSV</button>}>
              <DataTable rows={results.map((r, i) => ({ ...r, i }))} rowKey={(r) => String(r.i)} onRow={(r) => setSel(r.i)} cols={[
                { key: 'name', label: 'Ligand', sort: (r) => r.name },
                { key: 'aff', label: 'Best affinity', num: true, sort: (r) => r.poses[0]?.affinity ?? 99, render: (r) => (r.poses[0] ? r.poses[0].affinity.toFixed(2) : <span className="faint" title={r.error}>{r.error ? 'failed' : '–'}</span>) },
                { key: 'heavy', label: 'Heavy', num: true, sort: (r) => r.prep?.heavyAtoms ?? 0, render: (r) => r.prep?.heavyAtoms ?? '' },
                { key: 'rot', label: 'Rot. bonds', num: true, sort: (r) => r.prep?.rotatable ?? 0, render: (r) => r.prep?.rotatable ?? '' },
                { key: 'rmsd', label: 'RMSD to crystal (Å)', num: true, sort: (r) => r.rmsd?.[0] ?? 99, render: (r) => (r.rmsd ? r.rmsd[0].toFixed(2) : '') },
                { key: 't', label: 'Time (s)', num: true, sort: (r) => r.seconds, render: (r) => r.seconds.toFixed(0) },
              ]} />
              {results.some((r) => r.error) && <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Failed ligands: {results.filter((r) => r.error).map((r) => `${r.name} (${r.error})`).slice(0, 5).join('; ')}</div>}
            </Card>
          )}
          {cur?.poses.length ? (
            <Card title={`Poses · ${cur.name}`} sub={cur.prep ? `${cur.prep.heavyAtoms} heavy atoms · ${cur.prep.rotatable} rotatable bonds${cur.prep.protonation.length ? ' · ' + cur.prep.protonation.join(', ') : ''}${cur.prep.embedded && cur.prep.embed ? ` · 3-D by distance geometry (${cur.prep.embed.attempts} attempt(s), bond RMS ${cur.prep.embed.bondRms.toFixed(3)} Å)` : ''}` : undefined}
              actions={<div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => downloadText(`docking_${cur.name}_poses.pdbqt`, posesToPdbqt(cur.poses))}>PDBQT</button>
                <button className="btn sm" onClick={sdf}>SDF</button></div>}>
              <DataTable<PoseRow> rows={cur.poses.map((p, i) => ({ p, i }))} rowKey={(r) => String(r.i)} onRow={(r) => setPoseIdx(r.i)} cols={poseCols(cur, poseIdx)} />
              <div className="row" style={{ marginTop: 10, gap: 8 }}><button className="btn sm" disabled={busy} onClick={profile}>Interaction profile of pose {poseIdx + 1}</button><span className="faint" style={{ fontSize: 12 }}>Same heavy-atom geometric criteria as Structure Studio.</span></div>
              {inter && <div style={{ marginTop: 10 }}>
                {!inter.length ? <span className="faint">No interactions detected within the criteria.</span> : <DataTable rows={inter} rowKey={(r, i) => `${r.type}${r.ligAtom}${r.chain}${r.seq}${r.protAtom}${i}`} cols={[{ key: 'type', label: 'Type', sort: (r) => r.type }, { key: 'lig', label: 'Ligand atom', sort: (r) => r.ligAtom, render: (r) => r.ligAtom }, { key: 'res', label: 'Residue', sort: (r) => r.seq, render: (r) => `${r.protRes} ${r.chain}${r.seq}` }, { key: 'atom', label: 'Atom', render: (r) => r.protAtom }, { key: 'd', label: 'Distance (Å)', num: true, sort: (r) => r.distance, render: (r) => r.distance.toFixed(2) }]} />}
                {inter.length > 0 && <div className="row" style={{ marginTop: 6 }}><button className="btn sm" onClick={() => downloadText('docking_interactions.csv', toCsv(inter), 'text/csv')}>CSV</button></div>}
              </div>}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
