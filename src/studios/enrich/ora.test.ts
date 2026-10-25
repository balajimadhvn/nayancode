import { describe, expect, it } from 'vitest';
import type { GeneSet } from './gmt';
import { hypergeomSf, ora } from './ora';

const universe = Array.from({ length: 100 }, (_, i) => `G${String(i + 1).padStart(3, '0')}`);

describe('hypergeomSf', () => {
  it('matches scipy.stats.hypergeom.sf(4, 100, 10, 10)', () => {
    // python3 -c "from scipy.stats import hypergeom; print(repr(hypergeom.sf(4,100,10,10)))"
    // -> 0.0006716277482650502
    expect(hypergeomSf(5, 100, 10, 10)).toBeCloseTo(0.0006716277482650502, 13);
  });

  it('matches scipy.stats.hypergeom.sf(11, 20000, 300, 200)', () => {
    // python3 -c "from scipy.stats import hypergeom; print(repr(hypergeom.sf(11,20000,300,200)))"
    // -> 5.187245060354875e-05
    expect(hypergeomSf(12, 20_000, 300, 200)).toBeCloseTo(5.187245060354875e-5, 12);
  });
});

describe('ora', () => {
  it('computes the known N=100, K=10, n=10, k=5 answer and fold enrichment 5', () => {
    const set: GeneSet = { name: 'SET', description: '', genes: universe.slice(0, 10) };
    const list = [...universe.slice(0, 5), ...universe.slice(10, 15)];
    const rows = ora(list, [set], universe);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'SET', K: 10, k: 5, n: 10, N: 100 });
    expect(rows[0].p).toBeCloseTo(0.0006716277482650502, 13);
    expect(rows[0].fold).toBeCloseTo(5, 12);
    expect(rows[0].fdr).toBeCloseTo(0.0006716277482650502, 13);
    expect(rows[0].genes.sort()).toEqual(universe.slice(0, 5));
  });

  it('drops list genes outside the background and reports the reduced n', () => {
    const set: GeneSet = { name: 'SET', description: '', genes: universe.slice(0, 10) };
    const list = [...universe.slice(0, 6), 'NOT_IN_BACKGROUND', 'ALSO_MISSING'];
    const rows = ora(list, [set], universe);
    expect(rows[0]).toMatchObject({ K: 10, k: 6, n: 6, N: 100 });
  });

  it('uses the union of sets as the default universe and skips sets outside the size limits', () => {
    const big: GeneSet = { name: 'BIG', description: '', genes: universe.slice(0, 20) };
    const small: GeneSet = { name: 'SMALL', description: '', genes: universe.slice(0, 3) };
    const rows = ora(universe.slice(0, 5), [big, small]);
    expect(rows.map((r) => r.name)).toEqual(['BIG']);
    expect(rows[0]).toMatchObject({ K: 20, k: 5, n: 5, N: 20 });
    expect(rows[0].fold).toBeCloseTo(1, 12);
  });

  it('sorts by p and applies Benjamini-Hochberg across the tested sets', () => {
    const strong: GeneSet = { name: 'STRONG', description: '', genes: universe.slice(0, 10) };
    const weak: GeneSet = { name: 'WEAK', description: '', genes: universe.slice(40, 60) };
    const rows = ora([...universe.slice(0, 9), ...universe.slice(20, 30)], [weak, strong], universe);
    expect(rows.map((r) => r.name)).toEqual(['STRONG', 'WEAK']);
    expect(rows[0].p).toBeLessThan(rows[1].p);
    expect(rows[0].fdr).toBeGreaterThanOrEqual(rows[0].p);
    expect(rows[1].fdr).toBeCloseTo(1, 12);
  });
});
