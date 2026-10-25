import { describe, expect, it } from 'vitest';
import { revComp } from '@/studios/sequence/kernels';
import { compareToReference } from './compare';

function seededDna(n: number, seed: number): string {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('');
}

describe('compareToReference', () => {
  const ref = seededDna(500, 424242);
  const original = ref.slice(100, 400);
  const alt = original[149] === 'A' ? 'C' : 'A';
  const read = `${original.slice(0, 149)}${alt}${original.slice(150)}`;
  const quality = Array(300).fill(40);

  it('finds the plus-strand substitution at reference position 250', () => {
    const r = compareToReference(read, ref, { quality });
    expect(r.orientation).toBe('+');
    expect(Math.abs(r.identity - 299 / 300)).toBeLessThan(1 / 300);
    expect(r.refStart).toBe(101);
    expect(r.refEnd).toBe(400);
    expect(r.differences).toHaveLength(1);
    expect(r.differences[0]).toMatchObject({ refPos: 250, ref: original[149], read: alt, type: 'sub', quality: 40 });
  });

  it('finds the same difference when the read is reverse-complemented', () => {
    const r = compareToReference(revComp(read), ref, { quality });
    expect(r.orientation).toBe('-');
    expect(Math.abs(r.identity - 299 / 300)).toBeLessThan(1 / 300);
    expect(r.differences).toHaveLength(1);
    expect(r.differences[0]).toMatchObject({ refPos: 250, ref: original[149], type: 'sub' });
  });

  it('honours a trimmed range', () => {
    const r = compareToReference(read, ref, { trimmed: [0, 300] });
    expect(r.refStart).toBe(101);
    expect(r.differences).toHaveLength(1);
  });
});
