import { describe, expect, it } from 'vitest';
import { assemblyStats, closest, fastqQcText, intersect, jaccard, mashDistance, mergeIntervals, parseBed, sketch, subtract, summariseGff, syntheticFastq, syntheticGenomes, totalBp } from './kernels';

describe('FASTQ QC', () => {
  const fq = '@r1\nACGTACGTAC\n+\nIIIIIIIIII\n@r2\nGGGGCCCCNN\n+\n5555!!!!!!\n';
  it('counts reads, bases, GC, Q30', () => {
    const r = fastqQcText(fq);
    expect(r.reads).toBe(2); expect(r.bases).toBe(20); expect(r.minLen).toBe(10);
    expect(r.q30).toBeCloseTo(10 / 20, 10); // only the ten 'I' (Q40) bases of r1 are >= Q30
    expect(r.q20).toBeCloseTo(14 / 20, 10); // plus four '5' (Q20) bases of r2
  });
  it('rejects non-FASTQ', () => { expect(() => fastqQcText('>a\nACGT\n+\nIIII\n')).toThrow(/FASTQ/); });
  it('detects planted adapter read-through and quality decay', () => {
    const r = fastqQcText(syntheticFastq(3000, 150));
    const ad = r.adapters.find((a) => a.name.includes('TruSeq'))!.frac;
    expect(ad).toBeGreaterThan(0.05); expect(ad).toBeLessThan(0.12);
    expect(r.pos[0].mean).toBeGreaterThan(r.pos[r.pos.length - 1].mean + 8);
    expect(r.trim.find((t) => t.q === 25)!.kept).toBeLessThan(r.trim.find((t) => t.q === 15)!.kept);
  });
});

describe('assembly stats', () => {
  it('computes N50/L50 on a known set', () => {
    const lens = [2, 3, 4, 5, 6, 7, 8, 9, 10], c = lens.map((l, i) => ({ id: 'c' + i, seq: 'A'.repeat(l) }));
    const s = assemblyStats(c); // total 54, half 27: 10+9+8=27 -> N50 = 8, L50 = 3
    expect(s.total).toBe(54); expect(s.n50).toBe(8); expect(s.l50).toBe(3);
  });
});

describe('intervals', () => {
  const A = parseBed('chr1\t0\t100\ta\nchr1\t150\t300\tb\nchr2\t0\t50\tc'), B = parseBed('chr1\t50\t200\nchr2\t100\t200');
  it('merges, intersects, subtracts', () => {
    expect(mergeIntervals(parseBed('chr1\t0\t10\nchr1\t5\t20\nchr1\t30\t40'))).toHaveLength(2);
    expect(totalBp(intersect(A, B))).toBe(50 + 50); // [50,100) and [150,200)
    expect(totalBp(subtract(A, B))).toBe(50 + 100 + 50);
    expect(jaccard(A, A)).toBe(1);
  });
  it('finds closest', () => { const c = closest(parseBed('chr2\t0\t50'), parseBed('chr2\t100\t200')); expect(c[0].dist).toBe(50); });
  it('rejects bad BED', () => { expect(() => parseBed('chr1\tfoo\t10')).toThrow(); expect(() => parseBed('chr1\t10\t5')).toThrow(/end < start/); });
  it('summarises GFF', () => { const g = summariseGff('chr1\tx\tgene\t1\t100\t.\t+\t.\tID=a\nchr1\tx\texon\t1\t50\t.\t+\t.\tID=b'); expect(g.types).toHaveLength(2); });
});

describe('MinHash genome comparison', () => {
  const gs = syntheticGenomes(5, 60000), sk = gs.map((g) => sketch(g.seq, 16, 2000));
  it('identical = 0 distance', () => { expect(mashDistance(sk[0], sk[0]).distance).toBeCloseTo(0, 10); });
  it('estimates ANI of diverged genomes', () => {
    const a1 = mashDistance(sk[0], sk[1]).ani, a5 = mashDistance(sk[0], sk[2]).ani, a10 = mashDistance(sk[0], sk[3]).ani;
    expect(a1).toBeGreaterThan(0.98); expect(a1).toBeLessThan(1);
    expect(a5).toBeGreaterThan(0.93); expect(a5).toBeLessThan(0.97);
    expect(a10).toBeGreaterThan(0.87); expect(a10).toBeLessThan(0.93);
    expect(mashDistance(sk[0], sk[4]).ani).toBeLessThan(0.1);
  });
});
