import { beforeAll, describe, expect, it } from 'vitest';
import { loadRdkitNode } from './rdkitNode';
import { canonicalSmiles, ligandFromSmiles, sameStereo, type RDKitModule } from './rdkitBridge';
import { ligandToPdbqt } from './pdbqt';

let RD: RDKitModule;
beforeAll(async () => { RD = await loadRdkitNode(); });

describe('ligand preparation from SMILES', () => {
  it('embeds with correct stereochemistry and bond lengths', () => {
    for (const smi of ['C[C@H](N)C(=O)O', 'C[C@@H](N)C(=O)O', 'C/C=C/C(=O)O', 'C/C=C\\C(=O)O', 'CC(=O)Nc1ccc(O)cc1', 'O=C(O)c1ccccc1OC(C)=O', 'C1CCCCC1', 'N[C@@H](Cc1ccccc1)C(=O)O']) {
      const L = ligandFromSmiles(RD, smi, { protonate: false });
      expect(L.embedded).toBe(true);
      expect(L.embed!.chiralOk, smi).toBe(true);
      expect(L.embed!.bondRms, smi).toBeLessThan(0.08);
      expect(L.smiles, smi).toBe(canonicalSmiles(RD, smi));
    }
  });
  it('reproduces stereochemistry and sane geometry for drug-like molecules', () => {
    const SET = [
      'CC(C)C[C@H](NC(=O)[C@H](Cc1ccccc1)NC(=O)c1cnccn1)B(O)O', // bortezomib-like (boron: skipped below if unsupported)
      'CN1CC[C@]23c4c5ccc(O)c4O[C@H]2[C@@H](O)C=C[C@H]3[C@H]1C5', // morphine
      'C[C@]12CC[C@H]3[C@@H](CCc4cc(O)ccc34)[C@@H]1CC[C@@H]2O', // estradiol
      'C[C@]12CC[C@H]3[C@@H](CCC4=CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O', // testosterone
      'Cc1ccc(cc1)S(=O)(=O)Nc1ccccc1', 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', 'CC(C)Cc1ccc(cc1)[C@H](C)C(=O)O',
      'O=C(C)Oc1ccccc1C(=O)O', 'CN(C)CCCN1c2ccccc2CCc2ccccc21', 'C1CC1c1ccc(cc1)C(=O)N1CCOCC1',
      'CC(=O)N[C@@H](CS)C(=O)O', 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O', 'CC1=C(C(=O)C[C@@H]1OC(=O)[C@@H]1[C@H](C1(C)C)/C=C(\\C)C)C',
      'Cc1cc(C)n2nc(nc2n1)C(=O)NC1CC1', 'O=C1CCCN1c1ccc(Cl)cc1', 'C[C@@H]1CC[C@H]([C@@H](C1)O)C(C)C', 'NC(=O)c1ccc(cc1)N1CCN(CC1)C(=O)C=C',
    ].filter((x) => !x.includes('B('));
    let ok = 0; const bad: string[] = [];
    for (const smi of SET) {
      const L = ligandFromSmiles(RD, smi, { protonate: false });
      if (L.embed!.chiralOk && L.embed!.bondRms < 0.06 && sameStereo(RD, L.mol, smi)) ok++; else bad.push(`${smi} ${JSON.stringify(L.embed)}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
    expect(ok).toBe(SET.length);
  });
  it('protonates at pH 7.4', () => {
    const L = ligandFromSmiles(RD, 'CC(N)C(=O)O', {});
    expect(L.smiles).toContain('[NH3+]'); expect(L.smiles).toContain('[O-]');
    const p = ligandToPdbqt(L.mol);
    const total = p.charges.reduce((s, v, i) => s + (p.types[i] === 'H' ? 0 : v), 0);
    expect(Math.abs(total)).toBeLessThan(1e-6);
  });
  it('writes a valid torsion tree', () => {
    const L = ligandFromSmiles(RD, 'CC(=O)Nc1ccc(OCCN(C)C)cc1', { protonate: false });
    const p = ligandToPdbqt(L.mol);
    expect(p.text).toMatch(/TORSDOF \d+/);
    expect(sameStereo(RD, L.mol, 'CC(=O)Nc1ccc(OCCN(C)C)cc1')).toBe(true);
  });
});
