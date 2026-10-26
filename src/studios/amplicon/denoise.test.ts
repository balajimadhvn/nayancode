import { describe, expect, it } from 'vitest';
import { expectedErrors } from '../reads/trim';
import type { FastqRecord } from '../reads/fastq';
import { editDistance, denoise, findPrimer, iupacMatch, medianLength, passesFilter, revCompIupac, type UniqueSeq } from './denoise';
import { PRIMER_F } from './simAmplicon';

const rec = (seq: string, qual: string): FastqRecord => ({ id: 'r1', desc: '', seq, qual });
/** Concrete 515F: GTGYCAGCMGCCGCGGTAA with Y→C and M→A. */
const CONCRETE_F = 'GTGCCAGCAGCCGCGGTAA';

describe('amplicon primers and filters', () => {
  it('uses the IUPAC code table', () => {
    expect(iupacMatch('A', 'R')).toBe(true);
    expect(iupacMatch('C', 'R')).toBe(false);
    expect(iupacMatch('T', 'Y')).toBe(true);
    expect(iupacMatch('G', 'N')).toBe(true);
    expect(iupacMatch('A', 'N')).toBe(true);
  });

  it('finds a primer with up to two mismatches and rejects three', () => {
    expect(findPrimer(`TTTT${CONCRETE_F}`, PRIMER_F)).toBe(4);
    const one = `A${CONCRETE_F.slice(1)}`;
    expect(findPrimer(one, PRIMER_F)).toBe(0);
    const three = `A${CONCRETE_F[1]}A${CONCRETE_F.slice(3, 5)}C${CONCRETE_F.slice(6)}`;
    expect(findPrimer(three, PRIMER_F)).toBe(-1);
    expect(findPrimer(`TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT${CONCRETE_F}`, PRIMER_F)).toBe(-1);
  });

  it('reverse-complements IUPAC codes', () => {
    expect(revCompIupac('AGCTRY')).toBe('RYAGCT');
    expect(revCompIupac('GGACTACNVGGGTWTCTAAT')).toBe('ATTAGAWACCCBNGTAGTCC');
  });

  it('computes expected errors and applies the EE filter', () => {
    expect(expectedErrors('5'.repeat(10))).toBeCloseTo(0.1, 12);
    expect(passesFilter(rec('A'.repeat(10), '5'.repeat(10)), 10, 1)).toBe(true);
    expect(expectedErrors('+'.repeat(15))).toBeCloseTo(1.5, 12);
    expect(passesFilter(rec('A'.repeat(15), '+'.repeat(15)), 15, 1)).toBe(false);
  });

  it('rejects N and reads outside 20 % of the median length', () => {
    expect(passesFilter(rec('ACGTN', '5'.repeat(5)), 5, 1)).toBe(false);
    expect(passesFilter(rec('A'.repeat(100), '?'.repeat(100)), 100, 1)).toBe(true);
    expect(passesFilter(rec('A'.repeat(121), '5'.repeat(121)), 100, 1)).toBe(false);
    expect(medianLength([3, 1, 2])).toBe(2);
    expect(medianLength([4, 1, 2, 3])).toBe(2.5);
  });

  it('counts substitutions and handles unequal lengths with a band', () => {
    expect(editDistance('ACGT', 'ACGT', 4)).toBe(0);
    expect(editDistance('ACGT', 'AGGT', 4)).toBe(1);
    expect(editDistance('ACGT', 'AGT', 4)).toBe(1);
    expect(editDistance('ACGT', 'TTTT', 2)).toBe(3);
  });

  it('merges a four-mismatch variant into its abundant parent', () => {
    const parent = 'ACGT'.repeat(60) + 'AC';
    const child = parent.slice(0, 10) + 'T' + parent.slice(11, 60) + 'C' + parent.slice(61, 120) + 'T' + parent.slice(121, 180) + 'C' + parent.slice(181);
    expect(editDistance(parent, child, 4)).toBe(4);
    const seq = (s: string, count: number): UniqueSeq => ({ seq: s, count, samples: new Map([['s1', count]]) });
    const res = denoise([seq(parent, 1000), seq(child, 1)]);
    expect(res.merged).toBe(1);
    expect(res.asvs).toHaveLength(1);
    expect(res.asvs[0].count).toBe(1001);
  });
});
