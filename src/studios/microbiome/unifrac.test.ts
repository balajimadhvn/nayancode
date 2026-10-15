import { describe, expect, it } from 'vitest';
import { parseFeatureTable, syntheticMicrobiome, betaDiversity, permanova, parseMetadata } from './kernels';
import { treeFromTaxonomy, unifrac } from './unifrac';

const T = (rows: number[][], names: string[]) => parseFeatureTable('f,' + rows[0].map((_, j) => 's' + j).join(',') + '\n' + rows.map((r, i) => names[i] + ',' + r.join(',')).join('\n'));
describe('UniFrac', () => {
  // ((A:1,B:1):1,C:2); S0 has only A, S1 only B, S2 only C
  const tree = '((A:1,B:1):1,C:2);', t = T([[1, 0, 0], [0, 1, 0], [0, 0, 1]], ['A', 'B', 'C']);
  it('matches hand-computed values', () => {
    const r = unifrac(t, tree); // S0 vs S1: unique A(1)+B(1) = 2 of covered A+B+internal = 3 → 2/3
    expect(r.unweighted[0][1]).toBeCloseTo(2 / 3, 10);
    // S0 vs S2: unique A(1)+internal(1)+C(2)=4 of covered 4 → 1
    expect(r.unweighted[0][2]).toBeCloseTo(1, 10);
    // weighted normalised S0 vs S1: Σ l|Δ| = 1+1+0(internal both)=2 ; norm = d(A)*1 + d(B)*1 = 2+2 = 4 → 0.5
    expect(r.weighted[0][1]).toBeCloseTo(0.5, 10); expect(r.weighted[0][0]).toBe(0); expect(r.weighted[1][0]).toBe(r.weighted[0][1]);
  });
  it('is 0 for identical communities, symmetric, bounded to [0,1]', () => { const t2 = T([[3, 3, 0], [0, 0, 5], [7, 7, 7]], ['A', 'B', 'C']), r = unifrac(t2, tree); expect(r.weighted[0][1]).toBeCloseTo(0, 10); expect(r.unweighted[0][1]).toBeGreaterThanOrEqual(0); for (const M of [r.unweighted, r.weighted]) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { expect(M[i][j]).toBeCloseTo(M[j][i], 12); expect(M[i][j]).toBeLessThanOrEqual(1 + 1e-12); } });
  it('drops features missing from the tree and explains total mismatch', () => { const r = unifrac(T([[1, 0], [0, 1], [1, 1], [2, 2]], ['A', 'B', 'C', 'ZZZ']), tree); expect(r.droppedFeatures).toEqual(['ZZZ']); expect(r.usedFeatures).toBe(3); expect(() => unifrac(T([[1, 0], [0, 1]], ['x', 'y']), tree)).toThrow(/tip names/); });
  it('phylogenetic distances separate the planted treatment effect in the synthetic study', () => {
    const d = syntheticMicrobiome(6, 12), tab = parseFeatureTable(d.table), grp = parseMetadata(d.meta, tab.samples).values.group, nwk = treeFromTaxonomy(tab.features, tab.taxonomy), r = unifrac(tab, nwk);
    expect(r.droppedFeatures).toHaveLength(0); expect(r.tips).toBe(tab.features.length);
    expect(permanova(r.weighted, grp, 499, 1).p).toBeLessThan(0.01); expect(permanova(r.weighted, grp, 499, 1).R2).toBeGreaterThan(0.2);
    void betaDiversity;
  });
});
