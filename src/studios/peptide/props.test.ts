import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aliphaticIndex,
  chargeCurve,
  cleanSequence,
  GRAVY,
  hydrophobicMoment,
  MAX_RESIDUES,
  netCharge,
  peptideProperties,
  pI,
  residueComposition,
  EISENBERG_TABLE,
} from './props';
import { peptideMass } from '@/studios/sequence/proteomics';

const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/peptide/reference.json', import.meta.url), 'utf8')) as {
  hydrophobicMoment: { seq: string; delta: number; value: number };
  LLLLLLLL: { value: number };
  peptide: { seq: string; neutralMass: number };
};

describe('cleanSequence', () => {
  it('upper-cases and accepts the 20 standard residues', () => {
    expect(cleanSequence(' acdefg ')).toBe('ACDEFG');
  });
  it('rejects non-standard letters with a clear message', () => {
    expect(() => cleanSequence('ACDX')).toThrow(/Unsupported residue/);
  });
  it('rejects sequences longer than 100 residues', () => {
    expect(() => cleanSequence('A'.repeat(MAX_RESIDUES))).not.toThrow();
    expect(() => cleanSequence('A'.repeat(MAX_RESIDUES + 1))).toThrow(/limit is 100/);
  });
});

describe('mass', () => {
  it('reuses the shared monoisotopic peptide mass', () => {
    expect(peptideMass(ref.peptide.seq)).toBeCloseTo(ref.peptide.neutralMass, 9);
    expect(peptideProperties(ref.peptide.seq).massMono).toBeCloseTo(ref.peptide.neutralMass, 9);
  });
  it('computes an average mass larger than the monoisotopic mass', () => {
    const p = peptideProperties('PEPTIDE');
    expect(p.massAvg).toBeGreaterThan(p.massMono);
  });
});

describe('netCharge', () => {
  it('KKKKK carries +4.8 to +5.0 at pH 7.4', () => {
    const q = netCharge('KKKKK', 7.4);
    expect(q).toBeGreaterThan(4.8);
    expect(q).toBeLessThan(5.0);
  });
  it('KKKKK has essentially no side-chain charge at pH 14 (termini blocked)', () => {
    // With a free C-terminus every peptide is about −1 at pH 14; block the
    // termini to test the lysine side chains themselves.
    const q = netCharge('KKKKK', 14, { acetylatedN: true, amidatedC: true });
    expect(Math.abs(q)).toBeLessThan(0.01);
    expect(netCharge('KKKKK', 14)).toBeCloseTo(-1, 2);
  });
  it('KD side chains nearly cancel while the termini do not', () => {
    expect(netCharge('KD', 7.0, { freeTermini: false })).toBeCloseTo(0, 2);
    expect(netCharge('AAAAA', 2, { acetylatedN: true, amidatedC: true })).toBeCloseTo(0, 12);
    expect(netCharge('AAAAA', 2)).toBeGreaterThan(0.6);
  });
  it('amidation and acetylation remove the terminal charges', () => {
    const free = netCharge('AAAAA', 7.4);
    const blocked = netCharge('AAAAA', 7.4, { amidatedC: true, acetylatedN: true });
    expect(Math.abs(free)).toBeLessThan(0.01);
    expect(blocked).toBeCloseTo(0, 12);
    expect(netCharge('AAAAA', 7.4, { amidatedC: true })).toBeCloseTo(0.9947, 3);
    expect(netCharge('AAAAA', 7.4, { acetylatedN: true })).toBeCloseTo(-0.99999, 4);
  });
});

describe('chargeCurve', () => {
  it('covers pH 0 to 14 and decreases monotonically', () => {
    const c = chargeCurve('KKKDDD');
    expect(c).toHaveLength(141);
    expect(c[0].pH).toBe(0);
    expect(c[140].pH).toBe(14);
    for (let i = 1; i < c.length; i++) expect(c[i].charge).toBeLessThanOrEqual(c[i - 1].charge + 1e-12);
  });
});

describe('pI', () => {
  it('poly-lysine is basic (> 10.5)', () => {
    expect(pI('KKKKK')).toBeGreaterThan(10.5);
  });
  it('poly-aspartate is acidic (< 3.5)', () => {
    expect(pI('DDDDD')).toBeLessThan(3.5);
  });
  it('the pI charge is close to zero', () => {
    expect(Math.abs(netCharge('ACDEFGHIKLMNPQRSTVWY', pI('ACDEFGHIKLMNPQRSTVWY')))).toBeLessThan(1e-6);
  });
});

describe('GRAVY', () => {
  it('poly-alanine is 1.8', () => {
    expect(GRAVY('AAAA')).toBeCloseTo(1.8, 12);
  });
  it('averages the Kyte–Doolittle values', () => {
    expect(GRAVY('AI')).toBeCloseTo((1.8 + 4.5) / 2, 12);
  });
});

describe('aliphaticIndex', () => {
  it('AVILAVIL is 292.5', () => {
    expect(aliphaticIndex('AVILAVIL')).toBeCloseTo(292.5, 10);
  });
  it('a sequence without A, V, I or L is 0', () => {
    expect(aliphaticIndex('GGGG')).toBe(0);
  });
});

describe('hydrophobicMoment', () => {
  it('matches the independent Python reference to 1e-9', () => {
    expect(hydrophobicMoment(ref.hydrophobicMoment.seq, 100)).toBeCloseTo(ref.hydrophobicMoment.value, 9);
  });
  it('LLLLLLLL equals 1.06·|Σ e^{i n 100°}| to 1e-9', () => {
    let re = 0, im = 0;
    for (let n = 1; n <= 8; n++) {
      re += 1.06 * Math.cos((100 * n * Math.PI) / 180);
      im += 1.06 * Math.sin((100 * n * Math.PI) / 180);
    }
    const expected = Math.hypot(re, im) / 8;
    expect(hydrophobicMoment('LLLLLLLL', 100)).toBeCloseTo(expected, 9);
    expect(expected).toBeCloseTo(ref.LLLLLLLL.value, 9);
  });
  it('the Eisenberg scale is the one documented in the handoff', () => {
    expect(EISENBERG_TABLE.L).toBe(1.06);
    expect(EISENBERG_TABLE.R).toBe(-2.53);
    expect(hydrophobicMoment('A', 100)).toBeCloseTo(0.62, 12);
  });
});

describe('residueComposition', () => {
  it('classifies a charged peptide', () => {
    const c = residueComposition('KDE');
    expect(c.length).toBe(3);
    expect(c.positive.fraction).toBeCloseTo(1 / 3, 12);
    expect(c.negative.fraction).toBeCloseTo(2 / 3, 12);
    expect(c.hydrophobic.fraction).toBe(0);
  });
  it('classes sum to the length', () => {
    const c = residueComposition('AVILMFWCSTNQYGHPKRDEH');
    const total = c.hydrophobic.count + c.polarUncharged.count + c.positive.count + c.negative.count + c.histidine.count;
    expect(total).toBe(c.length);
  });
});
