import { beforeAll, describe, expect, it } from 'vitest';
import { loadRdkitNode } from '../docking/rdkitNode';
import type { RDKitModule } from '../docking/rdkitBridge';
import { enumerate, highlight, mcs, murcko, pharmacophore, pharmSimilarity, REACTIONS, rgroups, usrFromSmiles, usrSimilarity } from './moltools';

let RD: RDKitModule;
beforeAll(async () => { RD = await loadRdkitNode(); });
const canon = (s: string) => { if (!s) return ''; const m = RD.get_mol(s)!; try { return m.get_smiles(); } finally { m.delete(); } };

// Expected values computed with Python RDKit 2026.03.6 (MurckoScaffold.GetScaffoldForMol / MakeScaffoldGeneric, rdFMCS).
const SCAFFOLDS: [string, string, string][] = [
  ['CC(=O)Oc1ccccc1C(=O)O', 'c1ccccc1', 'C1CCCCC1'],
  ['c1ccc(cc1)C(=O)NCc1ccncc1', 'O=C(NCc1ccncc1)c1ccccc1', 'CC(CCC1CCCCC1)C1CCCCC1'],
  ['CCOC(=O)C1=CC(=O)c2ccccc2C1', 'O=C1C=CCc2ccccc21', 'CC1CCCC2CCCCC12'],
  ['CN1CCC[C@H]1c1cccnc1', 'c1cncc([C@@H]2CCCN2)c1', 'C1CCC(C2CCCC2)CC1'],
  ['O=C1CCCCC1', 'O=C1CCCCC1', 'CC1CCCCC1'],
  ['CCCCCC', '', ''],
  ['c1ccc2c(c1)[nH]c1ccccc12', 'c1ccc2c(c1)[nH]c1ccccc12', 'C1CCC2C(C1)CC1CCCCC12'],
  ['C1CC1c1ccc(OC)cc1C(=O)N2CCOCC2', 'O=C(c1ccccc1C1CC1)N1CCOCC1', 'CC(C1CCCCC1)C1CCCCC1C1CC1'],
  ['Clc1ccc(cc1)C(c1ccccc1)N1CCN(CC1)CCOCCO', 'c1ccc(C(c2ccccc2)N2CCNCC2)cc1', 'C1CCC(C(C2CCCCC2)C2CCCCC2)CC1'],
];
describe('Bemis–Murcko scaffolds', () => {
  it.each(SCAFFOLDS)('%s', (smi, scaffold, generic) => {
    const r = murcko(RD, smi)!;
    expect(canon(r.scaffold)).toBe(canon(scaffold)); expect(canon(r.generic)).toBe(canon(generic));
  });
  it('rejects invalid SMILES and counts rings', () => { expect(murcko(RD, 'not smiles')).toBeNull(); expect(murcko(RD, 'c1ccc2c(c1)[nH]c1ccccc12')!.rings).toBe(3); });
});

describe('maximum common substructure', () => {
  it('finds the shared benzamide core (rdFMCS: 10 atoms, 10 bonds)', () => {
    const r = mcs(RD, ['c1ccccc1C(=O)NC', 'Clc1ccccc1C(=O)NCC', 'c1ccccc1C(=O)NCc1ccncc1']);
    expect(r.atoms).toBe(10); expect(r.bonds).toBe(10); expect(r.canceled).toBe(false);
    expect(highlight(RD, 'Clc1ccccc1C(=O)NCC', r.smarts)).toContain('<svg');
  });
  it('needs two molecules', () => { expect(() => mcs(RD, ['CCO'])).toThrow(); });
});

describe('R-group decomposition', () => {
  it('splits substituents on a benzamide core and reports unmatched molecules', () => {
    const r = rgroups(RD, 'c1ccccc1C(=O)N', ['c1ccccc1C(=O)NC', 'Clc1ccccc1C(=O)NCC', 'CCCCO']);
    expect(r.unmatched).toBe(1); expect(r.rows[0].matched).toBe(true);
    expect(Object.keys(r.rows[1].groups).length).toBeGreaterThanOrEqual(1);
    expect(Object.values(r.rows[1].groups).join(' ')).toContain('Cl');
  });
});

describe('reaction enumeration', () => {
  it('forms amides from acids × amines and dedupes', () => {
    const r = enumerate(RD, REACTIONS[0].smarts, [['CC(=O)O', 'OC(=O)c1ccccc1'], ['NCc1ccccc1', 'NC1CC1']]);
    expect(r.combos).toBe(4); expect(r.products.map(canon).sort()).toEqual(['CC(=O)NC1CC1', 'CC(=O)NCc1ccccc1', 'O=C(NC1CC1)c1ccccc1', 'O=C(NCc1ccccc1)c1ccccc1'].map(canon).sort());
  });
  it('gives nothing when reactants do not match, and respects the product cap', () => {
    expect(enumerate(RD, REACTIONS[0].smarts, [['CCC'], ['NC']]).products).toEqual([]);
    expect(enumerate(RD, REACTIONS[0].smarts, [['CC(=O)O', 'CCC(=O)O', 'CCCC(=O)O'], ['NC', 'NCC', 'NCCC']], 4).truncated).toBe(true);
  });
  it('rejects a bad template', () => { expect(() => enumerate(RD, 'not a reaction', [['CC']])).toThrow(); });
});

describe('pharmacophore fingerprint', () => {
  it('is 1 for identical molecules and ranks analogues above unrelated molecules', () => {
    const q = pharmacophore(RD, 'CC(=O)Nc1ccc(O)cc1')!, same = pharmacophore(RD, 'CC(=O)Nc1ccc(O)cc1')!, analog = pharmacophore(RD, 'CCC(=O)Nc1ccc(O)cc1')!, other = pharmacophore(RD, 'CCCCCCCCCC')!;
    expect(pharmSimilarity(q, same)).toBe(1); expect(pharmSimilarity(q, analog)).toBeGreaterThan(pharmSimilarity(q, other));
    expect(q.features.R).toBe(1); expect(q.features.D).toBeGreaterThanOrEqual(2);
  });
  it('types charged groups', () => { const p = pharmacophore(RD, 'CC(=O)O')!; expect(p.features['-']).toBe(1); expect(pharmacophore(RD, 'CCN(C)C')!.features['+']).toBe(1); });
});

describe('USR shape similarity', () => {
  it('is 1 for the same molecule and lower for a different shape', () => {
    const a = usrFromSmiles(RD, 'c1ccccc1CCCCCC')!, b = usrFromSmiles(RD, 'c1ccccc1CCCCCC')!, ring = usrFromSmiles(RD, 'C1CCC2CCCCC2C1')!;
    expect(usrSimilarity(a, b)).toBeCloseTo(1, 10); expect(usrSimilarity(a, ring)).toBeLessThan(0.95);
    expect(a).toHaveLength(12);
  });
  it('is invariant to rotation and translation of the coordinates', async () => {
    const { usrDescriptor } = await import('./moltools');
    const pts = [[0, 0, 0], [1.5, 0, 0], [2.2, 1.3, 0], [3.6, 1.4, 0.8], [4.1, 2.9, 1.1], [5.5, 3.0, 2.4]];
    const rot = pts.map(([x, y, z]) => [-y + 10, x - 4, z + 3]);
    const d1 = usrDescriptor(pts), d2 = usrDescriptor(rot); d1.forEach((v, i) => expect(v).toBeCloseTo(d2[i], 9));
  });
});
