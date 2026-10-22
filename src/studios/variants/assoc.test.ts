import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSOC, genotypePcs, hweExact, lambdaGc, ldPrune, linearTest, logisticTest, parseGenotypeTable, parseGenotypeVcf, parsePhenotypes, r2, runAssociation, snpQc, syntheticCohort, trendTest } from './assoc';

// numpy / scipy known answers: benchmarks/assoc/make-reference.py
const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/assoc/reference.json', import.meta.url), 'utf8'));

describe('exact Hardy–Weinberg test', () => {
  it.each(ref.hwe as [number[], number][])('%j matches brute-force enumeration', (c, p) => expect(hweExact(c[0], c[1], c[2])).toBeCloseTo(p, 8));
});

describe('single-variant tests against numpy / scipy', () => {
  it('linear regression with a covariate', () => {
    const r = linearTest(ref.linear.y, ref.linear.g, [ref.linear.age])!;
    expect(r.beta).toBeCloseTo(ref.linear.beta, 8); expect(r.se).toBeCloseTo(ref.linear.se, 8); expect(r.p / ref.linear.p).toBeCloseTo(1, 6);
  });
  it('logistic regression (Wald) with a covariate', () => {
    const r = logisticTest(ref.logistic.y, ref.linear.g, [ref.linear.age])!;
    expect(r.beta).toBeCloseTo(ref.logistic.beta, 5); expect(r.se).toBeCloseTo(ref.logistic.se, 5); expect(r.p / ref.logistic.p).toBeCloseTo(1, 4);
  });
  it('Cochran–Armitage trend test', () => {
    const y: number[] = [], g: number[] = []; ref.trend.cases.forEach((c: number, k: number) => { for (let i = 0; i < c; i++) { y.push(1); g.push(k); } }); ref.trend.controls.forEach((c: number, k: number) => { for (let i = 0; i < c; i++) { y.push(0); g.push(k); } });
    const r = trendTest(y, g)!; expect(r.p / ref.trend.p).toBeCloseTo(1, 6);
  });
  it('refuses degenerate inputs', () => { expect(linearTest([1, 2], [0, 1], [])).toBeNull(); expect(trendTest([1, 1, 1], [0, 1, 2])).toBeNull(); });
});

describe('parsing', () => {
  it('reads a genotype table, flags missing values and parses chr:pos names', () => {
    const g = parseGenotypeTable('sample\t1:100\trs5\nA\t0\t2\nB\t1\tNA\nC\t2\t1\n');
    expect(g.samples).toEqual(['A', 'B', 'C']); expect(g.snps[0]).toEqual({ id: '1:100', chrom: '1', pos: 100 }); expect(Array.from(g.G[1])).toEqual([2, -1, 1]);
  });
  it('reads VCF GT as dosage and skips multi-allelic records', () => {
    const g = parseGenotypeVcf('##x\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\ts1\ts2\ts3\n1\t10\trsA\tA\tG\t.\t.\t.\tGT\t0/0\t0|1\t1/1\n1\t20\trsB\tA\tG,T\t.\t.\t.\tGT\t0/1\t0/1\t0/1\n1\t30\t.\tC\tT\t.\t.\t.\tGT\t./.\t0/1\t0/0\n');
    expect(g.snps.map((s) => s.id)).toEqual(['rsA', '1:30']); expect(Array.from(g.G[0])).toEqual([0, 1, 2]); expect(Array.from(g.G[1])).toEqual([-1, 1, 0]); expect(g.skipped).toBe(1);
  });
  it('matches phenotypes by ID, detects PLINK 1/2 case-control coding and keeps numeric covariates', () => {
    const p = parsePhenotypes('IID\tpheno\tage\n' + Array.from({ length: 12 }, (_, i) => `S${i}\t${1 + (i % 2)}\t${40 + i}`).join('\n'), Array.from({ length: 12 }, (_, i) => `S${i}`));
    expect(p.binary).toBe(true); expect(p.y.slice(0, 2)).toEqual([0, 1]); expect(p.covNames).toEqual(['age']);
  });
  it('explains missing columns and ID mismatches', () => {
    expect(() => parsePhenotypes('a\tb\n1\t2\n3\t4\n5\t6', ['x'])).toThrow(/trait column/);
    expect(() => parsePhenotypes('id\ty\n1\t1\n2\t0\n3\t1', ['x', 'y'])).toThrow(/sample IDs/);
  });
});

