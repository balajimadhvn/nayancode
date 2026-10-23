import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Genotypes, Snp } from '../variants/assoc';
import { betaSample } from './demo';
import { mulberry32, alleleFreqs, ldMatrix, pairwiseFst, parsePopAssignments, parsePopTable, wcFst } from './stats';

const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/assoc/reference.json', import.meta.url), 'utf8')) as { hwe: [number[], number][] };
const hweP504010 = (ref.hwe.find(([counts]) => counts.join() === '50,40,10') ?? [[], 0.6367558662349944])[1];

function build(rows: number[][], pop: string[]): { geno: Genotypes; pop: string[] } {
  const snps: Snp[] = rows.map((_, j) => ({ id: `snp${j + 1}`, chrom: '1', pos: j + 1 }));
  return { geno: { samples: pop.map((_, i) => `s${i + 1}`), snps, G: rows.map((r) => Int8Array.from(r)) }, pop };
}

function binomial2(rnd: () => number, p: number) {
  return (rnd() < p ? 1 : 0) + (rnd() < p ? 1 : 0);
}

/** Balding–Nichols simulation: two populations with the requested F_ST, nPer individuals each. */
function simulate(seed: number, loci: number, nPer: number, fst: number) {
  const rnd = mulberry32(seed);
  const pop = [...Array(nPer).fill('A'), ...Array(nPer).fill('B')];
  const G: Int8Array[] = [];
  for (let j = 0; j < loci; j++) {
    const p = 0.1 + 0.8 * rnd();
    let pA = p, pB = p;
    if (fst > 0) {
      const a = (p * (1 - fst)) / fst, b = ((1 - p) * (1 - fst)) / fst;
      pA = betaSample(rnd, a, b); pB = betaSample(rnd, a, b);
    }
    const g = new Int8Array(2 * nPer);
    for (let i = 0; i < nPer; i++) { g[i] = binomial2(rnd, pA); g[nPer + i] = binomial2(rnd, pB); }
    G.push(g);
  }
  return build(G.map((g) => Array.from(g)), pop);
}

describe('population table input', () => {
  it('reads the population column and keeps the dosages', () => {
    const parsed = parsePopTable('sample,population,snpA,snpB\ns1,East,0,2\ns2,West,1,NA\ns3,East,2,0');
    expect(parsed.samples).toEqual(['s1', 's2', 's3']);
    expect(parsed.pop).toEqual(['East', 'West', 'East']);
    expect(parsed.snps.map((s) => s.id)).toEqual(['snpA', 'snpB']);
    expect(Array.from(parsed.G[1])).toEqual([2, -1, 0]);
  });

  it('rejects a table without a population column', () => {
    expect(() => parsePopTable('sample,snpA\ns1,0\ns2,1')).toThrow(/population/i);
  });

  it('aligns a separate population sheet to VCF sample names', () => {
    expect(parsePopAssignments('sample\tpopulation\nb\tWest\na\tEast', ['a', 'b'])).toEqual(['East', 'West']);
    expect(() => parsePopAssignments('sample\tpopulation\na\tEast', ['a', 'b'])).toThrow(/No population for b/);
  });
});

