import { describe, expect, it } from 'vitest';
import { designPairs } from './design';

const mulberry32 = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const randomSeq = (n: number, seed: number) => { const r = mulberry32(seed); return Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join(''); };

describe('designPairs', () => {
  const T = randomSeq(2000, 11);
  const opts = { start: 700, end: 900, ampMin: 100, ampMax: 1000, tmMin: 57, tmMax: 63, lenMin: 18, lenMax: 25, gcMin: 40, gcMax: 60, maxTmDiff: 2 };

  it('returns at most ten pairs that respect every constraint and the target window', () => {
    const pairs = designPairs(T, opts);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.length).toBeLessThanOrEqual(10);
    for (const p of pairs) {
      expect(p.f.tm).toBeGreaterThanOrEqual(57); expect(p.f.tm).toBeLessThanOrEqual(63);
      expect(p.r.tm).toBeGreaterThanOrEqual(57); expect(p.r.tm).toBeLessThanOrEqual(63);
      expect(Math.abs(p.f.tm - p.r.tm)).toBeLessThanOrEqual(2);
      expect(p.amplicon).toBeGreaterThanOrEqual(100); expect(p.amplicon).toBeLessThanOrEqual(1000);
      expect(p.f.start).toBeGreaterThanOrEqual(550); expect(p.f.start).toBeLessThanOrEqual(700);
      expect(p.r.end).toBeGreaterThanOrEqual(900); expect(p.r.end).toBeLessThanOrEqual(1050);
      expect(p.f.seq).toBe(T.slice(p.f.start, p.f.end));
      expect(p.r.seq).toBe([...T.slice(p.r.start, p.r.end)].reverse().map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' }[c]!)).join(''));
    }
    expect(pairs.map((p) => p.score)).toEqual([...pairs.map((p) => p.score)].sort((a, b) => a - b));
  });

  it('is deterministic and rejects an invalid template', () => {
    expect(designPairs(T, opts)).toEqual(designPairs(T, opts));
    expect(() => designPairs('ACGTN', opts)).toThrow(/only A, C, G and T/);
  });
});