describe('QC and population structure', () => {
  it('computes MAF, call rate and HWE', () => { const q = snpQc(Int8Array.from([0, 0, 1, 1, 2, -1, 0, 1])); expect(q.callRate).toBeCloseTo(7 / 8, 10); expect(q.maf).toBeCloseTo(5 / 14, 10); });
  it('r² is 1 for identical SNPs and prunes duplicates', () => {
    const a = Int8Array.from([0, 1, 2, 1, 0, 2, 1, 0]); expect(r2(a, a)).toBeCloseTo(1, 12);
    const snps = [{ id: 'a', chrom: '1', pos: 1 }, { id: 'b', chrom: '1', pos: 2 }, { id: 'c', chrom: '1', pos: 3 }];
    expect(ldPrune(snps, [a, Int8Array.from(a), Int8Array.from([1, 1, 0, 2, 2, 0, 1, 1])], [0, 1, 2])).toEqual([0, 2]);
  });
  it('first PC separates two sub-populations', () => {
    const c = syntheticCohort({ n: 300, m: 600, seed: 5 }), g = parseGenotypeTable(c.genotypes);
    const pc = genotypePcs(g.G, g.G.map((_, j) => j), 2).pcs[0]; const pos = pc.filter((v) => v > 0).length;
    expect(Math.min(pos, 300 - pos)).toBeGreaterThan(100); // two clusters of comparable size
    expect(genotypePcs(g.G, g.G.map((_, j) => j), 2).var[0]).toBeGreaterThan(genotypePcs(g.G, g.G.map((_, j) => j), 2).var[1]);
  });
  it('λ is about 1 for uniform p-values', () => { let s = 1; const u = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; expect(lambdaGc(Array.from({ length: 5000 }, u))).toBeGreaterThan(0.93); expect(lambdaGc(Array.from({ length: 5000 }, u))).toBeLessThan(1.07); });
});

describe('end to end on the synthetic cohort', () => {
  for (const binary of [true, false]) it(`${binary ? 'case/control' : 'quantitative'}: recovers the three planted variants and stays calibrated`, () => {
    const c = syntheticCohort({ n: 500, m: 1200, binary, seed: 21 }), g = parseGenotypeTable(c.genotypes), ph = parsePhenotypes(c.phenotypes, g.samples);
    const r = runAssociation(g, ph, { ...DEFAULT_ASSOC, nPc: 2 });
    expect(r.test).toContain(binary ? 'logistic' : 'linear'); expect(r.covariates).toEqual(['age', 'sex', 'PC1', 'PC2']);
    const top = [...r.rows].sort((a, b) => a.p - b.p).slice(0, 6).map((x) => x.id); const hit = c.causal.filter((id) => top.includes(id));
    expect(hit.length).toBeGreaterThanOrEqual(binary ? 2 : 3);
    expect(r.lambda).toBeGreaterThan(0.85); expect(r.lambda).toBeLessThan(1.25);
  });
  it('without PCs the population structure inflates λ more than with them', () => {
    const c = syntheticCohort({ n: 500, m: 1200, binary: false, seed: 21 }), g = parseGenotypeTable(c.genotypes), ph = parsePhenotypes(c.phenotypes, g.samples);
    expect(runAssociation(g, ph, { ...DEFAULT_ASSOC, nPc: 0 }).lambda).toBeGreaterThan(runAssociation(g, ph, { ...DEFAULT_ASSOC, nPc: 2 }).lambda);
  });
  it('filters by MAF and rejects logistic on a quantitative trait', () => {
    const c = syntheticCohort({ n: 200, m: 300, binary: false, seed: 2 }), g = parseGenotypeTable(c.genotypes), ph = parsePhenotypes(c.phenotypes, g.samples);
    expect(runAssociation(g, ph, { ...DEFAULT_ASSOC, minMaf: 0.45 }).filtered.maf).toBeGreaterThan(100);
    expect(() => runAssociation(g, ph, { ...DEFAULT_ASSOC, test: 'logistic' })).toThrow(/case\/control/);
  });
});
