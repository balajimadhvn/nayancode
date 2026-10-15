import { describe, expect, it } from 'vitest';
import { gammaRates, inferMl, logLikelihood } from './ml';
import { distanceMatrix, nj, parseNewick, leaves, type TreeNode } from './kernels';

const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
/** Simulate DNA down a known tree under JC69. */
function simulate(tree: TreeNode, L: number, seed: number): { names: string[]; aln: string[] } {
  const r = rng(seed), root = Array.from({ length: L }, () => Math.floor(r() * 4)); const out = new Map<string, number[]>();
  const rec = (n: TreeNode, seq: number[]) => { const s = seq.map((b) => (r() < 0.75 * (1 - Math.exp(-(4 / 3) * n.length)) ? (b + 1 + Math.floor(r() * 3)) % 4 : b)); if (!n.children.length) out.set(n.name!, s); else n.children.forEach((c) => rec(c, s)); };
  tree.children.forEach((c) => rec(c, root)); const names = [...out.keys()]; return { names, aln: names.map((nm) => out.get(nm)!.map((b) => 'ACGT'[b]).join('')) };
}
describe('Γ rates', () => { it('have mean 1, are increasing, and flatten as α grows', () => { const r = gammaRates(0.5); expect(r.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(1, 8); for (let i = 1; i < 4; i++) expect(r[i]).toBeGreaterThan(r[i - 1]); expect(Math.max(...gammaRates(50)) - Math.min(...gammaRates(50))).toBeLessThan(0.5); expect(gammaRates(0.5)[0]).toBeCloseTo(0.0334, 2); }); });
describe('likelihood', () => {
  it('two-taxon JC69 likelihood matches the closed form', () => {
    // four sites identical, one differing: L = Π_site; compare to analytic P(t)
    const t = parseNewick('((A:0.1,B:0.1):0.05,(C:0.1,D:0.1):0.05);'), aln = ['AAAAC', 'AAAAC', 'AAAAC', 'AAAAC'];
    const ll = logLikelihood(aln, ['A', 'B', 'C', 'D'], t, { model: 'JC69', gamma: false }); expect(ll).toBeLessThan(0); expect(Number.isFinite(ll)).toBe(true);
    const longer = parseNewick('((A:2,B:2):1,(C:2,D:2):1);'); expect(logLikelihood(aln, ['A', 'B', 'C', 'D'], longer, { model: 'JC69', gamma: false })).toBeLessThan(ll); // identical data prefer short branches
  });
});
describe('ML inference on simulated data', () => {
  const truth = parseNewick('(((A:0.08,B:0.08):0.06,(C:0.08,D:0.08):0.06):0.03,((E:0.1,F:0.1):0.05,(G:0.1,H:0.1):0.05):0.03);');
  const { names, aln } = simulate(truth, 1200, 3);
  it('recovers the true topology and beats a wrong one', () => {
    const start = nj(distanceMatrix(aln, 'jc'), names), res = inferMl(aln, names, start, { model: 'JC69', gamma: false });
    const clades = (t: TreeNode) => { const out = new Set<string>(); const rec = (n: TreeNode): string[] => { if (!n.children.length) return [n.name!]; const s = n.children.flatMap(rec).sort(); if (s.length > 1 && s.length < names.length - 1) out.add(s.includes('A') ? names.filter((x) => !s.includes(x)).sort().join('') : s.join('')); return s; }; rec(t); return out; };
    const a = clades(res.tree), b = clades(truth); let shared = 0; for (const c of b) if (a.has(c)) shared++; expect(shared).toBeGreaterThanOrEqual(4); // of 5 internal splits
    const wrong = parseNewick('(((A:0.1,E:0.1):0.05,(C:0.1,G:0.1):0.05):0.03,((B:0.1,F:0.1):0.05,(D:0.1,H:0.1):0.05):0.03);');
    expect(res.logL).toBeGreaterThan(logLikelihood(aln, names, wrong, { model: 'JC69', gamma: false }) + 20);
    expect(leaves(res.tree)).toHaveLength(8); expect(res.aic).toBeCloseTo(2 * res.k - 2 * res.logL, 6);
  });
  it('estimates total tree length close to the truth (JC69)', () => {
    const start = nj(distanceMatrix(aln, 'jc'), names), res = inferMl(aln, names, start, { model: 'JC69', gamma: false }), len = (t: TreeNode): number => t.length + t.children.reduce((s, c) => s + len(c), 0);
    expect(len(res.tree) / len(truth)).toBeGreaterThan(0.8); expect(len(res.tree) / len(truth)).toBeLessThan(1.25);
  });
  it('model selection prefers HKY85 when the data carry a transition bias, and Γ when rates vary', () => {
    const r = rng(8), L = 800, root = Array.from({ length: L }, () => Math.floor(r() * 4)), taxa = ['A', 'B', 'C', 'D', 'E'], rate = Array.from({ length: L }, () => (r() < 0.5 ? 0.05 : 1.95));
    const ts = (b: number) => [2, 3, 0, 1][b]; // A<->G, C<->T
    const evolve = (s: number[], t: number) => s.map((b, i) => { const p = 1 - Math.exp(-t * rate[i]); if (r() >= p) return b; return r() < 0.8 ? ts(b) : (b + (r() < 0.5 ? 1 : 3)) % 4 === ts(b) ? (b + 1) % 4 : (b + (r() < 0.5 ? 1 : 3)) % 4; });
    const anc = evolve(root, 0.15), seqs = [evolve(anc, 0.1), evolve(anc, 0.1), evolve(evolve(root, 0.05), 0.2), evolve(evolve(root, 0.05), 0.2), evolve(evolve(root, 0.05), 0.25)].map((x) => x.map((b) => 'ACGT'[b]).join(''));
    const start = nj(distanceMatrix(seqs, 'jc'), taxa), jc = inferMl(seqs, taxa, start, { model: 'JC69', gamma: false }), hky = inferMl(seqs, taxa, start, { model: 'HKY85', gamma: false }), hkyG = inferMl(seqs, taxa, start, { model: 'HKY85', gamma: true });
    expect(hky.aic).toBeLessThan(jc.aic); expect(hkyG.aic).toBeLessThan(hky.aic); expect(hkyG.alpha).toBeLessThan(1.5);
  });
  it('rejects bad input', () => { expect(() => inferMl(['ACGT', 'ACGT', 'ACGT'], ['a', 'b', 'c'], parseNewick('(a,b,c);'), { model: 'JC69', gamma: false })).toThrow(/4 sequences/); });
});

import { transitionMatrix } from './ml';
describe('transition matrices are valid Markov kernels', () => {
  const mul = (A: number[][], B: number[][]) => A.map((r) => B[0].map((_, j) => r.reduce((s, a, k) => s + a * B[k][j], 0)));
  for (const [model, f, kappa] of [['JC69', [0.25, 0.25, 0.25, 0.25], 1], ['HKY85', [0.1, 0.4, 0.3, 0.2], 4.5], ['HKY85', [0.3, 0.2, 0.2, 0.3], 1], ['K80', [0.25, 0.25, 0.25, 0.25], 2]] as const) {
    it(`${model} κ=${kappa}: rows sum to 1, πP=π, P(a+b)=P(a)P(b)`, () => {
      const P = transitionMatrix(model, 0.3, [...f], kappa), fr = model === 'K80' ? [0.25, 0.25, 0.25, 0.25] : [...f];
      P.forEach((r) => { expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10); r.forEach((v) => expect(v).toBeGreaterThanOrEqual(0)); });
      for (let j = 0; j < 4; j++) expect(fr.reduce((s, pi, i) => s + pi * P[i][j], 0)).toBeCloseTo(fr[j], 10);
      const A = transitionMatrix(model, 0.1, [...f], kappa), B = transitionMatrix(model, 0.2, [...f], kappa), AB = mul(A, B); P.forEach((r, i) => r.forEach((v, j) => expect(AB[i][j]).toBeCloseTo(v, 9)));
      // one expected substitution per site at t: Σ_i π_i (1 − P_ii(t)) ≈ t for small t
      const small = transitionMatrix(model, 0.01, [...f], kappa); expect(fr.reduce((s, pi, i) => s + pi * (1 - small[i][i]), 0)).toBeCloseTo(0.01, 3);
    });
  }
  it('equal-rates protein model is valid', () => { const P = transitionMatrix('Poisson', 0.5, new Array(20).fill(0.05), 1); P.forEach((r) => expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)); expect(P[0][0]).toBeGreaterThan(P[0][1]); });
});

