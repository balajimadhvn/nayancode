import { describe, expect, it } from 'vitest';
import { aggregateTaxa, alphaDiversity, betaDiversity, differentialAbundance, kruskalWallis, mannWhitney, parseFeatureTable, parseMetadata, pcoa, permanova, rarefactionCurve, syntheticMicrobiome } from './kernels';

const T = (rows: number[][], names = rows.map((_, i) => 'f' + i)) => parseFeatureTable('f,' + rows[0].map((_, j) => 's' + j).join(',') + '\n' + rows.map((r, i) => names[i] + ',' + r.join(',')).join('\n'));
describe('alpha diversity', () => {
  it('matches closed forms', () => {
    const a = alphaDiversity(T([[10, 1], [10, 1], [10, 1], [10, 97]]));
    expect(a[0].shannon).toBeCloseTo(Math.log(4), 10); expect(a[0].simpson).toBeCloseTo(0.75, 10); expect(a[0].pielou).toBeCloseTo(1, 10); expect(a[0].observed).toBe(4);
    expect(a[1].shannon).toBeLessThan(a[0].shannon);
    expect(a[1].chao1).toBeGreaterThan(a[1].observed - 1e-9);
  });
  it('rarefaction curve is monotone and reaches observed richness', () => {
    const t = T([[50, 5], [30, 5], [15, 5], [5, 5]]), c = rarefactionCurve(t, 0, 8);
    for (let i = 1; i < c.length; i++) expect(c[i].richness).toBeGreaterThanOrEqual(c[i - 1].richness - 1e-9);
    expect(c[c.length - 1].richness).toBeCloseTo(4, 6);
  });
});
describe('beta diversity & PCoA', () => {
  it('Bray-Curtis, Jaccard known values', () => {
    const t = T([[10, 0, 5], [0, 10, 5], [10, 10, 0]]);
    expect(betaDiversity(t, 'bray')[0][1]).toBeCloseTo(0.5, 10); // x=(.5,0,.5), y=(0,.5,.5) expect(betaDiversity(t, 'jaccard')[0][1]).toBeCloseTo(1 - 1 / 3, 10); expect(betaDiversity(t, 'bray')[0][0]).toBe(0);
  });
  it('PCoA of Euclidean distances reproduces them', () => {
    const P = [[0, 0], [3, 0], [0, 4], [3, 4], [1.5, 2]], D = P.map((a) => P.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))), { coords } = pcoa(D, 2);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) expect(Math.hypot(coords[i][0] - coords[j][0], coords[i][1] - coords[j][1])).toBeCloseTo(D[i][j], 6);
  });
});
describe('tests', () => {
  it('Mann-Whitney matches a reference', () => { expect(mannWhitney([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])).toBeCloseTo(0.0122, 3); expect(mannWhitney([1, 2, 3], [1, 2, 3])).toBeGreaterThan(0.9); });
  it('Kruskal-Wallis matches R kruskal.test on a textbook example', () => { expect(kruskalWallis([[2.9, 3.0, 2.5, 2.6, 3.2], [3.8, 2.7, 4.0, 2.4], [2.8, 3.4, 3.7, 2.2, 2.0]])).toBeCloseTo(0.68, 2); }); // R ?kruskal.test (Hollander & Wolfe): chi-squared = 0.77143, df = 2, p = 0.68
});
describe('synthetic study end to end', () => {
  const d = syntheticMicrobiome(6, 12), t = parseFeatureTable(d.table), meta = parseMetadata(d.meta, t.samples), groups = meta.values.group;
  it('PERMANOVA detects the group effect and not a shuffled one', () => {
    const D = betaDiversity(t, 'bray'), r = permanova(D, groups, 499, 1); expect(r.p).toBeLessThan(0.01); expect(r.R2).toBeGreaterThan(0.2);
    const shuf = groups.map((_, i) => (i % 2 ? 'treated' : 'control')); expect(permanova(D, shuf, 499, 1).p).toBeGreaterThan(0.05);
  });
  it('differential abundance recovers the planted taxa', () => {
    const rows = differentialAbundance(t, groups, 'control', 'treated'), called = rows.filter((r) => r.fdr < 0.05), tp = called.filter((r) => d.truth.has(r.feature)).length;
    expect(tp / d.truth.size).toBeGreaterThan(0.8); expect((called.length - tp) / called.length).toBeLessThan(0.15);
    expect(rows.find((r) => r.taxon.includes('Akkermansia'))!.log2fc).toBeGreaterThan(0);
  });
  it('aggregates taxa to genus with an Other bin', () => { const a = aggregateTaxa(t, 5, 8); expect(a.taxa).toContain('Other'); a.rel[0].forEach((_, j) => expect(a.rel.reduce((s, r) => s + r[j], 0)).toBeCloseTo(1, 8)); });
  it('reports bad input', () => { expect(() => parseMetadata('sample,group\nX,a', t.samples)).toThrow(/missing/); });
});
