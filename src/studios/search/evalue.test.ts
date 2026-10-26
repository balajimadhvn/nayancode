import { describe, expect, it } from 'vitest';
import { bitScore, eValue, K, LAMBDA } from './evalue';

describe('Karlin-Altschul E-values (gapped BLOSUM62 11/1)', () => {
  it('reproduces the hand calculation for S = 100, m = 300, n = 1e7', () => {
    // Python: (0.267*100 - ln(0.041)) / ln 2 = 43.12818987177933
    // (the item's "43.4..." is a rounding slip; 43.1282 is the exact value)
    const expected = (0.267 * 100 - Math.log(0.041)) / Math.LN2;
    expect(expected).toBeCloseTo(43.12818987177933, 9);
    expect(bitScore(100)).toBeCloseTo(expected, 12);
    expect(eValue(100, 300, 1e7)).toBeCloseTo(300 * 1e7 * 2 ** -expected, 10);
    expect(eValue(100, 300, 1e7)).toBeCloseTo(3.120631188330765e-4, 12);
  });

  it('uses the published parameters and decreases monotonically with score', () => {
    expect(LAMBDA).toBe(0.267);
    expect(K).toBe(0.041);
    expect(eValue(80, 100, 1000)).toBeGreaterThan(eValue(100, 100, 1000));
    expect(eValue(100, 200, 1000)).toBeCloseTo(2 * eValue(100, 100, 1000), 12);
  });
});