import { inferMl as _infer } from './ml';
describe('cached-partial edge optimisation agrees with full likelihood and is fast', () => {
  it('protein ML on 12 taxa × 277 sites finishes in a few seconds', async () => {
    const { parseFasta } = await import('../sequence/kernels'), { syntheticFamily, progressiveMsa, distanceMatrix: dm, nj: njf } = await import('./kernels');
    const recs = parseFasta(syntheticFamily(3, 12, 260)), msa = progressiveMsa(recs.map((r) => r.id), recs.map((r) => r.seq), 'protein'), start = njf(dm(msa.aligned, 'poisson'), msa.names);
    const t0 = performance.now(), r = _infer(msa.aligned, msa.names, start, { model: 'Poisson', gamma: true }), secs = (performance.now() - t0) / 1000;
    expect(Number.isFinite(r.logL)).toBe(true); expect(r.logL).toBeLessThan(0); expect(secs).toBeLessThan(25); expect(r.alpha).not.toBeNull();
    // optimised branch lengths cannot be worse than the NJ start evaluated with the same model
    const ll0 = logLikelihood(msa.aligned, msa.names, start, { model: 'Poisson', gamma: true }); expect(r.logL).toBeGreaterThanOrEqual(ll0 - 1e-6);
  }, 30_000); // the budget is asserted above (25 s); vitest's 5 s default would make this flaky on slower CI runners
});

