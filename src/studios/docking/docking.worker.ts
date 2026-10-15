/** Docking Studio worker: ligand and receptor preparation (RDKit WebAssembly + TypeScript) and AutoDock Vina 1.2.7 (WebAssembly).
 *  Multi-threaded Vina is used only when the page is cross-origin isolated; otherwise the single-thread build runs. */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { assetUrl } from '@/core/asset';
import { parseStructure, profileInteractions, type Atom, type Interaction } from '../structure/geometry';
import { ligandFromFile, ligandFromSmiles, type RDKitModule } from './rdkitBridge';
import { ligandToPdbqt, type Pose } from './pdbqt';
import { toMolBlock } from './molgraph';
import { prepareReceptor, type Receptor } from './receptor';
import { VinaEngine, type DockParams, type VinaFactory } from './vina';

let rdkit: Promise<RDKitModule> | null = null;
const loadRdkit = () => (rdkit ??= (async () => {
  const text = await (await fetch(assetUrl('rdkit/RDKit_minimal.js'))).text();
  const init = new Function(`${text}\n;return initRDKitModule;`)() as (o: unknown) => Promise<RDKitModule>;
  return init({ locateFile: (f: string) => assetUrl(`rdkit/${f}`) });
})());

const isolated = () => typeof SharedArrayBuffer !== 'undefined' && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
let engine: Promise<VinaEngine> | null = null, engineKey = '';
function loadEngine(threads: number): Promise<VinaEngine> {
  const mt = threads > 1 && isolated(), key = mt ? `mt${threads}` : 'st';
  if (engine && engineKey === key) return engine;
  engineKey = key;
  return (engine = (async () => {
    const name = mt ? 'vina-mt' : 'vina', url = assetUrl(`wasm/vina/${name}.js`);
    const text = await (await fetch(url)).text();
    const make = new Function(`${text}\n;return VinaModule;`)() as (o: Record<string, unknown>) => Promise<never>;
    const factory: VinaFactory = (o) => make({ locateFile: (f: string) => assetUrl(`wasm/vina/${f}`), mainScriptUrlOrBlob: url, ...o });
    return VinaEngine.create(factory, mt ? threads : 1);
  })());
}

export interface LigandPrep { name: string; pdbqt: string; atomMap: number[]; molblock: string; smiles: string; protonation: string[]; heavyAtoms: number; rotatable: number; embedded: boolean; embed?: { violation: number; attempts: number; chiralOk: boolean; bondRms: number } }

const caps: Kernel<void, { rdkit: string; isolated: boolean; threads: number }> = async () => ({ rdkit: (await loadRdkit()).version(), isolated: isolated(), threads: Math.max(1, (self.navigator?.hardwareConcurrency ?? 2) - 1) });

const receptor: Kernel<{ text: string; chains?: string[]; center: [number, number, number]; radius: number }, Omit<Receptor, 'atoms'> & { atomCount: number; chains: string[] }> = (a) => {
  const s = parseStructure(a.text);
  const r = prepareReceptor(s, { chains: a.chains, cropCenter: a.center, cropRadius: a.radius });
  const { atoms, ...rest } = r; return { ...rest, atomCount: atoms.length, chains: [...new Set(atoms.map((x) => x.chain))] };
};

const ligand: Kernel<{ kind: 'smiles' | 'sdf' | 'mol2'; text: string; name: string; protonate: boolean; seed: number }, LigandPrep> = async (a) => {
  const RD = await loadRdkit();
  const prep = a.kind === 'smiles' ? ligandFromSmiles(RD, a.text, { protonate: a.protonate, name: a.name, seed: a.seed }) : ligandFromFile(RD, a.text, a.kind, { name: a.name, seed: a.seed });
  const p = ligandToPdbqt(prep.mol);
  return { name: a.name, pdbqt: p.text, atomMap: p.atomMap, molblock: toMolBlock(prep.mol), smiles: prep.smiles, protonation: prep.protonation, heavyAtoms: prep.heavyAtoms, rotatable: p.rotatable, embedded: prep.embedded, embed: prep.embed };
};

const dock: Kernel<{ receptorPdbqt?: string; ligandPdbqt: string; params: DockParams; threads: number }, { poses: Pose[]; seconds: number; threads: number }> = async (a, ctx) => {
  ctx.progress(0, 'Loading Vina');
  const e = await loadEngine(a.threads);
  if (a.receptorPdbqt) e.setReceptor(a.receptorPdbqt);
  const r = e.dock(a.ligandPdbqt, a.params);
  return { poses: r.poses, seconds: r.seconds, threads: e.threads };
};

const interactions: Kernel<{ receptorText: string; pose: { name: string; el: string; x: number; y: number; z: number }[] }, { interactions: Interaction[] }> = (a) => {
  const s = parseStructure(a.receptorText);
  const lig: Atom[] = a.pose.filter((p) => p.el !== 'H' && p.el !== 'HD').map((p, i) => ({ serial: 90000 + i, name: p.name, alt: '', res: 'LIG', chain: 'Z', seq: 1, icode: '', x: p.x, y: p.y, z: p.z, el: p.el.toUpperCase(), het: true, occ: 1, b: 0 }));
  s.atoms = [...s.atoms.filter((x) => !(x.het && x.res === 'LIG')), ...lig];
  return { interactions: profileInteractions(s, 'Z:1:LIG').interactions };
};

export type DockingKernels = { caps: typeof caps; receptor: typeof receptor; ligand: typeof ligand; dock: typeof dock; interactions: typeof interactions };
exposeKernels({ caps, receptor, ligand, dock, interactions } as Record<string, Kernel>);
