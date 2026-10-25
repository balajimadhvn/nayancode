import { describe, expect, it } from 'vitest';
import { arcsinh, compensate, inverseArcsinh, inverseLog10, invert, log10Clip } from './transform';

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('transforms', () => {
  it('matches the arcsinh definition and round trips', () => {
    expect(arcsinh(0)).toBe(0);
    expect(arcsinh(150, 150)).toBeCloseTo(0.881373587019543, 12);
    for (const x of [0, 1, 100, 10_000]) expect(inverseArcsinh(arcsinh(x, 150), 150)).toBeCloseTo(x, 9);
  });

  it('clips log10 at the floor and inverts', () => {
    expect(log10Clip(100)).toBe(2);
    expect(log10Clip(-5)).toBe(0);
    expect(inverseLog10(2)).toBe(100);
  });
});

describe('invert', () => {
  it('matches the numpy inverse of the 2 x 2 spillover matrix', () => {
    const inv = invert([[1, 0.15], [0.05, 1]]);
    expect(inv[0][0]).toBeCloseTo(1.0075566750629723, 12);
    expect(inv[0][1]).toBeCloseTo(-0.15113350125944583, 12);
    expect(inv[1][0]).toBeCloseTo(-0.05037783375314862, 12);
    expect(inv[1][1]).toBeCloseTo(1.0075566750629723, 12);
  });

  it('throws for a singular matrix', () => {
    expect(() => invert([[1, 2], [2, 4]])).toThrow(/singular/);
    expect(() => invert([[1, 2, 3]])).toThrow(/square/);
  });
});

describe('compensate', () => {
  it('recovers seeded true values from observed = true x S', () => {
    const rnd = seeded(7);
    const n = 1000;
    const t0 = Float64Array.from({ length: n }, () => rnd() * 10_000);
    const t1 = Float64Array.from({ length: n }, () => rnd() * 5_000);
    const o0 = Float64Array.from({ length: n }, (_, i) => t0[i] + 0.05 * t1[i]);
    const o1 = Float64Array.from({ length: n }, (_, i) => 0.15 * t0[i] + t1[i]);
    const [r0, r1] = compensate([o0, o1], [[1, 0.15], [0.05, 1]]);
    for (let i = 0; i < n; i++) { expect(r0[i]).toBeCloseTo(t0[i], 9); expect(r1[i]).toBeCloseTo(t1[i], 9); }
  });

  it('explains a size mismatch', () => {
    expect(() => compensate([new Float64Array(3)], [[1, 0.1], [0.1, 1]])).toThrow(/2 channels/);
  });
});