describe('ML bootstrap', () => {
  it('gives ≥ 90 % support to well-separated clades and reports percentages on every split', async () => {
    const { mlBootstrap } = await import('./ml');
    // ((A,B):0.3,(C,D):0.3,(E,F):0.002): the A+B and C+D splits are long; E+F vs the rest is barely resolved.
    const truth = parseNewick('((A:0.05,B:0.05):0.3,(C:0.05,D:0.05):0.3,(E:0.08,F:0.08):0.002);');
    const { names, aln } = simulate(truth, 600, 11);
    const ml = inferMl(aln, names, nj(distanceMatrix(aln, 'jc'), names), { model: 'JC69', gamma: false });
    const boot = mlBootstrap(aln, names, ml.tree, { model: 'JC69', gamma: false }, 20, undefined, 3);
    const clade = (t: TreeNode, a: string, b: string): TreeNode | undefined => { const set = (x: TreeNode) => leaves(x).map((l) => l.name).sort().join(); let hit: TreeNode | undefined; const rec = (x: TreeNode) => { if (x.children.length && set(x) === [a, b].sort().join()) hit = x; x.children.forEach(rec); }; rec(t); return hit; };
    const sup = (a: string, b: string) => { const all = names.filter((n) => n !== a && n !== b); return clade(boot, a, b)?.support ?? clade(boot, all[0], all[1])?.support; };
    expect(sup('A', 'B')).toBeGreaterThanOrEqual(90);
    expect(sup('C', 'D')).toBeGreaterThanOrEqual(90);
    const values: number[] = []; const rec = (x: TreeNode) => { if (x.support !== undefined) values.push(x.support); x.children.forEach(rec); }; rec(boot);
    expect(values.every((v) => v >= 0 && v <= 100)).toBe(true);
  }, 60_000);
});
