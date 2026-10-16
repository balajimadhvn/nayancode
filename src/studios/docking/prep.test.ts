import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRdkitNode } from './rdkitNode';
import { ligandFromSmiles, type RDKitModule } from './rdkitBridge';
import { ligandCharges, rotatableBonds, hybridisation } from './molgraph';
import { atomLine, automorphisms, ligandToPdbqt, parsePoses, posesToPdbqt, symmetryRmsd, type V3 } from './pdbqt';
import { placeHydrogens, prepareReceptor } from './receptor';
import { boxAround, boxContains, boxFromAtoms, boxFromResidues, manualBox } from './box';
import { parseStructure } from '../structure/geometry';
import { crystalLigand } from './crystal';
import { LIMITS, validateParams } from './vina';

let RD: RDKitModule;
beforeAll(async () => { RD = await loadRdkitNode(); });
const fixture = () => parseStructure(readFileSync(new URL('../structure/fixtures/1HSG.pdb', import.meta.url), 'utf8'));

describe('Gasteiger–Marsili charges', () => {
  // reference: RDKit ComputeGasteigerCharges(nIter=12), heavy atoms in SMILES order
  const REF: [string, number[]][] = [
    ['CCO', [-0.0418, 0.0402, -0.3967]], ['CC(=O)O', [0.0338, 0.2997, -0.2528, -0.4814]], ['c1ccccc1', Array(6).fill(-0.0623)],
    ['CC(N)=O', [0.0146, 0.2138, -0.3699, -0.2757]], ['c1ccncc1', [-0.0592, -0.0438, 0.0267, -0.2647, 0.0267, -0.0438]], ['CCCl', [-0.0516, 0.0195, -0.127]],
    ['C#N', [0.0462, -0.202]], ['CC(C)=O', [-0.006, 0.1263, -0.006, -0.3003]],
  ];
  for (const [smi, ref] of REF) it(`matches RDKit for ${smi}`, () => {
    const L = ligandFromSmiles(RD, smi, { protonate: false });
    const q = ligandCharges(L.mol), nb = L.mol.bonds;
    // charge of each heavy atom including its hydrogens (RDKit prints per-atom values; compare the heavy atom value itself)
    const heavy = [...q].slice(0, ref.length);
    heavy.forEach((v, i) => expect(Math.abs(v - ref[i]), `${smi} atom ${i}: ${v.toFixed(4)} vs ${ref[i]}`).toBeLessThan(0.03));
    expect(Math.abs([...q].reduce((s, v) => s + v, 0))).toBeLessThan(1e-9);
    void nb;
  });
  it('conserves total formal charge for ions', () => {
    for (const [smi, z] of [['CC(=O)[O-]', -1], ['C[NH3+]', 1]] as const) {
      const L = ligandFromSmiles(RD, smi, { protonate: false });
      expect([...ligandCharges(L.mol)].reduce((s, v) => s + v, 0)).toBeCloseTo(z, 9);
    }
  });
});

