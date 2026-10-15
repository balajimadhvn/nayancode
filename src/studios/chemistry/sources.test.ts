import { describe, expect, it } from 'vitest';
import { aggregateActivities, parsePubchem, parseTargets } from './sources';

describe('open compound sources', () => {
  it('parses the current PubChem property names (and the legacy ones)', () => {
    expect(parsePubchem({ PropertyTable: { Properties: [{ CID: 2244, MolecularFormula: 'C9H8O4', MolecularWeight: '180.16', SMILES: 'CC(=O)OC1=CC=CC=C1C(=O)O', IUPACName: '2-acetyloxybenzoic acid' }] } })).toEqual({ cid: 2244, smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O', formula: 'C9H8O4', mw: 180.16, iupac: '2-acetyloxybenzoic acid' });
    expect(parsePubchem({ PropertyTable: { Properties: [{ CID: 1, MolecularFormula: 'X', MolecularWeight: 1, CanonicalSMILES: 'C' }] } })?.smiles).toBe('C'); expect(parsePubchem({})).toBeNull();
  });
  it('keeps single-protein targets and puts human first', () => {
    const t = parseTargets({ targets: [{ target_chembl_id: 'A', pref_name: 'x/y', organism: 'Homo sapiens', target_type: 'PROTEIN-PROTEIN INTERACTION' }, { target_chembl_id: 'B', pref_name: 'EGFR', organism: 'Mus musculus', target_type: 'SINGLE PROTEIN' }, { target_chembl_id: 'C', pref_name: 'EGFR', organism: 'Homo sapiens', target_type: 'SINGLE PROTEIN' }] });
    expect(t.map((x) => x.id)).toEqual(['C', 'B']);
  });
  it('aggregates replicate measurements by median and drops invalid rows', () => {
    const rows = [{ molecule_chembl_id: 'M1', canonical_smiles: 'CCO', pchembl_value: '6.0', standard_type: 'IC50' }, { molecule_chembl_id: 'M1', canonical_smiles: 'CCO', pchembl_value: '8.0', standard_type: 'IC50' }, { molecule_chembl_id: 'M1', canonical_smiles: 'CCO', pchembl_value: '7.0', standard_type: 'Ki' }, { molecule_chembl_id: 'M2', canonical_smiles: null, pchembl_value: '5', standard_type: 'IC50' }, { molecule_chembl_id: 'M3', canonical_smiles: 'CC', pchembl_value: null, standard_type: 'IC50' }];
    const a = aggregateActivities(rows); expect(a).toHaveLength(1); expect(a[0]).toMatchObject({ id: 'M1', y: 7, n: 3 });
    expect(aggregateActivities(rows, ['IC50'])[0].y).toBe(7); // median of 6 and 8
  });
});
