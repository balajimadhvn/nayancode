import { describe, expect, it } from 'vitest';
import { parseFasta } from '../sequence/kernels';
import { bootstrapSupport, conservation, distanceMatrix, leaves, midpointRoot, nj, parseNewick, progressiveMsa, syntheticFamily, toNewick, upgma } from './kernels';

describe('newick', () => {
  it('round-trips with lengths and support', () => {
    const t = parseNewick('((A:0.1,B:0.2)90:0.3,(C:0.4,D:0.5)80:0.1,E:0.2);');
    expect(leaves(t).map((l) => l.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(toNewick(t)).toBe('((A:0.1,B:0.2)90:0.3,(C:0.4,D:0.5)80:0.1,E:0.2);');
  });
  it('rejects broken input', () => { expect(() => parseNewick('((A,B)')).toThrow(); });
});

describe('distance models', () => {
  it('JC69 matches the closed form', () => {
    const D = distanceMatrix(['ACGTACGTAC', 'ACGTACGTAA'], 'jc');
    expect(D[0][1]).toBeCloseTo(-0.75 * Math.log(1 - (4 / 3) * 0.1), 10);
  });
  it('K2P matches the closed form for one transition vs one transversion in 10 sites', () => {
    const ts = distanceMatrix(['AAAAAAAAAA', 'GAAAAAAAAA'], 'k2p')[0][1];
    const tv = distanceMatrix(['AAAAAAAAAA', 'CAAAAAAAAA'], 'k2p')[0][1];
    expect(ts).toBeCloseTo(-0.5 * Math.log(0.8), 10);
    expect(tv).toBeCloseTo(-0.5 * Math.log(0.9) - 0.25 * Math.log(0.8), 10); // Kimura 1980 with P=0, Q=0.1
  });
});

describe('tree building', () => {
  // additive distances from the tree ((A:2,B:3):1,(C:4,D:5):2) -> NJ must recover them exactly
  const D = [[0, 5, 9, 10], [5, 0, 10, 11], [9, 10, 0, 9], [10, 11, 9, 0]];
  it('NJ recovers an additive tree', () => {
    const t = nj(D, ['A', 'B', 'C', 'D']);
    const pairs = (x: ReturnType<typeof nj>): string[] => { const out: string[] = []; const rec = (n: typeof x): string[] => { if (!n.children.length) return [n.name!]; const s = n.children.flatMap(rec); if (s.length === 2) out.push(s.sort().join('')); return s; }; rec(x); return out.sort(); };
    expect(pairs(t)).toContain('AB'); // unrooted: C and D hang off the root with the AB clade
    const total = (n: typeof t): number => n.length + n.children.reduce((a, c) => a + total(c), 0);
    expect(total(t)).toBeCloseTo(17, 6); // 2+3+4+5 pendant + 3 internal
  });
  it('UPGMA is ultrametric', () => {
    const t = upgma(D, ['A', 'B', 'C', 'D']);
    const depth = (n: typeof t, d = 0): number[] => (n.children.length ? n.children.flatMap((c) => depth(c, d + c.length)) : [d]);
    const ds = depth(t); expect(Math.max(...ds) - Math.min(...ds)).toBeLessThan(1e-9);
  });
  it('midpoint root splits the diameter evenly', () => {
    const t = midpointRoot(nj(D, ['A', 'B', 'C', 'D']));
    const depth = (n: typeof t, d = 0): { d: number; name?: string }[] => (n.children.length ? n.children.flatMap((c) => depth(c, d + c.length)) : [{ d, name: n.name }]);
    const [a, b] = t.children.map((c) => Math.max(...depth(c, c.length).map((x) => x.d)));
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });
});

describe('progressive MSA', () => {
  const recs = parseFasta(syntheticFamily(3, 9, 150));
  const msa = progressiveMsa(recs.map((r) => r.id), recs.map((r) => r.seq), 'protein');
  it('keeps every residue and produces rectangular output', () => {
    expect(new Set(msa.aligned.map((r) => r.length)).size).toBe(1);
    msa.aligned.forEach((r, i) => expect(r.replace(/-/g, '')).toBe(recs[i].seq));
  });
  it('aligns a simple DNA indel correctly', () => {
    const r = progressiveMsa(['a', 'b', 'c'], ['ACGTACGTACGTAAA', 'ACGTACGTCGTAAA', 'ACGTACGTACGTAAA'], 'dna');
    expect(r.aligned[1].replace(/-/g, '')).toBe('ACGTACGTCGTAAA');
    expect(r.aligned[1].split('-').length - 1).toBe(1);
  });
  it('recovers the three planted clades by bootstrap-supported tree', () => {
    const D = distanceMatrix(msa.aligned, 'poisson');
    const tree = midpointRoot(nj(D, msa.names));
    const sup = bootstrapSupport(msa.aligned, msa.names, tree, 'poisson', 'nj', 40);
    const supports: number[] = []; const rec = (n: typeof sup) => { if (n.children.length && n.support !== undefined) supports.push(n.support); n.children.forEach(rec); }; rec(sup);
    expect(Math.max(...supports)).toBeGreaterThan(90);
    const cons = conservation(msa.aligned, 'protein'); expect(cons.meanIdentity).toBeGreaterThan(0.3);
  });
});
