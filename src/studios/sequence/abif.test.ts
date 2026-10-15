import { describe, expect, it } from 'vitest';
import { buildAbif, compareToReference, mottTrim, parseAbif, simulateTrace } from './abif';
import { revComp } from './kernels';

const rnd = (seed: number, n: number) => { let s = seed >>> 0; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); return Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join(''); };
describe('ABIF', () => {
  const seq = rnd(3, 400), t = simulateTrace(seq, 5);
  it('round-trips through the binary format', () => {
    const back = parseAbif(buildAbif(t)); expect(back.bases).toBe(seq); expect(back.quals).toEqual(t.quals); expect(back.peaks).toEqual(t.peaks); expect(back.order).toBe('GATC'); expect(back.sample).toBe('simulated_read'); expect(back.channels).toHaveLength(4); expect(back.channels[0]).toEqual(t.channels[0]);
  });
  it('peaks sit at the right channel for each base', () => { const b = parseAbif(buildAbif(t)); let ok = 0; for (let i = 20; i < 380; i++) { const heights = b.channels.map((c) => c[b.peaks[i]]), top = heights.indexOf(Math.max(...heights)); if (b.order[top] === seq[i]) ok++; } expect(ok / 360).toBeGreaterThan(0.97); });
  it('rejects non-ABIF files clearly', () => { expect(() => parseAbif(new TextEncoder().encode('>not abif\nACGT\n'.repeat(10)).buffer)).toThrow(/Not an ABIF/); });
});
describe('quality trimming and comparison', () => {
  it('Mott trimming removes the noisy 5′ and 3′ ends', () => { const q = [...Array(15).fill(8), ...Array(300).fill(40), ...Array(40).fill(9)], { start, end } = mottTrim(q); expect(start).toBeGreaterThanOrEqual(14); expect(start).toBeLessThanOrEqual(17); expect(end).toBeLessThanOrEqual(316); expect(end).toBeGreaterThan(290); expect(mottTrim(Array(50).fill(3))).toEqual({ start: 0, end: 0 }); });
  const ref = rnd(7, 700), read = ref.slice(120, 520);
  it('finds the position and a planted substitution (forward read)', () => {
    const m = read.split(''); m[200] = m[200] === 'A' ? 'G' : 'A'; const t = simulateTrace(m.join(''), 9), c = compareToReference(t, ref);
    expect(c.strand).toBe('+'); expect(c.identity).toBeGreaterThan(0.98); const hit = c.mismatches.find((x) => x.refPos === 120 + 200 + 1); expect(hit).toBeTruthy(); expect(hit!.qual).toBeGreaterThan(30);
  });
  it('handles a reverse-strand read', () => { const t = simulateTrace(revComp(read), 11), c = compareToReference(t, ref); expect(c.strand).toBe('-'); expect(c.identity).toBeGreaterThan(0.97); expect(c.refStart).toBeGreaterThan(120); expect(c.refEnd).toBeLessThanOrEqual(520); });
});
