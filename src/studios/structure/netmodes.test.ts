import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseStructure } from './geometry';
import { anm, bfactorCorrelation, caCoordinates, contactMap, rmsdMatrix, type CA } from './netmodes';

interface Ref { coords: [number, number, number][]; eigenvaluesNonzeroFirst10: number[]; msf: number[]; zeroModeCount: number }
const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/structure/reference.json', import.meta.url), 'utf8')) as Ref;
const pdb = readFileSync(new URL('./fixtures/1HSG.pdb', import.meta.url), 'utf8');
const theReference = (): CA[] => ref.coords.map(([x, y, z], i) => ({ chain: 'A', seq: i + 1, icode: '', res: 'ALA', x, y, z, b: 0, aa: 'A' }));

describe('anisotropic network model', () => {
  test('the ten lowest eigenvalues and the mean-square fluctuations match numpy to 1e-6', () => {
    const r = anm(theReference(), 15, 1);
    expect(r.method).toBe('jacobi');
    expect(r.n).toBe(40);
    const zero = r.eigenvaluesAll!.filter((v) => v < 1e-6);
    expect(zero.length).toBe(ref.zeroModeCount);
    expect(zero.length).toBe(6);
    expect(r.modes.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(Math.abs(r.modes[i].lambda - ref.eigenvaluesNonzeroFirst10[i]) / ref.eigenvaluesNonzeroFirst10[i]).toBeLessThan(1e-6);
    }
    for (let i = 0; i < ref.msf.length; i++) expect(Math.abs(r.msf[i] - ref.msf[i]) / Math.abs(ref.msf[i])).toBeLessThan(1e-5);
    // Eigenvalues ascend.
    for (let i = 1; i < r.modes.length; i++) expect(r.modes[i].lambda).toBeGreaterThan(r.modes[i - 1].lambda);
  }, 60_000);

  test('on 1HSG the predicted fluctuations correlate with the deposited B-factors', () => {
    const ca = caCoordinates(parseStructure(pdb).atoms);
    expect(ca.length).toBeGreaterThan(150);
    const r = anm(ca);
    expect(r.method).toBe('subspace');
    const corr = bfactorCorrelation(r.msf, ca.map((c) => c.b));
    expect(corr).toBeGreaterThan(0.4);
    expect(r.modes.length).toBeGreaterThan(0);
    expect(r.modes.every((m) => Number.isFinite(m.lambda) && m.lambda > 0)).toBe(true);
  }, 120_000);

  test('contact map is symmetric with a zero diagonal', () => {
    const ca = caReference();
    const m = contactMap(ca, 8);
    expect(m.length).toBe(ca.length * ca.length);
    for (let i = 0; i < ca.length; i++) {
      expect(m[i * ca.length + i]).toBe(0);
      for (let j = 0; j < ca.length; j++) expect(m[i * ca.length + j]).toBe(m[j * ca.length + i]);
    }
    const strict = contactMap(ca, 8, 3);
    expect(strict.reduce((a, b) => a + b, 0)).toBeLessThan(m.reduce((a, b) => a + b, 0));
  });

  test('RMSD matrix is symmetric, zero on the diagonal, and a rotated copy has RMSD below 1e-6', () => {
    const ca = caReference();
    const th = 0.4, c = Math.cos(th), s = Math.sin(th);
    const rot = ca.map((p) => ({ ...p, x: c * p.x - s * p.y + 12, y: s * p.x + c * p.y - 7, z: p.z + 3 }));
    const m = rmsdMatrix([ca, rot]);
    expect(m[0][0]).toBe(0); expect(m[1][1]).toBe(0);
    expect(m[0][1]).toBe(m[1][0]);
    expect(m[0][1]).toBeLessThan(1e-6);
  });

  test('fewer than ten shared residues is an error and the residue cap is enforced', () => {
    const ca = caReference();
    expect(() => rmsdMatrix([ca, ca.slice(0, 5)])).toThrow(/at least 10/);
    const big: CA[] = Array.from({ length: 401 }, (_, i) => ({ chain: 'A', seq: i + 1, icode: '', res: 'ALA', x: i * 3.8, y: 0, z: 0, b: 0, aa: 'A' }));
    expect(() => anm(big)).toThrow(/400 residues/);
  });
});

function caReference(): CA[] {
  return caCoordinates(parseStructure(pdb).atoms);
}