describe('allele frequencies and HWE', () => {
  it('reports Ho, unbiased He and F for a known genotype count', () => {
    const rows = [[0, 0, 1, 1, 2, 2]];
    const out = alleleFreqs(build(rows, ['P', 'P', 'P', 'P', 'P', 'P']).geno, ['P', 'P', 'P', 'P', 'P', 'P']);
    expect(out).toHaveLength(1);
    expect(out[0].n).toBe(6);
    expect(out[0].alt).toBeCloseTo(6 / 12, 12);
    expect(out[0].Ho).toBeCloseTo(2 / 6, 12);
    expect(out[0].He).toBeCloseTo((2 * 0.5 * 0.5 * 12) / 11, 12);
    expect(out[0].F).toBeCloseTo(1 - (2 / 6) / (6 / 11), 12);
  });

  it('calls the shared exact HWE test: (50, 40, 10) gives the reference p', () => {
    const dosages = [...Array(50).fill(0), ...Array(40).fill(1), ...Array(10).fill(2)];
    const { geno } = build([dosages], Array(100).fill('P'));
    const [row] = alleleFreqs(geno, Array(100).fill('P'));
    expect(row.hweP).toBeCloseTo(hweP504010, 12);
  });

  it('skips missing genotypes', () => {
    const { geno } = build([[-1, 0, -1, 2]], ['P', 'P', 'P', 'P']);
    const [row] = alleleFreqs(geno, ['P', 'P', 'P', 'P']);
    expect(row.n).toBe(2);
    expect(row.alt).toBeCloseTo(0.5, 12);
  });
});

describe('Weir–Cockerham Fst', () => {
  it('recovers F_ST = 0.05 from a Balding–Nichols simulation', () => {
    const { geno, pop } = simulate(20261023, 3000, 100, 0.05);
    const fst = wcFst(geno, pop, { resamples: 0 });
    expect(Math.abs(fst.theta - 0.05)).toBeLessThan(0.006);
  }, 60_000);

  it('is near zero when both populations share allele frequencies', () => {
    const { geno, pop } = simulate(99, 3000, 100, 0);
    expect(Math.abs(wcFst(geno, pop, { resamples: 0 }).theta)).toBeLessThan(0.003);
  }, 60_000);

  it('gives a mean inbreeding coefficient near zero for a Hardy–Weinberg sample', () => {
    const rnd = mulberry32(1776);
    const nPer = 200, loci = 3000, pop = Array(nPer).fill('P');
    const G: Int8Array[] = [];
    for (let j = 0; j < loci; j++) {
      const p = 0.1 + 0.8 * rnd();
      G.push(Int8Array.from({ length: nPer }, () => binomial2(rnd, p)));
    }
    const { geno } = build(G.map((g) => Array.from(g)), pop);
    const rows = alleleFreqs(geno, pop);
    const meanF = rows.reduce((a, r) => a + r.F, 0) / rows.length;
    expect(Math.abs(meanF)).toBeLessThan(0.02);
  }, 60_000);

  it('approaches 1 for fully fixed differences and gives a symmetric pairwise matrix', () => {
    const rows = Array.from({ length: 20 }, () => [...Array(50).fill(0), ...Array(50).fill(2)]);
    const pop = [...Array(50).fill('A'), ...Array(50).fill('B')];
    const { geno } = build(rows, pop);
    const fst = wcFst(geno, pop, { resamples: 50, seed: 3 });
    expect(fst.theta).toBeGreaterThan(0.95);
    expect(fst.ci95).not.toBeNull();
    expect(fst.ci95![0]).toBeLessThanOrEqual(fst.ci95![1]);
    const pw = pairwiseFst(geno, pop);
    expect(pw.populations).toEqual(['A', 'B']);
    expect(pw.matrix[0][1]).toBeGreaterThan(0.95);
    expect(pw.matrix[1][0]).toBeCloseTo(pw.matrix[0][1], 12);
    expect(pw.matrix[0][0]).toBe(0);
  });
});

describe('LD matrix', () => {
  it('reports r² = 1 for identical markers and 0 outside the window', () => {
    const rows = [[0, 1, 2, 1, 0, 2], [0, 1, 2, 1, 0, 2], [2, 0, 1, 0, 2, 1]];
    const { geno } = build(rows, Array(6).fill('P'));
    const full = ldMatrix(geno, [0, 1, 2], 10);
    expect(full.matrix[0][1]).toBeCloseTo(1, 12);
    expect(full.matrix[0][2]).toBeGreaterThanOrEqual(0);
    const narrow = ldMatrix(geno, [0, 1, 2], 0);
    expect(narrow.matrix[0][1]).toBe(0);
  });
});
