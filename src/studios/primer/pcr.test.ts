import { describe, expect, it } from 'vitest';
import { revComp } from '@/studios/sequence/kernels';
import { inSilicoPcr, parsePrimers } from './pcr';

const mulberry32 = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const randomSeq = (n: number, seed: number) => { const r = mulberry32(seed); return Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join(''); };
const mutate = (s: string, at: number[]) => [...s].map((c, i) => (at.includes(i + 1) ? 'ACGT'[('ACGT'.indexOf(c) + 1) % 4] : c)).join('');

describe('in-silico PCR', () => {
  const T = randomSeq(2000, 4242);
  const F = T.slice(300, 320), R = revComp(T.slice(800, 820));
  const templates = [{ name: 't1', seq: T }], primers = [{ name: 'F', seq: F }, { name: 'R', seq: R }];

  it('finds the planted 520-bp product with the right coordinates and sequence', () => {
    const { products, single } = inSilicoPcr(templates, primers);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ template: 't1', f: 'F', r: 'R', start: 301, end: 820, size: 520, mismatches: 0 });
    expect(products[0].sequence).toBe(T.slice(300, 820));
    expect(single).toHaveLength(0);
  });

  it('keeps an internal mismatch but not a 3′-terminal one', () => {
    const inside = mutate(F, [5]);
    let r = inSilicoPcr(templates, [{ name: 'F', seq: inside }, { name: 'R', seq: R }]);
    expect(r.products).toHaveLength(1);
    expect(r.products[0].mismatches).toBe(1);
    r = inSilicoPcr(templates, [{ name: 'F', seq: inside }, { name: 'R', seq: R }], { maxMm: 0 });
    expect(r.products).toHaveLength(0);
    const last = mutate(F, [20]);
    expect(inSilicoPcr(templates, [{ name: 'F', seq: last }, { name: 'R', seq: R }]).products).toHaveLength(0);
  });

  it('labels products from two templates', () => {
    const r = inSilicoPcr([{ name: 'one', seq: T }, { name: 'two', seq: T }], primers);
    expect(r.products.map((p) => p.template)).toEqual(['one', 'two']);
    expect(r.products.every((p) => p.size === 520)).toBe(true);
  });

  it('reports orphan sites and parses primer lines', () => {
    const r = inSilicoPcr(templates, [{ name: 'F', seq: F }]);
    expect(r.products).toHaveLength(0);
    expect(r.single).toHaveLength(1);
    expect(r.single[0]).toMatchObject({ primer: 'F', start: 301, end: 320, strand: '+', mismatches: 0 });
    expect(parsePrimers('F ACGTACGT\n>R\nTTTTGGGG')).toEqual([{ name: 'F', seq: 'ACGTACGT' }, { name: 'R', seq: 'TTTTGGGG' }]);
  });
});
