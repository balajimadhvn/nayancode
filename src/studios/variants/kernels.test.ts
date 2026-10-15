import { describe, expect, it } from 'vitest';
import { applyRules, classify, gwasSummary, normInv, parseGwas, parseVcf, parseVep, sbsClass, syntheticGwas, syntheticVcf, vcfQc, vepRequest } from './kernels';

const VCF = `##fileformat=VCFv4.2
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\ts1
1\t100\trs1\tA\tG\t50\tPASS\tDP=30;AF=0.5\tGT:DP:AD\t0/1:30:15,15
1\t200\t.\tC\tT\t10\tLowQual\tDP=12\tGT:DP:AD\t1/1:12:0,12
2\t300\t.\tA\tC\t99\tPASS\tDP=40\tGT:DP:AD\t0/1:40:30,10
2\t400\t.\tAT\tA\t80\tPASS\tDP=22\tGT:DP:AD\t0/1:22:11,11
2\t500\t.\tG\tGTT,GT\t80\tPASS\tDP=22\tGT:DP:AD\t1/2:22:2,10,10
`;
describe('VCF', () => {
  const v = parseVcf(VCF);
  it('parses fields and classifies', () => {
    expect(v.variants).toHaveLength(5); expect(v.samples).toEqual(['s1']);
    expect(v.variants.map((x) => x.type)).toEqual(['SNV', 'SNV', 'SNV', 'DEL', 'INS']);
    expect(v.variants[0].calls[0].vaf).toBeCloseTo(0.5); expect(v.variants[4].nAlt).toBe(2);
  });
  it('Ti/Tv and spectrum', () => {
    const q = vcfQc(v); expect(q.ts).toBe(2); expect(q.tv).toBe(1); expect(q.titv).toBe(2);
    expect(q.spectrum['C>T']).toBe(1); expect(q.perSample[0].het).toBe(4); expect(q.perSample[0].hom).toBe(1);
  });
  it('filters with a funnel', () => {
    const r = applyRules(v.variants, [{ field: 'FILTER', op: '=', value: 'PASS' }, { field: 'TYPE', op: '=', value: 'SNV' }]);
    expect(r.funnel.map((f) => f.n)).toEqual([5, 4, 2]);
    expect(applyRules(v.variants, [{ field: 'DP', op: '>=', value: '30' }]).kept).toHaveLength(2);
  });
  it('rejects non-VCF', () => { expect(() => parseVcf('hello\nworld')).toThrow(/VCF/); });
  it('classifies edge cases', () => { expect(classify('A', '<DEL>')).toBe('SV'); expect(classify('AC', 'GT')).toBe('MNV'); expect(sbsClass('G', 'A')).toBe('C>T'); expect(sbsClass('A', 'A')).toBeNull(); });
  it('builds VEP requests and parses responses', () => {
    expect(vepRequest(v.variants.slice(0, 1)).variants[0]).toBe('1 100 rs1 A G . . .');
    const rows = parseVep([{ input: 'x', most_severe_consequence: 'missense_variant', transcript_consequences: [{ gene_symbol: 'TP53', impact: 'LOW' }, { gene_symbol: 'TP53', impact: 'MODERATE', biotype: 'protein_coding' }] }]);
    expect(rows[0]).toMatchObject({ gene: 'TP53', impact: 'MODERATE', consequence: 'missense_variant' });
  });
  it('synthetic demo is valid and has somatic C>T skew', () => {
    const s = parseVcf(syntheticVcf(4, 2000)); const q = vcfQc(s);
    expect(s.variants.length).toBeGreaterThan(1500); expect(q.spectrum['C>T']).toBeGreaterThan(q.spectrum['T>G']);
  });
});

describe('GWAS', () => {
  it('inverse normal reference values', () => { expect(normInv(0.975)).toBeCloseTo(1.959964, 5); expect(normInv(0.5)).toBeCloseTo(0, 10); expect(normInv(1e-8)).toBeCloseTo(-5.612001, 4); });
  it('null p-values give lambda ~ 1', () => {
    let s = 7; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const rows = Array.from({ length: 20000 }, (_, i) => ({ chrom: '1', pos: i, p: r() || 1e-9, id: 'x' + i }));
    expect(gwasSummary(rows).lambda).toBeGreaterThan(0.95); expect(gwasSummary(rows).lambda).toBeLessThan(1.05);
  });
  it('finds the planted loci', () => {
    const g = gwasSummary(parseGwas(syntheticGwas(8, 40000)));
    expect(g.leads.length).toBeGreaterThanOrEqual(3); expect(new Set(g.leads.map((l) => l.chrom))).toContain('11');
    expect(g.lambda).toBeGreaterThan(0.98); expect(g.lambda).toBeLessThan(1.3);
  });
  it('explains missing columns', () => { expect(() => parseGwas('a\tb\n1\t2')).toThrow(/Could not find/); });
});
