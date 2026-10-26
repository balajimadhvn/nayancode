import { describe, expect, it } from 'vitest';
import { mergePair, revComp } from './merge';
import { ADAPTERS } from './trim';
import type { FastqRecord } from './fastq';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const randSeq = (n: number, seed: number) => {
  const r = mulberry32(seed), b = 'ACGT';
  return Array.from({ length: n }, () => b[Math.floor(r() * 4)]).join('');
};
const read = (id: string, seq: string, q = 30): FastqRecord => ({ id, desc: '', seq, qual: String.fromCharCode(33 + q).repeat(seq.length) });

describe('mergePair', () => {
  it('recovers a 150-base fragment from two 100-base reads with a 50-base overlap', () => {
    const fragment = randSeq(150, 7);
    const r1 = read('p/1', fragment.slice(0, 100));
    const r2 = read('p/2', revComp(fragment.slice(50)));
    const m = mergePair(r1, r2);
    expect(m?.seq).toBe(fragment);
    expect(m?.seq).toHaveLength(150);
    expect(m?.qual).toHaveLength(150);
    expect(m?.id).toBe('p');
  });

  it('takes the higher-quality base at two planted mismatches', () => {
    const fragment = randSeq(150, 11);
    const r1 = read('p/1', fragment.slice(0, 100), 35);
    const r2 = read('p/2', revComp(fragment.slice(50)));
    const alt = (c: string) => (c === 'A' ? 'C' : 'A');
    for (const j of [10, 30]) { // positions in the 50-base overlap (rc2 indexes)
      const i = r2.seq.length - 1 - j;
      r2.seq = r2.seq.slice(0, i) + alt(r2.seq[i]) + r2.seq.slice(i + 1);
      r2.qual = r2.qual.slice(0, i) + String.fromCharCode(33 + 10) + r2.qual.slice(i + 1);
    }
    const m = mergePair(r1, r2);
    expect(m?.seq).toBe(fragment);
  });

  it('trims read-through adapters and returns a merged read shorter than either input', () => {
    const fragment = randSeq(80, 5);
    const adapter = ADAPTERS.truseq.slice(0, 20);
    const r1 = read('p/1', fragment + adapter);
    const r2 = read('p/2', revComp(fragment) + adapter);
    const m = mergePair(r1, r2);
    expect(m?.seq).toBe(fragment);
    expect(m!.seq.length).toBeLessThan(r1.seq.length);
  });

  it('returns null for non-overlapping reads', () => {
    const fragment = randSeq(300, 13);
    const r1 = read('p/1', fragment.slice(0, 100));
    const r2 = read('p/2', revComp(fragment.slice(200)));
    expect(mergePair(r1, r2)).toBeNull();
  });
});
