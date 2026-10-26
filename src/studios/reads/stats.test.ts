import { describe, expect, it } from 'vitest';
import { statsOf } from './stats';
import type { FastqRecord } from './fastq';

const Q = (q: number, n: number) => String.fromCharCode(33 + q).repeat(n);
const rows: FastqRecord[] = [
  { id: 'r1', desc: '', seq: 'ACGTACGT', qual: Q(30, 8) },
  { id: 'r2', desc: '', seq: 'GGCCNN', qual: Q(20, 6) },
  { id: 'r3', desc: '', seq: 'ATAT', qual: Q(10, 4) },
];

describe('statsOf', () => {
  it('matches the hand-computed summary', () => {
    const s = statsOf(rows);
    expect(s.reads).toBe(3);
    expect(s.bases).toBe(18);
    expect(s.meanLength).toBe(6);
    // Called bases = 16, of which 8 are G/C.
    expect(s.gcPct).toBeCloseTo(50, 12);
    // Q20: 8 bases at Q30 + 6 at Q20 = 14/18; Q30: 8/18.
    expect(s.q20Pct).toBeCloseTo((100 * 14) / 18, 12);
    expect(s.q30Pct).toBeCloseTo((100 * 8) / 18, 12);
    expect(s.nCount).toBe(2);
    expect(s.adapterHitPct).toBe(0);
    expect(s.lengthHist).toEqual([{ length: 4, count: 1 }, { length: 6, count: 1 }, { length: 8, count: 1 }]);
    expect(s.posMean.slice(0, 8)).toEqual([20, 20, 20, 20, 25, 25, 30, 30]);
  });

  it('counts adapter prefix hits', () => {
    const r: FastqRecord = { id: 'a', desc: '', seq: 'ACGTACGT' + 'AGATCGGAAGAGC', qual: Q(30, 21) };
    expect(statsOf([r]).adapterHitPct).toBe(100);
  });
});
