import { describe, expect, it } from 'vitest';
import { dedupExact, demultiplex, parseBarcodes, reservoirSample, type Barcode } from './tools';
import { mulberry32 } from './tools';
import type { FastqRecord } from './fastq';

const read = (id: string, seq: string): FastqRecord => ({ id, desc: '', seq, qual: 'I'.repeat(seq.length) });
const randSeq = (n: number, r: () => number) => Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join('');

describe('dedupExact', () => {
  it('keeps 900 unique reads from 1,000 with 100 planted duplicates, in first-occurrence order', () => {
    const r = mulberry32(42), rows: FastqRecord[] = [];
    for (let i = 0; i < 900; i++) rows.push(read(`u${i}`, randSeq(20, r)));
    for (let i = 0; i < 100; i++) rows.push({ ...rows[i * 3], id: `dup${i}` });
    const out = dedupExact(rows);
    expect(out).toHaveLength(900);
    expect(out.slice(0, 4).map((x) => x.id)).toEqual(['u0', 'u1', 'u2', 'u3']);
    expect(out.some((x) => x.id.startsWith('dup'))).toBe(false);
  });

  it('deduplicates pairs by both sequences', () => {
    const rows = [
      { seq: 'AAA', seq2: 'CCC' }, { seq: 'AAA', seq2: 'GGG' }, { seq: 'AAA', seq2: 'CCC' },
    ];
    expect(dedupExact(rows)).toHaveLength(2);
  });
});

describe('reservoirSample', () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => read(`r${i}`, 'ACGT'));

  it('returns exactly n distinct reads, reproducibly for a seed', async () => {
    const a = await reservoirSample(rows, 100, 1), b = await reservoirSample(rows, 100, 1), c = await reservoirSample(rows, 100, 2);
    expect(a).toHaveLength(100);
    expect(new Set(a.map((x) => x.id)).size).toBe(100);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a.map((x) => x.id)).not.toEqual(c.map((x) => x.id));
  });

  it('includes each read with probability 1% (within 5 sigma over 2,000 seeds)', async () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 2000; seed++) {
      const s = await reservoirSample(rows, 100, seed);
      for (const x of s) counts.set(x.id, (counts.get(x.id) ?? 0) + 1);
    }
    const expected = 20, sigma = Math.sqrt(2000 * 0.01 * 0.99);
    const freqs = [...counts.values()];
    expect(freqs).toHaveLength(10_000);
    expect(Math.min(...freqs)).toBeGreaterThanOrEqual(expected - 5 * sigma);
    expect(Math.max(...freqs)).toBeLessThanOrEqual(expected + 5 * sigma);
  });
});

describe('demultiplex', () => {
  const barcodes: Barcode[] = [
    { sample: 'A', seq: 'AAAAAAAA' }, { sample: 'B', seq: 'CCCCCCCC' },
    { sample: 'C', seq: 'GGGGGGGG' }, { sample: 'D', seq: 'TTTTTTTT' },
  ];
  const r = mulberry32(7), rows: FastqRecord[] = [];
  const mutate = (s: string) => { const i = Math.floor(r() * s.length); const alt = 'ACGT'[(('ACGT'.indexOf(s[i]) + 1 + Math.floor(r() * 3)) % 4)]; return s.slice(0, i) + alt + s.slice(i + 1); };
  for (const b of barcodes) {
    for (let i = 0; i < 1000; i++) {
      const bc = i % 2 === 0 ? b.seq : mutate(b.seq);
      rows.push(read(`${b.sample}${i}`, bc + randSeq(20, r)));
    }
  }
  for (let i = 0; i < 50; i++) rows.push(read(`n${i}`, randSeq(28, r)));

  it('assigns all 1,000 reads per barcode and leaves the 50 random reads unassigned', () => {
    const out = demultiplex(rows, barcodes, { maxMismatch: 1 });
    expect(out.counts).toEqual({ A: 1000, B: 1000, C: 1000, D: 1000 });
    expect(out.ambiguous).toHaveLength(0);
    expect(out.unassigned).toHaveLength(50);
    expect(out.samples.get('A')![0].seq).toHaveLength(20); // barcode stripped
  });

  it('leaves a read with two substitutions unassigned at maxMismatch 1', () => {
    const bad = read('x', 'AACAAAAC' + 'ACGTACGT'); // two substitutions in barcode A
    const out = demultiplex([bad], barcodes, { maxMismatch: 1 });
    expect(out.unassigned).toHaveLength(1);
  });

  it('rejects barcode sets that are too close', () => {
    const close = [{ sample: 'A', seq: 'AAAAAAAA' }, { sample: 'B', seq: 'AAAAAAAC' }];
    expect(() => demultiplex([], close, { maxMismatch: 1 })).toThrow(/differ by only 1 bases/);
  });

  it('strips a barcode from the 3 prime end', () => {
    const out = demultiplex([read('e', 'ACGTACGT' + 'CCCCCCCC')], barcodes, { where: 'end' });
    expect(out.counts.B).toBe(1);
    expect(out.samples.get('B')![0].seq).toBe('ACGTACGT');
  });

  it('parses sample,barcode tables', () => {
    expect(parseBarcodes('sample,barcode\nA,ACGT\nB\tTGCA\n')).toEqual([{ sample: 'A', seq: 'ACGT' }, { sample: 'B', seq: 'TGCA' }]);
  });
});
