import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CO,
  DISULFIDE,
  H2O,
  NH3,
  cyclicMass,
  disulfideMass,
  disulfidePairings,
  fragmentIons,
  linearMass,
  matchSpectrum,
} from './ms';
import { PROTON } from '@/studios/sequence/proteomics';

const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/peptide/reference.json', import.meta.url), 'utf8')) as {
  peptide: { seq: string; neutralMass: number; b: number[]; y: number[]; cyclicMass: number; oneDisulfideMass: number };
};

const SEQ = ref.peptide.seq;
const singly = (type: 'b' | 'y' | 'a') => fragmentIons(SEQ, { ionTypes: [type], charges: [1] });

describe('fragmentIons', () => {
  it('singly charged b ions match the independent reference to 5e-4', () => {
    const b = singly('b');
    const expected = [98.0600, 227.1026, 324.1554, 425.2031, 538.2871, 653.3141];
    expect(b).toHaveLength(6);
    b.forEach((ion, i) => expect(ion.mz).toBeCloseTo(expected[i], 4));
    b.forEach((ion, i) => expect(ion.mz).toBeCloseTo(ref.peptide.b[i], 4));
  });
  it('singly charged y ions match the independent reference to 5e-4', () => {
    const y = singly('y');
    const expected = [148.0604, 263.0874, 376.1714, 477.2191, 574.2719, 703.3145];
    expect(y).toHaveLength(6);
    y.forEach((ion, i) => expect(ion.mz).toBeCloseTo(expected[i], 4));
    y.forEach((ion, i) => expect(ion.mz).toBeCloseTo(ref.peptide.y[i], 4));
  });
  it('b_i + y_(n−i) = M + 2·PROTON', () => {
    const b = singly('b'), y = singly('y');
    b.forEach((ion, i) => expect(ion.mz + y[y.length - 1 - i].mz).toBeCloseTo(ref.peptide.neutralMass + 2 * PROTON, 6));
  });
  it('a ions are b ions minus CO', () => {
    const a = singly('a'), b = singly('b');
    a.forEach((ion, i) => expect(b[i].mz - ion.mz).toBeCloseTo(CO, 9));
  });
  it('charge 2 uses (M + 2·PROTON)/2', () => {
    const z2 = fragmentIons(SEQ, { ionTypes: ['b'], charges: [2] });
    z2.forEach((ion, i) => {
      const neutral = ref.peptide.b[i] - PROTON;
      expect(ion.mz).toBeCloseTo((neutral + 2 * PROTON) / 2, 9);
    });
  });
  it('neutral-loss columns are the fragment minus H2O or NH3', () => {
    const ion = singly('y')[3];
    expect(ion.mzH2O).toBeCloseTo(ion.mz - H2O, 9);
    expect(ion.mzNH3).toBeCloseTo(ion.mz - NH3, 9);
  });
  it('a modification shifts only fragments that contain it', () => {
    const plain = singly('b');
    const modded = fragmentIons(SEQ, { ionTypes: ['b'], charges: [1], mods: [{ position: 3, delta: 79.966331 }] });
    expect(modded[0].mz).toBeCloseTo(plain[0].mz, 9);
    expect(modded[1].mz).toBeCloseTo(plain[1].mz, 9);
    for (let i = 2; i < plain.length; i++) expect(modded[i].mz - plain[i].mz).toBeCloseTo(79.966331, 6);
  });
});

describe('matchSpectrum', () => {
  it('matches 12 of 15 peaks at 10 ppm with 100 % coverage', () => {
    const ions = fragmentIons(SEQ, { ionTypes: ['b', 'y'], charges: [1] });
    const peaks = [...ref.peptide.b, ...ref.peptide.y, 120.0, 500.0, 900.0];
    const res = matchSpectrum(peaks, ions, 10);
    expect(res.matched).toHaveLength(12);
    expect(res.unmatchedIons).toHaveLength(0);
    expect(res.unmatchedPeaks).toHaveLength(3);
    expect(res.coverage).toBeCloseTo(1, 12);
    expect(res.coveredPositions).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const m of res.matched) expect(Math.abs(m.errorPpm)).toBeLessThanOrEqual(10);
  });
  it('rejects peaks outside the ppm tolerance', () => {
    const ions = fragmentIons(SEQ, { ionTypes: ['b'], charges: [1] });
    const shifted = singly('b').map((ion) => ion.mz * (1 + 50e-6));
    const res = matchSpectrum(shifted, ions, 10);
    expect(res.matched).toHaveLength(0);
    expect(res.coverage).toBe(0);
  });
});

describe('cyclic and disulfide masses', () => {
  const CYCLIC = 'CCAAAGG';
  it('head-to-tail cyclisation loses one water', () => {
    expect(cyclicMass(CYCLIC)).toBeCloseTo(linearMass(CYCLIC) - 18.0105647, 7);
  });
  it('one disulfide bond loses two hydrogens', () => {
    expect(disulfideMass(CYCLIC, 1)).toBeCloseTo(linearMass(CYCLIC) - 2.01565, 6);
    expect(DISULFIDE).toBeCloseTo(2.01565006, 9);
  });
  it('matches the Python reference for cyclic and disulfide PEPTIDE masses', () => {
    expect(cyclicMass(SEQ)).toBeCloseTo(ref.peptide.cyclicMass, 9);
    expect(disulfideMass(SEQ, 1)).toBeCloseTo(ref.peptide.oneDisulfideMass, 9);
  });
});

describe('disulfidePairings', () => {
  it('4 cysteines give exactly 3 pairings', () => {
    expect(disulfidePairings('CCCC')).toHaveLength(3);
  });
  it('6 cysteines give exactly 15 pairings', () => {
    expect(disulfidePairings('CCCCCC')).toHaveLength(15);
  });
  it('5 cysteines give 15 pairings each with one unpaired cysteine', () => {
    const p = disulfidePairings('CCCCC');
    expect(p).toHaveLength(15);
    for (const x of p) {
      expect(x.bonds).toHaveLength(2);
      expect(x.unpaired).toHaveLength(1);
      expect(x.neutralMass).toBeCloseTo(linearMass('CCCCC') - 2 * DISULFIDE, 9);
    }
    expect(new Set(p.map((x) => x.unpaired[0]))).toEqual(new Set([1, 2, 3, 4, 5]));
  });
  it('lists connectivity with 1-based positions and gives every pairing the same mass', () => {
    const p = disulfidePairings('ACDCECGC');
    const labels = p.map((x) => x.label).sort();
    expect(labels).toEqual(['C2–C4, C6–C8', 'C2–C6, C4–C8', 'C2–C8, C4–C6']);
    for (const x of p) expect(x.neutralMass).toBeCloseTo(linearMass('ACDCECGC') - 2 * DISULFIDE, 9);
  });
  it('refuses more than 8 cysteines', () => {
    expect(() => disulfidePairings('CCCCCCCCC')).toThrow(/limit is 8/);
  });
});
