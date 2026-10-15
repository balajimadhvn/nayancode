import { describe, expect, it } from 'vitest';
import type { Variant } from './kernels';
import { channelIndex, CHANNELS, cosine, demoCohort, demoSignatures, extractSignatures, nnls, parseFastaMap, parseSignatureMatrix, refit, sbs96Channel, sbs96Counts } from './signatures';

const snv = (chrom: string, pos: number, ref: string, alt: string): Variant => ({ chrom, pos, id: '.', ref, alt, nAlt: 1, qual: 50, filter: 'PASS', info: {}, type: 'SNV', ti: null, dp: 30, af: null, calls: [] });
describe('SBS-96 contexts', () => {
  it('has 96 unique channels in the standard order', () => { expect(CHANNELS).toHaveLength(96); expect(new Set(CHANNELS).size).toBe(96); expect(CHANNELS[0]).toBe('A[C>A]A'); expect(CHANNELS[95]).toBe('T[T>G]T'); });
  it('pyrimidine-references purine mutations by reverse complement', () => {
    expect(sbs96Channel('A', 'C', 'T', 'G')).toBe(channelIndex.get('A[C>T]G'));
    // G>A with flanks T..A  =>  revcomp: left=comp(A)=T, ref C, alt T, right=comp(T)=A  =>  T[C>T]A
    expect(sbs96Channel('T', 'G', 'A', 'A')).toBe(channelIndex.get('T[C>T]A'));
    expect(sbs96Channel('N', 'C', 'T', 'G')).toBe(-1);
  });
  it('counts contexts from a FASTA and rejects reference mismatches', () => {
    const g = parseFastaMap('>chr1\nAACGTTACGAA\n'); // positions: 1 A,2 A,3 C,4 G,5 T,6 T,7 A,8 C,9 G,10 A,11 A
    const r = sbs96Counts([snv('1', 3, 'C', 'T'), snv('chr1', 8, 'C', 'A'), snv('1', 4, 'C', 'A') /* ref is G: mismatch */, snv('2', 3, 'C', 'T')], g);
    expect(r.used).toBe(2); expect(r.skipped).toBe(1); expect(r.missingContig).toBe(1);
    expect(r.counts[channelIndex.get('A[C>T]G')!]).toBe(1); expect(r.counts[channelIndex.get('A[C>A]G')!]).toBe(1);
  });
});
describe('NNLS', () => {
  it('recovers non-negative coefficients exactly and clamps negatives to zero', () => {
    const A = [[1, 0], [0, 1], [1, 1], [2, 1]], x = nnls(A, [1, 2, 3, 4]); expect(x[0]).toBeCloseTo(1, 8); expect(x[1]).toBeCloseTo(2, 8);
    const y = nnls([[1, 0], [0, 1]], [-3, 5]); expect(y[0]).toBe(0); expect(y[1]).toBeCloseTo(5, 8);
  });
});
import { suggestK } from './signatures';
describe('model selection', () => {
  it('finds the elbow at the planted k = 2 on the demo cohort', () => {
    const { V } = demoCohort(30, 4), curve = [1, 2, 3, 4, 5].map((k) => { const e = extractSignatures(V, k, 4); return { k, error: e.error, stability: e.stability }; });
    expect(suggestK(curve)).toBe(2);
  });
  it('handles degenerate input', () => { expect(suggestK([{ k: 1, error: 5, stability: 1 }])).toBe(1); expect(suggestK([])).toBe(1); });
});
describe('signature extraction', () => {
  const { V, truthExposure } = demoCohort(30, 4), { sigs } = demoSignatures();
  it('NMF recovers the two planted signatures (cosine > 0.95) and prefers k=2 by stability', () => {
    const e2 = extractSignatures(V, 2, 6), match = sigs.map((t) => Math.max(...e2.signatures.map((s) => cosine(s, t))));
    expect(match[0]).toBeGreaterThan(0.95); expect(match[1]).toBeGreaterThan(0.95); expect(e2.stability).toBeGreaterThan(0.95);
    const e4 = extractSignatures(V, 4, 6); expect(e4.error).toBeLessThanOrEqual(e2.error * 1.02); expect(e4.stability).toBeLessThan(e2.stability);
    // exposures proportional to truth
    const order = sigs.map((t) => e2.signatures.findIndex((s) => cosine(s, t) === Math.max(...e2.signatures.map((x) => cosine(x, t)))));
    const corr = (x: number[], y: number[]) => { const mx = x.reduce((a, b) => a + b) / x.length, my = y.reduce((a, b) => a + b) / y.length; let n = 0, dx = 0, dy = 0; x.forEach((v, i) => { n += (v - mx) * (y[i] - my); dx += (v - mx) ** 2; dy += (y[i] - my) ** 2; }); return n / Math.sqrt(dx * dy); };
    expect(corr(e2.exposures.map((r) => r[order[0]]), truthExposure.map((r) => r[0]))).toBeGreaterThan(0.95);
  });
  it('refits exposures against a reference matrix', () => {
    const r = refit(V[0], sigs); expect(r.cosine).toBeGreaterThan(0.95); expect(r.exposures[0] / (truthExposure[0][0] || 1)).toBeGreaterThan(0.8); expect(r.exposures[0] / truthExposure[0][0]).toBeLessThan(1.2);
  });
  it('parses a reference matrix and tells you what is wrong', () => {
    const tsv = 'channel\tSigX\n' + CHANNELS.map((c, i) => `${c}\t${i + 1}`).join('\n'); const m = parseSignatureMatrix(tsv); expect(m.names).toEqual(['SigX']); expect(m.sigs[0].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(() => parseSignatureMatrix('a\tb\nfoo\t1')).toThrow(/Found 0 of 96/);
  });
});
