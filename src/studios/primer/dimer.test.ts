import { describe, expect, it } from 'vitest';
import { checkPair, checkPrimer, dimerRuns, hairpin, homopolymer } from './dimer';

describe('primer checks', () => {
  it('flags a GC-rich self-dimer as high risk', () => {
    const c = checkPrimer('GCGCGCGC');
    expect(c.selfDimer).toBe(8);
    expect(c.end3Run).toBe(8);
    expect(c.risk).toBe('high');
  });

  it('finds a palindromic 3′ end: aligning bases 3-12 of ATCGATCGATCG with bases 1-10 of its reverse gives CGATCGATCG vs GCTAGCTAGC, ten consecutive pairs, so end3Run = 10', () => {
    const c = checkPrimer('ATCGATCGATCG');
    expect(c.end3Run).toBe(10);
    expect(c.risk).toBe('high');
  });

  it('flags a homopolymer of six A bases but not shorter runs', () => {
    expect(homopolymer('AAAAAAGTCA')).toBe(6);
    expect(checkPrimer('AAAAAAGTCA').homopolymerFlag).toBe(true);
    expect(checkPrimer('AAAAGTCA').homopolymerFlag).toBe(false);
  });

  it('finds the hand-built hairpin GGGGAAAACCCC with stem 4 and loop 4', () => {
    expect(hairpin('GGGGAAAACCCC')).toEqual({ stem: 4, positions: [1, 9] });
    expect(checkPrimer('GGGGAAAACCCC').hairpin).toMatchObject({ stem: 4 });
  });

  it('counts the GC clamp in the last five bases', () => {
    expect(checkPrimer('GGGGG').gcClamp).toBe(5);
    expect(checkPrimer('GGGGG').gcClampFlag).toBe(true);
    expect(checkPrimer('AAAAG').gcClampFlag).toBe(false);
  });

  it('checks a pair and rejects invalid bases', () => {
    const p = checkPair('GCGCGCGC', 'GCGCGCGC');
    expect(p.pairDimer).toBe(8);
    expect(p.risk).toBe('high');
    expect(() => checkPrimer('ACGTN')).toThrow(/only A, C, G and T/);
    expect(dimerRuns('ACGT', 'ACGT').run).toBe(4);
  });
});
