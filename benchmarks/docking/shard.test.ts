// Redocking benchmark worker (one shard of benchmarks/docking/complexes.tsv). Run by benchmarks/docking/run.sh, not by `npm run bench`.
// For each complex: prepare receptor and ligand (SMILES → 3-D) with the Workbench code, dock with the WebAssembly Vina and with the
// native Vina 1.2.7 CLI on identical PDBQT inputs, and compare both with the crystal ligand.
import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRdkitNode } from '@/studios/docking/rdkitNode';
import { ligandFromSmiles } from '@/studios/docking/rdkitBridge';
import { automorphisms, ligandToPdbqt, parsePoses, symmetryRmsd, type V3 } from '@/studios/docking/pdbqt';
import { prepareReceptor } from '@/studios/docking/receptor';
import { crystalLigand, mapCrystalToMol } from '@/studios/docking/crystal';
import { parseStructure } from '@/studios/structure/geometry';
import { boxFromAtoms } from '@/studios/docking/box';
import { VinaEngine } from '@/studios/docking/vina';
import { vinaNodeFactory } from '@/studios/docking/vinaNode';

const root = fileURLToPath(new URL('..', import.meta.url));
const [shardI, shardN] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const EXH = Number(process.env.EXH ?? 8), NATIVE = `${root}.cache/vina-native/vina`;
const rows = readFileSync(`${root}docking/complexes.tsv`, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const [id, comp, smiles, sha, res, heavy] = l.split('\t'); return { id, comp, smiles, sha, res: +res, heavy: +heavy }; });
const only = process.env.ONLY?.split(',');
const mine = rows.filter((_, i) => i % shardN === shardI).filter((r) => !only || only.includes(r.id));
const out = `${root}.cache/docking/results`; mkdirSync(out, { recursive: true });

describe('redocking shard', () => {
  it(`shard ${shardI}/${shardN}`, async () => {
    const RD = await loadRdkitNode(), eng = await VinaEngine.create(vinaNodeFactory('vina'), 1);
    for (const c of mine) {
      const res: Record<string, unknown> = { id: c.id, ligand: c.comp, exhaustiveness: EXH };
      try {
        const s = parseStructure(readFileSync(`${root}.cache/docking/pdb/${c.id}.pdb`, 'utf8'));
        const xl = crystalLigand(s, c.comp);
        const box = boxFromAtoms(xl.atoms, 6, 20);
        const rec = prepareReceptor(s, { cropCenter: box.center, cropRadius: Math.hypot(...box.size) / 2 + 12 });
        const L = ligandFromSmiles(RD, c.smiles, { protonate: true, name: c.comp });
        if (L.protonation.some((w) => w.includes('macrocycle'))) throw new Error('macrocycle (ring of 9 or more atoms): Vina keeps ring conformations rigid');
        if (L.protonation.some((w) => w.includes('stereochemistry could not'))) throw new Error('3-D stereochemistry could not be reproduced');
        const map = mapCrystalToMol(xl, L.mol);
        if (!map) throw new Error('crystal ligand does not match the SMILES graph');
        const lig = ligandToPdbqt(L.mol);
        const heavy = lig.atomMap.map((a, k) => ({ a, k })).filter(({ a }) => L.mol.atoms[a].el !== 'H');
        const hi = new Map(heavy.map(({ a }, h) => [a, h]));
        const ref: V3[] = new Array(heavy.length); for (const m of map) ref[hi.get(m.molAtom)!] = m.pos;
        const el = heavy.map(({ a }) => L.mol.atoms[a].el);
        const bonds: [number, number, number][] = L.mol.bonds.filter((b) => hi.has(b.a) && hi.has(b.b)).map((b) => [hi.get(b.a)!, hi.get(b.b)!, b.order]);
        const autos = automorphisms(el, bonds);
        const rms = (p: { atoms: { x: number; y: number; z: number }[] }) => symmetryRmsd(el, bonds, ref, heavy.map(({ k }) => [p.atoms[k].x, p.atoms[k].y, p.atoms[k].z] as V3), autos);
        Object.assign(res, { heavyAtoms: L.heavyAtoms, rotatable: lig.rotatable, receptorAtoms: rec.atoms.length, receptorResidues: rec.residues, embed: L.embed, protonation: L.protonation, box });
        eng.setReceptor(rec.pdbqt);
        const w = eng.dock(lig.text, { ...box, exhaustiveness: EXH, nPoses: 9, seed: 1 });
        Object.assign(res, { wasm: { scores: w.poses.map((p) => p.affinity), rmsd: w.poses.map(rms), seconds: w.seconds } });
        if (existsSync(NATIVE)) {
          const dir = `${root}.cache/docking/work/${c.id}`; mkdirSync(dir, { recursive: true });
          writeFileSync(`${dir}/receptor.pdbqt`, rec.pdbqt); writeFileSync(`${dir}/ligand.pdbqt`, lig.text);
          const t0 = performance.now();
          const r = spawnSync(NATIVE, ['--receptor', `${dir}/receptor.pdbqt`, '--ligand', `${dir}/ligand.pdbqt`, '--center_x', String(box.center[0]), '--center_y', String(box.center[1]), '--center_z', String(box.center[2]), '--size_x', String(box.size[0]), '--size_y', String(box.size[1]), '--size_z', String(box.size[2]), '--exhaustiveness', String(EXH), '--num_modes', '9', '--seed', '1', '--cpu', '1', '--out', `${dir}/out.pdbqt`], { encoding: 'utf8' });
          if (r.status !== 0) throw new Error('native vina failed: ' + r.stderr.slice(0, 200));
          const np = parsePoses(readFileSync(`${dir}/out.pdbqt`, 'utf8'));
          const top = (p: { atoms: { x: number; y: number; z: number }[] }, q: { atoms: { x: number; y: number; z: number }[] }) => symmetryRmsd(el, bonds, heavy.map(({ k }) => [p.atoms[k].x, p.atoms[k].y, p.atoms[k].z] as V3), heavy.map(({ k }) => [q.atoms[k].x, q.atoms[k].y, q.atoms[k].z] as V3), autos);
          Object.assign(res, { native: { scores: np.map((p) => p.affinity), rmsd: np.map(rms), seconds: (performance.now() - t0) / 1000 }, wasmVsNativeTop: top(w.poses[0], np[0]) });
        }
        res.ok = true;
      } catch (e) { res.ok = false; res.error = (e as Error).message; }
      writeFileSync(`${out}/${c.id}.json`, JSON.stringify(res));
      process.stderr.write(`${c.id} ${c.comp} ${res.ok ? `wasm ${(res.wasm as { scores: number[] }).scores[0]} rmsd ${(res.wasm as { rmsd: number[] }).rmsd[0].toFixed(2)}${res.native ? ` | native ${(res.native as { scores: number[] }).scores[0]} rmsd ${(res.native as { rmsd: number[] }).rmsd[0].toFixed(2)}` : ''}` : 'FAILED ' + res.error}\n`);
    }
  }, 6 * 3600 * 1000);
});
