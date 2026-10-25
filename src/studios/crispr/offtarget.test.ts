import { describe, expect, it } from 'vitest';
import { mitSiteScore, mitSpecificity, offTargets } from './offtarget';

const mulberry32 = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const randomSeq = (n: number, seed: number) => { const r = mulberry32(seed); return Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join(''); };
const mutate = (s: string, at: number[]) => [...s].map((c, i) => (at.includes(i + 1) ? 'ACGT'[('ACGT'.indexOf(c) + 1) % 4] : c)).join('');

const GUIDE = 'GACCTGACCTGACCTGACCT';
const plant = (bg: string, at: number, site: string) => bg.slice(0, at) + site + bg.slice(at + site.length);

describe('off-target scan', () => {
  const zero = GUIDE + 'AGG';
  const two = mutate(GUIDE, [5, 12]) + 'AGG';
  const four = mutate(GUIDE, [3, 9, 14, 18]) + 'AGG';
  let bg = randomSeq(20000, 99);
  bg = plant(bg, 5000, zero); bg = plant(bg, 10000, two); bg = plant(bg, 15000, four);
  const zeroPos = bg.indexOf(zero) + 1;

  it('finds exactly the three planted copies with the right mismatch positions', () => {
    expect(bg.indexOf(zero)).toBe(5000); expect(bg.indexOf(two)).toBe(10000); expect(bg.indexOf(four)).toBe(15000);
    const hits = offTargets(GUIDE, /[ACGT]GG/, [{ id: 'background', seq: bg }], 4);
    expect(hits).toHaveLength(3);
    const byMm = [...hits].sort((a, b) => a.mismatches.length - b.mismatches.length);
    expect(byMm[0]).toMatchObject({ pos: zeroPos, strand: 1, mismatches: [] });
    expect(byMm[1].mismatches).toEqual([5, 12]);
    expect(byMm[2].mismatches).toEqual([3, 9, 14, 18]);
    expect(byMm[0].site).toBe(zero);
    expect(byMm[0].seq).toBe('background');
  });

  it('drops the 4-mismatch copy when maxMm is 3, and can exclude the on-target copy', () => {
    expect(offTargets(GUIDE, /[ACGT]GG/, bg, 3)).toHaveLength(2);
    const excluded = offTargets(GUIDE, /[ACGT]GG/, bg, 4, { seqId: 'background', pos: zeroPos, strand: 1 });
    expect(excluded).toHaveLength(2);
    expect(excluded.some((h) => h.mismatches.length === 0)).toBe(false);
  });

  it('reports minus-strand sites in plus-strand coordinates', () => {
    const rc = (s: string) => [...s].reverse().map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' }[c]!)).join('');
    const seq = randomSeq(2000, 5);
    const bg2 = plant(seq, 700, 'CCT' + rc(GUIDE)); // the reverse complement of the guide + AGG
    const hits = offTargets(GUIDE, /[ACGT]GG/, bg2, 4);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ strand: -1, mismatches: [], site: GUIDE + 'AGG' });
    expect(hits[0].pos).toBe(704); // plus-strand 1-based start of the rc(guide) block at 0-based 703
  });
});

describe('MIT specificity', () => {
  it('scores one mismatch at the PAM-proximal end and at the PAM-distal end', () => {
    expect(mitSiteScore([20])).toBeCloseTo(0.417, 9);
    expect(mitSiteScore([1])).toBeCloseTo(1, 12);
  });
  it('scores two mismatches by the published formula', () => {
    const expected = ((1 - 0.804) * (1 - 0.583)) / (((19 - 2) / 19) * 4 + 1) / 4;
    expect(mitSiteScore([18, 20])).toBeCloseTo(expected, 12);
  });
  it('gives 100 without off-targets and 100/(1+Σ) with them', () => {
    expect(mitSpecificity([])).toBe(100);
    expect(mitSpecificity([0.417])).toBeCloseTo(70.57, 2);
  });
});
