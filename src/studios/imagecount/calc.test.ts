import { describe, expect, it } from 'vitest';
import { areaMm2, cfuPerMl, countableRangeFlag, summary } from './calc';

describe('cfuPerMl', () => {
  it('scales the count by the dilution and the plated volume', () => {
    expect(cfuPerMl(87, 10000, 0.1)).toBeCloseTo(8_700_000, 6);
    expect(cfuPerMl(30, 1000, 0.1)).toBeCloseTo(300_000, 6);
    expect(() => cfuPerMl(10, 100, 0)).toThrow(/plated volume/);
  });
});

describe('areaMm2', () => {
  it('divides pixels by the square of the scale', () => {
    expect(areaMm2(400, 20)).toBeCloseTo(1, 12);
    expect(areaMm2(100, 10)).toBeCloseTo(1, 12);
    expect(() => areaMm2(100, 0)).toThrow(/Pixels per mm/);
  });
});

describe('summary', () => {
  it('reports n, mean, median, sample sd and range', () => {
    const s = summary([1, 2, 3, 4]);
    expect(s).toMatchObject({ n: 4, mean: 2.5, median: 2.5, min: 1, max: 4 });
    expect(s.sd).toBeCloseTo(1.2909944487358056, 9);
    expect(summary([7]).sd).toBe(0);
    expect(summary([])).toEqual({ n: 0, mean: 0, median: 0, sd: 0, min: 0, max: 0 });
  });
});

describe('countableRangeFlag', () => {
  it('flags counts outside 25-250', () => {
    expect(countableRangeFlag(24)).toMatch(/low/);
    expect(countableRangeFlag(25)).toBeNull();
    expect(countableRangeFlag(250)).toBeNull();
    expect(countableRangeFlag(251)).toMatch(/crowded/);
  });
});