describe('ligand PDBQT', () => {
  it('writes a parseable torsion tree whose atoms round-trip', () => {
    const L = ligandFromSmiles(RD, 'CC(=O)Nc1ccc(OCCN(C)C)cc1', { protonate: false });
    const p = ligandToPdbqt(L.mol);
    const atoms = p.text.split('\n').filter((l) => l.startsWith('HETATM'));
    expect(atoms.length).toBe(p.atomMap.length);
    const open = p.text.split('\n').filter((l) => l.startsWith('BRANCH')).length, close = p.text.split('\n').filter((l) => l.startsWith('ENDBRANCH')).length;
    expect(open).toBe(close); expect(open).toBe(p.rotatable);
    expect(p.text).toContain(`TORSDOF ${p.rotatable}`);
    // columns: coordinates and AutoDock type survive a round trip through the parser
    const poses = parsePoses(p.text);
    expect(poses.length).toBe(1); expect(poses[0].atoms.length).toBe(atoms.length);
    poses[0].atoms.forEach((a, k) => { const src = L.mol.atoms[p.atomMap[k]]; expect(a.x).toBeCloseTo(src.x, 3); expect(a.y).toBeCloseTo(src.y, 3); expect(a.z).toBeCloseTo(src.z, 3); expect(a.type).toBe(p.types[p.atomMap[k]]); expect(a.q).toBeCloseTo(p.charges[p.atomMap[k]], 3); });
    // multi-model output round trip
    const again = parsePoses(posesToPdbqt([{ ...poses[0], affinity: -7.5, rmsdLb: 0, rmsdUb: 0 }, { ...poses[0], affinity: -7.1, rmsdLb: 1.2, rmsdUb: 2.4 }]));
    expect(again.map((x) => x.affinity)).toEqual([-7.5, -7.1]); expect(again[1].rmsdUb).toBe(2.4);
  });
  it('merges non-polar hydrogens and keeps polar ones (HD)', () => {
    const L = ligandFromSmiles(RD, 'CCO', { protonate: false });
    const p = ligandToPdbqt(L.mol);
    expect(p.types.filter((t) => t === 'HD').length).toBe(1);
    expect(p.atomMap.length).toBe(4); // C, C, O, HD
  });
  it('counts rotatable bonds like AutoDockTools for simple cases', () => {
    const rot = (smi: string) => { const L = ligandFromSmiles(RD, smi, { protonate: false }); return rotatableBonds(L.mol).length; };
    expect(rot('CCCC')).toBe(1);            // only the central C–C; terminal methyls do not count
    expect(rot('CC(=O)NC')).toBe(0);        // amide bond is rigid
    expect(rot('c1ccccc1c1ccccc1')).toBe(1); // biaryl
    expect(rot('C1CCCCC1')).toBe(0);
  });
  it('assigns AutoDock types', () => {
    const L = ligandFromSmiles(RD, 'Oc1ccncc1', { protonate: false });
    const t = ligandToPdbqt(L.mol).types;
    expect(t.slice(0, 7)).toEqual(['OA', 'A', 'A', 'A', 'NA', 'A', 'A']);
    expect(hybridisation(L.mol).slice(0, 2)).toEqual(['sp2', 'sp2']);
  });
});

describe('symmetry-corrected RMSD', () => {
  it('treats equivalent carboxylate oxygens as identical', () => {
    const el = ['C', 'C', 'O', 'O'], bonds: [number, number, number][] = [[0, 1, 1], [1, 2, 2], [1, 3, 1]];
    const ref: V3[] = [[0, 0, 0], [1.5, 0, 0], [2.2, 1, 0], [2.2, -1, 0]];
    const swapped: V3[] = [[0, 0, 0], [1.5, 0, 0], [2.2, -1, 0], [2.2, 1, 0]];
    expect(symmetryRmsd(el, bonds, ref, swapped)).toBeCloseTo(0, 9);
    expect(automorphisms(el, [[0, 1, 1], [1, 2, 1], [1, 3, 1]]).length).toBe(2);
  });
});

