import { describe, expect, it } from 'vitest';
import { gsea } from './gsea';
import type { GeneSet, RankedGene } from './gmt';

const toy = (): RankedGene[] => Array.from({ length: 10 }, (_, i) => ({ gene: `G${i + 1}`, score: 10 - i }));

describe('gsea', () => {
  it('gives ES 0.95 on the hand-computed toy example', () => {
    const set: GeneSet = { name: 'TOY', description: '', genes: ['G1', 'G2', 'G10'] };
    const r = gsea(toy(), [set], { perms: 10, seed: 1, minSize: 1 });
    expect(r.ranked).toBe(10);
    expect(r.rows).toHaveLength(1);
    // weights 10+9+1 = 20: +10/20=0.5, +9/20=0.45 -> 0.95, then 7 misses of 1/7
    // (0.95 -> -0.05), then the last hit +1/20 -> 0.0; the largest |running sum| is 0.95.
    expect(r.rows[0].es).toBeCloseTo(0.95, 12);
    expect(r.rows[0].curve).toHaveLength(10);
    expect(r.rows[0].hitPositions).toEqual([1, 2, 10]);
    expect(r.rows[0].curve[1]).toBeCloseTo(0.95, 12);
    expect(r.rows[0].curve[9]).toBeCloseTo(0, 12);
  });

  it('finds the planted top set and not a random set', () => {
    let a = 12345;
    const rnd = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const normal = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
    const genes = Array.from({ length: 1000 }, (_, i) => `G${String(i).padStart(4, '0')}`);
    const ranked = genes.map((gene) => ({ gene, score: normal() })).sort((x, y) => y.score - x.score);
    const pick = (pool: string[], n: number) => {
      const b = [...pool];
      for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
      return b.slice(0, n);
    };
    const top = ranked.slice(0, 100).map((r) => r.gene);
    const setA: GeneSet = { name: 'TOP', description: '', genes: pick(top, 30) };
    const setB: GeneSet = { name: 'RANDOM', description: '', genes: pick(genes, 30) };
    const r = gsea(ranked, [setA, setB], { perms: 1000, seed: 7 });
    const A = r.rows.find((x) => x.name === 'TOP')!, B = r.rows.find((x) => x.name === 'RANDOM')!;
    // Seeded outcome recorded from this implementation (perms 1000, seed 7):
    // TOP es ≈ 0.9299, p ≈ 0.00169, NES ≈ 3.065, FDR ≈ 0.00337; RANDOM p ≈ 0.2687.
    expect(A.es).toBeGreaterThan(0.5);
    expect(A.p).toBeLessThan(0.01);
    expect(B.p).toBeGreaterThan(0.01);
    expect(A.nes).toBeGreaterThan(1);
    expect(A.fdr).toBeLessThan(0.01);
  });

  it('is deterministic for the same seed and input', () => {
    const set: GeneSet = { name: 'TOY', description: '', genes: ['G1', 'G2', 'G10'] };
    const a = gsea(toy(), [set], { perms: 50, seed: 3, minSize: 1 });
    const b = gsea(toy(), [set], { perms: 50, seed: 3, minSize: 1 });
    expect(b).toEqual(a);
    const c = gsea(toy(), [set], { perms: 50, seed: 4, minSize: 1 });
    expect(c.rows[0].p).not.toBe(a.rows[0].p);
  });
});
