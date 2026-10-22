import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFastaPlasmid, parseGenBank, parseLocation, toGenBank } from './genbank';

const GB = readFileSync(new URL('./fixtures/puc19.gb', import.meta.url), 'utf8');

describe('parseGenBank', () => {
  it('reads pUC19: 2,686 bp, circular, and the documented first bases', () => {
    const p = parseGenBank(GB);
    expect(p.seq).toHaveLength(2686);
    expect(p.topology).toBe('circular');
    expect(p.seq.startsWith('TCGCGCGTTTCGGTGATGACGG')).toBe(true);
    expect(p.name).toBe('SYNPUC19CV');
    expect(p.features.length).toBeGreaterThan(0);
    expect(p.features[0].type).toBe('source');
    expect(p.features[0].start).toBe(1);
    expect(p.features[0].end).toBe(2686);
  });

  it('parses complement, join and partial locations to their outer span', () => {
    expect(parseLocation('complement(1626..2486)')).toEqual({ start: 1626, end: 2486, strand: -1 });
    expect(parseLocation('join(1..10,20..30)')).toEqual({ start: 1, end: 30, strand: 1 });
    expect(parseLocation('complement(join(1..10,20..30))')).toEqual({ start: 1, end: 30, strand: -1 });
    expect(parseLocation('<1..>50')).toEqual({ start: 1, end: 50, strand: 1 });
    expect(parseLocation('123')).toEqual({ start: 123, end: 123, strand: 1 });
  });

  it('handles multi-line qualifiers', () => {
    const text = [
      'LOCUS       test                    100 bp    DNA     circular SYN 01-JAN-2020',
      'FEATURES             Location/Qualifiers',
      '     CDS             complement(join(1..10,20..30))',
      '                     /gene="abc"',
      '                     /note="first line',
      '                     second line"',
      'ORIGIN',
      '        1 acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt',
      '       61 acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt',
      '//',
    ].join('\n');
    const p = parseGenBank(text);
    const f = p.features[0];
    expect(f.start).toBe(1);
    expect(f.end).toBe(30);
    expect(f.strand).toBe(-1);
    expect(f.label).toBe('abc');
    expect(f.qualifiers.note).toContain('first line');
    expect(f.qualifiers.note).toContain('second line');
    expect(p.seq).toHaveLength(100);
  });

  it('round-trips through toGenBank (sequence and features)', () => {
    const p = parseGenBank(GB);
    p.features.push({ type: 'CDS', start: 100, end: 200, strand: -1, label: 'AmpR test', qualifiers: { note: 'round trip' } });
    const again = parseGenBank(toGenBank(p));
    expect(again.seq).toBe(p.seq);
    expect(again.topology).toBe('circular');
    const f = again.features.find((x) => x.label === 'AmpR test')!;
    expect(f).toBeDefined();
    expect([f.start, f.end, f.strand]).toEqual([100, 200, -1]);
    expect(f.qualifiers.note).toBe('round trip');
  });

  it('rejects a file without ORIGIN', () => {
    expect(() => parseGenBank('LOCUS x 10 bp DNA\n//')).toThrow(/ORIGIN/);
  });
});

describe('parseFastaPlasmid', () => {
  it('reads a FASTA plasmid as circular when the header says so', () => {
    const p = parseFastaPlasmid('>pTEST circular vector\nACGT\nACGT\n');
    expect(p.name).toBe('pTEST');
    expect(p.seq).toBe('ACGTACGT');
    expect(p.topology).toBe('circular');
    expect(parseFastaPlasmid('>frag linear\nACGT').topology).toBe('linear');
  });

  it('rejects non-nucleotide content', () => {
    expect(() => parseFastaPlasmid('>x\nACGTZZ')).toThrow(/non-nucleotide/);
  });
});
