import { describe, expect, it } from 'vitest';
import type { Genotypes, Snp } from '../variants/assoc';
import { admix } from './admix';
import { betaSample, demoGenotypes } from './demo';
import { parsePopTable, structurePca } from './stats';

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

function coin2(rnd: () => number, p: number) {
  return (rnd() < p ? 1 : 0) + (rnd() < p ? 1 : 0);
}

function pearson(a: number[], b: number[]) {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return sab / Math.sqrt(saa * sbb);
}

/** Two source populations at Fst 0.1 plus admixed individuals whose alleles come from A with probability α. */
function simulate(seed: number, loci: number, perPop: number, nAdm: number) {
  const rnd = mulberry32(seed), fst = 0.1;
  const alpha = Array.from({ length: nAdm }, () => 0.2 + 0.6 * rnd());
  const pop = [...Array(perPop).fill('A'), ...Array(perPop).fill('B'), ...Array(nAdm).fill('M')];
  const G: Int8Array[] = [];
  for (let j = 0; j < loci; j++) {
    const p = 0.1 + 0.8 * rnd();
    const a = (p * (1 - fst)) / fst, b = ((1 - p) * (1 - fst)) / fst;
    const pA = betaSample(rnd, a, b), pB = betaSample(rnd, a, b);
    const g = new Int8Array(pop.length);
    for (let i = 0; i < perPop; i++) g[i] = coin2(rnd, pA);
    for (let i = 0; i < perPop; i++) g[perPop + i] = coin2(rnd, pB);
    for (let i = 0; i < nAdm; i++) g[2 * perPop + i] = coin2(rnd, alpha[i] * pA + (1 - alpha[i]) * pB);
    G.push(g);
  }
  const snps: Snp[] = G.map((_, j) => ({ id: `snp${j + 1}`, chrom: '1', pos: j + 1 }));
  const samples = pop.map((_, i) => `s${i + 1}`);
  return { G, geno: { samples, snps, G } as Genotypes, pop, alpha };
}

describe('admixture EM', () => {
  const sim = simulate(20261023, 1500, 60, 20);

  it('recovers the ancestry proportions of admixed individuals at K = 2', () => {
    const fit = admix(sim.G, 2, { seed: 7 });
    const q = fit.Q.slice(120).map((r) => r[0]), q1 = fit.Q.slice(120).map((r) => r[1]);
    const corr = Math.max(pearson(q, sim.alpha), pearson(q1, sim.alpha));
    expect(corr).toBeGreaterThan(0.95);
  }, 120_000);

  it('prefers K = 2 over K = 1 by a wide log-likelihood margin', () => {
    const k1 = admix(sim.G, 1, { seed: 11, starts: 2 });
    const k2 = admix(sim.G, 2, { seed: 11, starts: 2 });
    expect(k2.logLik).toBeGreaterThan(k1.logLik + 100);
  }, 120_000);

  it('never decreases the log-likelihood across EM iterations', () => {
    const fit = admix(sim.G, 2, { seed: 5, starts: 1, maxIter: 60 });
    for (let i = 1; i < fit.trace.length; i++) expect(fit.trace[i]).toBeGreaterThanOrEqual(fit.trace[i - 1] - 1e-9);
  }, 120_000);

  it('is deterministic for a seed', () => {
    const a = admix(sim.G, 2, { seed: 42, starts: 2, maxIter: 40 });
    const b = admix(sim.G, 2, { seed: 42, starts: 2, maxIter: 40 });
    expect(b.Q).toEqual(a.Q);
    expect(b.logLik).toBe(a.logLik);
  }, 120_000);

  it('reports BIC and sorts ancestry columns by mean', () => {
    const fit = admix(sim.G, 2, { seed: 3, starts: 1, maxIter: 20 });
    expect(fit.bic).toBeCloseTo(-2 * fit.logLik + fit.params * Math.log(fit.nObs), 8);
    const means = [0, 1].map((k) => fit.Q.reduce((s, r) => s + r[k], 0) / fit.Q.length);
    expect(means[0]).toBeGreaterThanOrEqual(means[1]);
    for (const row of fit.Q) expect(row.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 8);
  }, 120_000);
});

describe('PCA after LD pruning', () => {
  it('separates the two source populations on PC1', () => {
    const sim = simulate(777, 1500, 60, 20);
    const { pcs } = structurePca(sim.geno, 2);
    const a = [], b = [], pc1 = pcs[0];
    for (let i = 0; i < sim.pop.length; i++) if (sim.pop[i] === 'A') a.push(pc1[i]); else if (sim.pop[i] === 'B') b.push(pc1[i]);
    const sep = Math.max(...a) < Math.min(...b) || Math.max(...b) < Math.min(...a);
    expect(sep).toBe(true);
  }, 120_000);
});

describe('studio demo', () => {
  it('parses and has the expected three labels', () => {
    const demo = demoGenotypes({ loci: 60, perPop: 10, admixed: 4 });
    const parsed = parsePopTable(demo.text);
    expect(parsed.samples).toHaveLength(24);
    expect(parsed.snps).toHaveLength(60);
    expect(new Set(parsed.pop)).toEqual(new Set(['Population A', 'Population B', 'Admixed']));
    expect(demo.alpha).toHaveLength(4);
  });
});
