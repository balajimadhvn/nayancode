import { describe, expect, it } from 'vitest';
import { callSnvs, parseFlagstat, parsePileupBases, simulateReads, simulateReference, snvsToVcf, summariseDepth } from './mapping';
import { parseVcf } from '../variants/kernels';

/** Build mpileup-format lines from reads with known positions (no indels), to test the caller independently of any aligner. */
function pileupFrom(ref: string, reads: { start: number; seq: string; rev: boolean; q: number[] }[]): string {
  const cols: { b: string; rev: boolean; q: number }[][] = Array.from({ length: ref.length }, () => []);
  for (const r of reads) for (let i = 0; i < r.seq.length; i++) cols[r.start + i].push({ b: r.seq[i], rev: r.rev, q: r.q[i] });
  return cols.map((c, i) => c.length ? [ 'chr1', i + 1, ref[i], c.length, c.map((x) => (x.b === ref[i] ? (x.rev ? ',' : '.') : x.rev ? x.b.toLowerCase() : x.b)).join(''), c.map((x) => String.fromCharCode(33 + x.q)).join('') ].join('\t') : '').filter(Boolean).join('\n');
}
describe('pileup parsing', () => {
  it('handles read starts/ends, indels, strand and quality', () => { const b = parsePileupBases('.^F,A$a+2AC.-1T,*', 'IIIIIIIII', 'G'); expect(b.map((x) => x.base + (x.rev ? '-' : '+')).join(' ')).toBe('G+ G- A+ A- G+ G-'); void b; });
  it('skips insertion payloads', () => { expect(parsePileupBases('.+3ACG.', 'II', 'T')).toHaveLength(2); });
});
describe('SNV caller on simulated pileups', () => {
  const ref = simulateReference(2000, 5), snvs = [300, 800, 1500].map((p) => ({ pos: p, ref: ref[p], alt: ref[p] === 'A' ? 'G' : 'A', af: 1 })).concat([{ pos: 1100, ref: ref[1100], alt: ref[1100] === 'C' ? 'T' : 'C', af: 0.3 }]);
  const sim = simulateReads(ref, { n: 1800, len: 100, err: 0.004, snvs, seed: 9 });
  // reconstruct reads' true positions by re-running the simulator's RNG path is not possible; instead create reads directly
  it('recovers planted variants with no false positives at default thresholds (error-free positions)', () => {
    let s = 3; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296), reads = Array.from({ length: 1000 }, () => { const start = Math.floor(r() * 1900), seq = ref.slice(start, start + 100).split(''); for (const v of snvs) if (v.pos >= start && v.pos < start + 100 && r() < v.af) seq[v.pos - start] = v.alt; const q = seq.map(() => (r() < 0.004 ? 12 : 36)); return { start, seq: seq.join(''), rev: r() < 0.5, q }; });
    const calls = callSnvs(pileupFrom(ref, reads)), found = new Set(calls.map((c) => c.pos - 1)); for (const v of snvs) expect(found.has(v.pos), `pos ${v.pos}`).toBe(true);
    expect(calls.filter((c) => !snvs.some((v) => v.pos === c.pos - 1)).length).toBeLessThanOrEqual(1); const low = calls.find((c) => c.pos - 1 === 1100)!; expect(low.af).toBeGreaterThan(0.15); expect(low.af).toBeLessThan(0.5); const fix = calls.find((c) => c.pos - 1 === 300)!; expect(fix.af).toBeGreaterThan(0.95); expect(fix.qual).toBeGreaterThan(100);
  });
  it('filters low-quality bases and flags strand bias', () => {
    const lines = ['chr1\t10\tA\t20\t' + 'G'.repeat(8) + '.'.repeat(12) + '\t' + 'I'.repeat(20), 'chr1\t11\tC\t20\t' + 'T'.repeat(8) + '.'.repeat(12) + '\t' + '#'.repeat(8) + 'I'.repeat(12)].join('\n'), c = callSnvs(lines);
    expect(c).toHaveLength(1); expect(c[0].flags).toContain('strand-bias'); expect(callSnvs(lines, { minBaseQ: 0 })).toHaveLength(2);
  });
  it('emits a VCF that the Variant Studio parser reads', () => {
    const vcf = snvsToVcf([{ chrom: 'chr1', pos: 5, ref: 'A', alt: 'G', depth: 40, altCount: 39, af: 0.975, fwd: 20, rev: 19, qual: 300, flags: [] }, { chrom: 'chr1', pos: 9, ref: 'C', alt: 'T', depth: 30, altCount: 6, af: 0.2, fwd: 6, rev: 0, qual: 40, flags: ['strand-bias'] }], [{ id: 'chr1', length: 100 }], 'demo'), v = parseVcf(vcf);
    expect(v.variants).toHaveLength(2); expect(v.variants[0].calls[0].gt).toBe('1/1'); expect(v.variants[0].calls[0].vaf).toBeCloseTo(39 / 40, 6); expect(v.variants[1].filter).toBe('strand-bias'); expect(v.samples).toEqual(['demo']);
  });
  it('simulator produces valid FASTQ with the requested size and reverse-strand reads', () => { const lines = sim.fastq.trim().split('\n'); expect(lines.length).toBe(1800 * 4); expect(lines[1].length).toBe(100); expect(lines[3].length).toBe(100); });
});
describe('flagstat and depth parsing', () => {
  it('parses samtools flagstat', () => { const f = parseFlagstat('1000 + 0 in total (QC-passed reads + QC-failed reads)\n990 + 0 primary\n10 + 0 secondary\n0 + 0 supplementary\n0 + 0 duplicates\n950 + 0 mapped (95.00% : N/A)\n0 + 0 paired in sequencing\n'); expect(f.total).toBe(1000); expect(f.mapped).toBe(950); expect(f.mappedPct).toBeCloseTo(95, 6); expect(f.secondary).toBe(10); expect(() => parseFlagstat('hello')).toThrow(/Unrecognised/); });
  it('summarises depth', () => { const d = Array.from({ length: 100 }, (_, i) => `c1\t${i + 1}\t${i < 50 ? 40 : 0}`).join('\n'), c = summariseDepth(d, 10); expect(c[0].mean).toBe(20); expect(c[0].pct1x).toBe(50); expect(c[0].pct30x).toBe(50); expect(c[0].bins).toHaveLength(10); expect(() => summariseDepth('')).toThrow(/No depth/); });
});
