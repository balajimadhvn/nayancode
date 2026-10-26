import { describe, expect, it } from 'vitest';
import { ADAPTERS, expectedErrors, filterRecord, meanQuality, processRecord, qualityTrim3, trimAdapter3, trimPolyG } from './trim';
import type { FastqRecord } from './fastq';

const Q = (q: number, n = 1) => String.fromCharCode(33 + q).repeat(n);
const rec = (seq: string, q = 30): FastqRecord => ({ id: 'r', desc: '', seq, qual: Q(q, seq.length) });
const INSERT = 'ACGT'.repeat(10);
const JUNK = 'T'.repeat(20);

describe('qualityTrim3', () => {
  it('keeps the first 3 bases of the hand example', () => {
    const qual = [30, 30, 30, 10, 5, 5].map((q) => Q(q)).join('');
    expect(qualityTrim3(qual, 20)).toBe(3);
  });

  it('keeps everything when every base is high quality, and nothing when every base is low', () => {
    expect(qualityTrim3(Q(40, 10), 20)).toBe(10);
    expect(qualityTrim3(Q(5, 10), 20)).toBe(0);
  });
});

describe('trimAdapter3', () => {
  it('removes a full TruSeq adapter and everything after it', () => {
    expect(trimAdapter3(INSERT + ADAPTERS.truseq + JUNK, ADAPTERS.truseq)).toBe(40);
  });

  it('removes a 5-base adapter prefix that runs off the read end', () => {
    expect(trimAdapter3(INSERT + 'AGATC', ADAPTERS.truseq)).toBe(40);
  });

  it('allows one mismatch in 13 bases but not three', () => {
    const one = 'AGATCGTAAGAGC'; // one substitution in the TruSeq adapter
    expect(trimAdapter3(INSERT + one + JUNK, ADAPTERS.truseq)).toBe(40);
    const three = 'TGATAGGATGAGC'; // three substitutions (positions 0, 4, 8)
    expect(trimAdapter3(INSERT + three + JUNK, ADAPTERS.truseq)).toBe(INSERT.length + three.length + JUNK.length);
  });
});

describe('trimPolyG', () => {
  it('removes a 12-G run but keeps a 9-G run', () => {
    expect(trimPolyG('ACGTACGT' + 'G'.repeat(12))).toBe(8);
    expect(trimPolyG('ACGTACGT' + 'G'.repeat(9))).toBe(17);
  });
});

describe('expected errors and filters', () => {
  it('sums 10^(-q/10): ten Q20 bases = 0.1', () => {
    expect(expectedErrors(Q(20, 10))).toBeCloseTo(0.1, 12);
    expect(expectedErrors(Q(30, 10))).toBeCloseTo(0.01, 12);
  });

  it('returns the correct reason in order', () => {
    expect(filterRecord(rec('ACGT'), { minLen: 30 })).toBe('too_short');
    expect(filterRecord(rec('N'.repeat(6) + 'A'.repeat(34)), { minLen: 30, maxN: 5 })).toBe('too_many_n');
    expect(filterRecord(rec('A'.repeat(40), 10), { minLen: 30, minMeanQ: 20 })).toBe('low_mean_q');
    expect(filterRecord(rec('A'.repeat(40), 10), { minLen: 30, maxExpectedErrors: 0.5 })).toBe('too_many_errors');
    expect(filterRecord(rec('A'.repeat(40), 30), { minLen: 30 })).toBeNull();
  });

  it('processes adapter, poly-G and quality in that order and tallies', () => {
    const r = rec(INSERT + ADAPTERS.truseq + 'G'.repeat(12));
    // Adapter starts after the 40-base insert, so the poly-G tail is removed with it.
    const out = processRecord(r, { adapterPreset: 'truseq', polyG: true, qualityCutoff: 20, minLen: 20 });
    expect(out.rec?.seq).toBe(INSERT);
    expect(out.adapterTrimmed).toBe(r.seq.length - 40);
    expect(out.reason).toBeNull();
    expect(meanQuality(out.rec!.qual)).toBe(30);
  });
});
