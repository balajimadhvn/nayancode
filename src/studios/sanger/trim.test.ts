import { describe, expect, it } from 'vitest';
import { makeAbif } from './fixture';
import { parseAbif } from './abif';
import { meanQ, mottTrim, q20Fraction, secondaryPeaks, windowTrim } from './trim';

const mixedQuality = [...Array(10).fill(2), ...Array(100).fill(40), ...Array(10).fill(2)];

describe('mottTrim', () => {
  it('keeps the known high-quality segment [10, 110)', () => {
    expect(mottTrim(mixedQuality)).toEqual([10, 110]);
  });

  it('keeps everything when every base is Q40 and nothing when every base is Q2', () => {
    expect(mottTrim(Array(50).fill(40))).toEqual([0, 50]);
    expect(mottTrim(Array(50).fill(2))).toEqual([0, 0]);
  });
});

describe('windowTrim', () => {
  it('trims the same ends to within one window', () => {
    const [start, end] = windowTrim(mixedQuality, 10, 20);
    expect(Math.abs(start - 10)).toBeLessThanOrEqual(10);
    expect(Math.abs(end - 110)).toBeLessThanOrEqual(10);
  });
});

describe('quality summaries', () => {
  it('computes mean Q and the Q20 fraction', () => {
    expect(meanQ([10, 20, 30, 40])).toBe(25);
    expect(q20Fraction([10, 20, 19, 40])).toBe(0.5);
    expect(meanQ([])).toBe(0);
  });
});

describe('secondaryPeaks', () => {
  it('flags a planted 40 % A/G mixed peak as R and ignores 10 %', () => {
    const bases = 'A'.repeat(40);
    const parsed = parseAbif(makeAbif({ bases, quality: Array(40).fill(40), secondary: [
      { position: 20, base: 'G', ratio: 0.4 },
      { position: 30, base: 'G', ratio: 0.1 },
    ] }));
    const mixed = secondaryPeaks(parsed.traces, parsed.peaks, parsed.order);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]).toMatchObject({ index: 20, position: 21, primary: 'A', secondary: 'G', code: 'R' });
  });
});
