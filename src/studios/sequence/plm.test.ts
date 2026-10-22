import { describe, expect, it } from 'vitest';
import { logSoftmax, maskedMarginal, pseudoPerplexity, meanPool, parseMutation } from './plm';

describe('logSoftmax', () => {
  it('returns log-probs that sum to 1 in prob space', () => {
    const row = new Float32Array([1, 2, 3, 4]);
    const lse = logSoftmax(row);
    const probs = lse.map((v) => Math.exp(v));
    const total = probs.reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-7);
  });
  it('is identity when one entry dominates', () => {
    const row = new Float32Array([100, 0, 0, 0]);
    const lse = logSoftmax(row);
    expect(lse[0]).toBeCloseTo(0, 3);
    expect(lse[1]).toBeCloseTo(-100, 3);
    expect(lse[2]).toBeCloseTo(-100, 3);
    expect(lse[3]).toBeCloseTo(-100, 3);
  });
});

describe('maskedMarginal', () => {
  // The function takes raw logits (not softmax-probs) and returns logit(mut) - logit(wt).
  const logits = new Float32Array([0.1, 0.2, 0.7]); // A=0, C=1, G=2, T=3 not used
  const vocab = { A: 0, C: 1, G: 2, T: 3 };
  it('positive when mutant is favoured in raw logits', () => {
    // wild type is A (logit 0.1), mutant is G (logit 0.7)
    const result = maskedMarginal('A', 'G', logits, vocab);
    // raw difference: 0.7 - 0.1 = 0.6
    expect(result).toBeCloseTo(0.7 - 0.1, 5);
  });
  it('negative when wild type is favoured in raw logits', () => {
    const result = maskedMarginal('G', 'A', logits, vocab);
    expect(result).toBeCloseTo(0.1 - 0.7, 5);
  });
  it('returns NaN for unknown residues', () => {
    expect(maskedMarginal('X', 'G', logits, vocab)).toBeNaN();
  });
});

describe('pseudoPerplexity', () => {
  it('returns 1 for empty array', () => {
    expect(pseudoPerplexity([])).toBe(1);
  });
  it('returns exp(−mean) for non-empty', () => {
    // logProbs all 0 → mean 0 → perplexity exp(−0) = 1
    expect(pseudoPerplexity([0, 0, 0])).toBeCloseTo(1, 5);
    // logProbs [−ln(0.5), −ln(0.5)] ≈ [0.693, 0.693] → mean ≈ 0.693 → perplexity ≈ exp(−0.693) ≈ 0.5
    expect(pseudoPerplexity([Math.log(2), Math.log(2)])).toBeCloseTo(0.5, 5); // ln(2) ≈ 0.693
  });
});

describe('meanPool', () => {
  it('averages all positions when no mask', () => {
    const hidden = [
      new Float32Array([1, 2, 3]),
      new Float32Array([3, 2, 1]),
    ];
    const result = meanPool(hidden);
    expect(result?.[0]).toBeCloseTo(2, 3);
    expect(result?.[1]).toBeCloseTo(2, 3);
    expect(result?.[2]).toBeCloseTo(2, 3);
  });
  it('averages only masked positions', () => {
    const hidden = [
      new Float32Array([1, 2, 3]),
      new Float32Array([3, 2, 1]),
      new Float32Array([5, 5, 5]),
    ];
    const result = meanPool(hidden, [true, false, true]);
    // active=2, sum of masked positions (0 and 2): [1+5, 2+5, 3+5] = [6, 7, 8], /2 = [3, 3.5, 4]
    expect(result?.[0]).toBeCloseTo(3, 3);
    expect(result?.[1]).toBeCloseTo(3.5, 3);
    expect(result?.[2]).toBeCloseTo(4, 3);
  });
  it('handles single element', () => {
    const hidden = [new Float32Array([10, 20, 30])];
    const result = meanPool(hidden);
    expect(result?.[0]).toBeCloseTo(10, 3);
    expect(result?.[1]).toBeCloseTo(20, 3);
    expect(result?.[2]).toBeCloseTo(30, 3);
  });
});

describe('parseMutation', () => {
  it('parses valid mutation', () => {
    const seq = 'ACDEFGHIKLMNPQRSTVWY';
    const { pos, wt, mut } = parseMutation('A1G', seq);
    expect(pos).toBe(0);
    expect(wt).toBe('A');
    expect(mut).toBe('G');
  });
  it('throws when wild-type does not match', () => {
    const seq = 'ACDE';
    // Position 1 (1-indexed) expects 'C' but sequence has 'A'
    expect(() => parseMutation('C1G', seq)).toThrow(`Wild-type mismatch`);
  });
  it('rejects out-of-range position', () => {
    const seq = 'ACDE';
    expect(() => parseMutation('A100G', seq)).toThrow(`out of range`);
  });
  it('rejects invalid format', () => {
    expect(() => parseMutation('XYZ', 'ACDE')).toThrow(`Invalid mutation format`);
  });
});