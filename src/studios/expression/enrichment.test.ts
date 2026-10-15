import { describe, expect, it } from 'vitest';
import { gsea, hypergeomUpper, normaliseGenes, ora, unpack, type GeneSet, type GeneSetPack } from './enrichment';

const mk = (id: string, genes: string[]): GeneSet => ({ id, name: id, genes: new Set(genes) });
describe('hypergeometric', () => {
  it('matches exact small cases', () => {
    // N=10, K=4, n=3: P(X>=2) = [C(4,2)C(6,1) + C(4,3)C(6,0)] / C(10,3) = (36+4)/120
    expect(hypergeomUpper(2, 4, 3, 10)).toBeCloseTo(40 / 120, 12);
    expect(hypergeomUpper(0, 4, 3, 10)).toBe(1); expect(hypergeomUpper(5, 4, 3, 10)).toBe(0);
  });
});
describe('ORA', () => {
  const bg = Array.from({ length: 200 }, (_, i) => 'G' + i);
  const sets = [mk('target', bg.slice(0, 20)), mk('other', bg.slice(100, 120)), mk('mixed', [...bg.slice(0, 3), ...bg.slice(150, 170)])];
  it('finds the over-represented set and controls the rest', () => {
    const list = [...bg.slice(0, 15), ...bg.slice(100, 102)], r = ora(sets, list, bg);
    expect(r[0].id).toBe('target'); expect(r[0].fdr).toBeLessThan(1e-6); expect(r[0].fold).toBeGreaterThan(2.5); // universe = annotated background genes (60), as in clusterProfiler
    expect(r.find((x) => x.id === 'other')?.fdr ?? 1).toBeGreaterThan(0.05);
  });
  it('explains an identifier mismatch', () => { expect(() => ora(sets, ['x', 'y', 'z'], bg)).toThrow(/HGNC symbols/); });
});
describe('GSEA', () => {
  const names = Array.from({ length: 1500 }, (_, i) => 'G' + i);
  // ranked by score descending: G0 highest
  const ranked = names.map((g, i) => ({ gene: g, score: 5 - (10 * i) / names.length }));
  it('detects a set concentrated at the top and one at the bottom, ignores a random set', () => {
    let s = 5; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const top = mk('top', names.slice(0, 40).filter((_, i) => i % 1 === 0)), bottom = mk('bottom', names.slice(-40)), rand = mk('rand', Array.from({ length: 40 }, () => names[Math.floor(rnd() * 1500)]));
    const r = gsea([top, bottom, rand], ranked, { perms: 400, minSize: 10 }), by = (id: string) => r.find((x) => x.id === id)!;
    expect(by('top').nes).toBeGreaterThan(2); expect(by('top').p).toBeLessThan(0.01);
    expect(by('bottom').nes).toBeLessThan(-2); expect(by('bottom').p).toBeLessThan(0.01);
    expect(by('rand').p).toBeGreaterThan(0.05); expect(by('top').leadingEdge[0]).toBe('G0');
  });
});
describe('identifier handling', () => {
  it('maps Ensembl IDs and upper-cases symbols', () => {
    const r = normaliseGenes(['ENSG00000141510.15', 'Trp53', 'ENSG00000000000'], { ENSG00000141510: 'TP53' });
    expect(r.symbols).toEqual(['TP53', 'TRP53', 'ENSG00000000000']); expect(r.mapped).toBe(1); expect(r.unmapped).toBe(1);
  });
  it('unpacks the compressed pack format', () => {
    const pack: GeneSetPack = { meta: { name: 't', license: 'x', attribution: '', source: '', built: '', nSets: 1, species: 'h' }, genes: ['a', 'b', 'c'], sets: [{ id: '1', name: 'S', g: [0, 2] }] };
    expect([...unpack(pack)[0].genes]).toEqual(['A', 'C']);
  });
});
