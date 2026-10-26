import { describe, expect, it } from 'vitest';
import { fivePrime, isUnmapped, parseCigar, parseSamLine, passesFilter, refSpans, strandOf, templateMidpoint } from './sam';

const line = (flag: number, pos = 100, cigar = '10M', mapq = 60, rname = 'chr1', tlen = 0, qname = 'r1') =>
  [qname, flag, rname, pos, mapq, cigar, '*', 0, tlen, 'ACGTACGTAC', 'IIIIIIIIII'].join('\t');

describe('CIGAR and reference blocks', () => {
  it('splits aligned blocks at a 200 bp splice junction', () => {
    expect(refSpans(100, '30M200N20M')).toEqual([[100, 129], [330, 349]]);
  });

  it('keeps insertion-only and soft-clipped blocks separate and lets a deletion consume one base', () => {
    expect(refSpans(100, '5S10M2I8M1D5M')).toEqual([[100, 109], [110, 117], [119, 123]]);
  });

  it('treats = and X as reference-consuming aligned blocks', () => {
    expect(refSpans(100, '3=2X4M')).toEqual([[100, 102], [103, 104], [105, 108]]);
  });

  it('rejects a malformed CIGAR instead of guessing', () => {
    expect(() => parseCigar('10M5')).toThrow(/Invalid CIGAR/);
  });
});

describe('SAM records and filters', () => {
  it('parses the mandatory fields and strand', () => {
    const r = parseSamLine(line(16, 100, '5S10M'));
    expect(r).toMatchObject({ qname: 'r1', flag: 16, rname: 'chr1', pos: 100, mapq: 60, cigar: '5S10M', tlen: 0 });
    expect(strandOf(r.flag)).toBe('-');
    expect(strandOf(0)).toBe('+');
    expect(fivePrime(r)).toBe(109);
    expect(fivePrime(parseSamLine(line(0)))).toBe(100);
  });

  it('skips unmapped, secondary, supplementary and QC-fail records', () => {
    expect(passesFilter(parseSamLine(line(0)))).toBe(true);
    for (const f of [4, 256, 2048, 512]) expect(passesFilter(parseSamLine(line(f)))).toBe(false);
    expect(passesFilter(parseSamLine(line(1024)))).toBe(true);
    expect(passesFilter(parseSamLine(line(1024)), { skipDuplicates: true })).toBe(false);
  });

  it('counts read 1 only for paired reads', () => {
    expect(passesFilter(parseSamLine(line(1 | 64 | 2)))).toBe(true);
    expect(passesFilter(parseSamLine(line(1 | 128 | 2)))).toBe(false);
    expect(passesFilter(parseSamLine(line(1 | 128 | 2)), { pairedRead1Only: false })).toBe(true);
    expect(passesFilter(parseSamLine(line(0)))).toBe(true);
  });

  it('detects unmapped records and computes the template midpoint', () => {
    expect(isUnmapped(parseSamLine(line(4, 0, '*')))).toBe(true);
    expect(isUnmapped(parseSamLine(line(0)))).toBe(false);
    expect(templateMidpoint(parseSamLine(line(1 | 64, 100, '100M', 60, 'chr1', 200)))).toBe(200);
    expect(templateMidpoint(parseSamLine(line(0, 100, '100M', 60, 'chr1', 0)))).toBeNull();
  });
});