describe('receptor preparation (1HSG)', () => {
  const s = fixture();
  it('keeps protein and removes waters, ligand and additives', () => {
    const r = prepareReceptor(s);
    expect(r.residues).toBe(198);
    expect(r.dropped.waters).toBeGreaterThan(50);
    expect(r.atoms.some((a) => a.res === 'MK1' || a.res === 'HOH')).toBe(false);
    expect(r.atoms.filter((a) => a.type === 'HD').length).toBeGreaterThan(300);
    expect(new Set(r.atoms.map((a) => a.type))).toEqual(new Set(['N', 'C', 'OA', 'A', 'SA', 'HD', 'NA']));
  });
  it('gives a net charge consistent with the residue protonation states at pH 7.4', () => {
    const r = prepareReceptor(s), net = r.atoms.reduce((t, a) => t + a.q, 0);
    // HIV-1 protease dimer: formal charge from Asp/Glu (−), Lys/Arg (+), His neutral and N/C-termini
    expect(Math.abs(net - 0)).toBeLessThan(12);
    const arg = r.atoms.find((a) => a.res === 'ARG' && a.name === 'CZ')!; expect(arg.q).toBeGreaterThan(0.1);
    const asp = r.atoms.find((a) => a.res === 'ASP' && a.name === 'OD1')!; expect(asp.q).toBeLessThan(-0.4);
  });
  it('writes PDBQT atom lines in the fixed-column layout Vina reads', () => {
    const line = atomLine(12, 'CA', 'ALA', 'A', 7, [1.2346, -2.5, 30], 0.18, 'C');
    expect(line.length).toBeGreaterThanOrEqual(79);
    expect(line.slice(30, 38)).toBe('   1.235'); expect(line.slice(70, 76)).toBe(' +0.180'.slice(1)); expect(line.slice(77, 79)).toBe('C ');
  });
  it('can crop to the neighbourhood of the box', () => {
    const lig = crystalLigand(s, 'MK1'), b = boxFromAtoms(lig.atoms, 6);
    const r = prepareReceptor(s, { cropCenter: b.center, cropRadius: 20 });
    expect(r.atoms.length).toBeLessThan(prepareReceptor(s).atoms.length);
    expect(r.atoms.length).toBeGreaterThan(600);
  });
  it('places hydrogens 1.0 Å from their heavy atom', () => {
    const hs = placeHydrogens([0, 0, 0], [[1.5, 0, 0]], 3, false);
    expect(hs.length).toBe(3); for (const h of hs) expect(Math.hypot(...h)).toBeCloseTo(1.01, 6);
    const [a, b] = [hs[0], hs[1]]; expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(1.5);
  });
});

describe('search box', () => {
  const s = fixture();
  it('boxes a co-crystallised ligand with padding and limits', () => {
    const lig = crystalLigand(s, 'MK1');
    const b = boxFromAtoms(lig.atoms, 6);
    expect(boxContains(b, lig.atoms.map((a) => [a.x, a.y, a.z] as V3), 5.9)).toBe(true);
    expect(Math.max(...b.size)).toBeLessThanOrEqual(LIMITS.maxBox);
    const tiny = boxAround([[0, 0, 0], [1, 0, 0]], 2, 18);
    expect(tiny.size).toEqual([18, 18, 18]); expect(tiny.center).toEqual([0.5, 0, 0]);
  });
  it('boxes selected residues and clamps manual boxes', () => {
    const b = boxFromResidues(s.atoms, [{ chain: 'A', seq: 25 }, { chain: 'A', seq: 27 }, { chain: 'A', seq: 50 }], 4);
    expect(b.size.every((x) => x >= 18)).toBe(true);
    expect(() => boxFromResidues(s.atoms, [{ chain: 'Q', seq: 1 }])).toThrow();
    expect(manualBox([0, 0, 0], [100, 4, 20]).size).toEqual([LIMITS.maxBox, LIMITS.minBox, 20]);
    expect(() => manualBox([NaN, 0, 0], [20, 20, 20])).toThrow();
  });
  it('validates docking parameters against the stated limits', () => {
    const ok = { center: [0, 0, 0] as V3, size: [20, 20, 20] as V3, exhaustiveness: 8, nPoses: 9, seed: 1 };
    expect(() => validateParams(ok)).not.toThrow();
    expect(() => validateParams({ ...ok, size: [50, 20, 20] })).toThrow(/between/);
    expect(() => validateParams({ ...ok, exhaustiveness: 0 })).toThrow(/Exhaustiveness/);
    expect(() => validateParams({ ...ok, nPoses: 99 })).toThrow(/poses/);
  });
});
