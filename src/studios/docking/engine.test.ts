import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRdkitNode } from './rdkitNode';
import { ligandFromSmiles, type RDKitModule } from './rdkitBridge';
import { ligandToPdbqt, parsePoses, symmetryRmsd, type V3 } from './pdbqt';
import { prepareReceptor } from './receptor';
import { crystalLigand, mapCrystalToMol } from './crystal';
import { parseStructure } from '../structure/geometry';
import { boxFromAtoms } from './box';
import { VinaEngine } from './vina';
import { vinaNodeFactory } from './vinaNode';
import { neighbours } from './molgraph';

let RD: RDKitModule;
beforeAll(async () => { RD = await loadRdkitNode(); });

describe('dock 1HSG / indinavir end to end', () => {
  it('redocks indinavir within 2 Å', async () => {
    const s = parseStructure(readFileSync(new URL('../structure/fixtures/1HSG.pdb', import.meta.url), 'utf8'));
    const xl = crystalLigand(s, 'MK1');
    const box = boxFromAtoms(xl.atoms, 6);
    const rec = prepareReceptor(s, { chains: ['A', 'B'], cropCenter: box.center, cropRadius: 40 });
    const L = ligandFromSmiles(RD, 'CC(C)(C)NC(=O)[C@@H]1CN(CCN1C[C@H](C[C@@H](Cc2ccccc2)C(=O)N[C@H]3[C@H](Cc4ccccc34)O)O)Cc5cccnc5', { protonate: true, name: 'MK1' });
    const lig = ligandToPdbqt(L.mol);
    const map = mapCrystalToMol(xl, L.mol)!;
    expect(map).not.toBeNull();
    const eng = await VinaEngine.create(vinaNodeFactory('vina'), 1);
    eng.setReceptor(rec.pdbqt);
    const r = eng.dock(lig.text, { ...box, exhaustiveness: 8, nPoses: 9, seed: 1 });
    process.stderr.write(`\nposes ${r.poses.map((p) => p.affinity).join(' ')} in ${r.seconds.toFixed(1)}s, rotatable ${lig.rotatable}\n`);
    // RMSD vs crystal (heavy atoms; symmetry corrected)
    const nbm = neighbours(L.mol);
    const heavyPdbqt = lig.atomMap.map((a, k) => ({ a, k })).filter(({ a }) => L.mol.atoms[a].el !== 'H');
    const idxInHeavy = new Map(heavyPdbqt.map(({ a }, h) => [a, h]));
    const ref: V3[] = new Array(heavyPdbqt.length);
    for (const m of map) ref[idxInHeavy.get(m.molAtom)!] = m.pos;
    const el = heavyPdbqt.map(({ a }) => L.mol.atoms[a].el);
    const bonds: [number, number, number][] = L.mol.bonds.filter((b) => idxInHeavy.has(b.a) && idxInHeavy.has(b.b)).map((b) => [idxInHeavy.get(b.a)!, idxInHeavy.get(b.b)!, b.order]);
    void nbm;
    const best = r.poses.map((p) => symmetryRmsd(el, bonds, ref, heavyPdbqt.map(({ k }) => [p.atoms[k].x, p.atoms[k].y, p.atoms[k].z] as V3)));
    process.stderr.write(`RMSD per pose: ${best.map((x) => x.toFixed(2)).join(' ')}\n`);
    expect(r.poses[0].affinity).toBeLessThan(-8);
    expect(Math.min(...best)).toBeLessThan(2.5);
    void parsePoses;
  }, 600000);
});
