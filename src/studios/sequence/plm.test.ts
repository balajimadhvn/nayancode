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
import { AMINO_ACIDS, effectFromScan, positionConstraint, scanProfile } from './plm';
describe('full-sequence scan (mock logits)', () => {
  const vocab = Object.fromEntries([...AMINO_ACIDS].map((a, i) => [a, i + 4]));
  // a mock "model" that always strongly prefers glycine and mildly prefers the true residue at each position
  const seq = 'ACGTG';
  const mock = (pos: number) => { const row = new Float32Array(40).fill(-5); row[vocab.G] = 3; row[vocab[seq[pos]]] = Math.max(row[vocab[seq[pos]]], 1); return row; };
  it('returns one normalised row per position and a pseudo-perplexity above 1', async () => {
    const s = await scanProfile(seq, mock, vocab);
    expect(s.logP).toHaveLength(5); for (const r of s.logP) expect(r.reduce((a, v) => a + Math.exp(v), 0)).toBeLessThanOrEqual(1 + 1e-6);
    expect(s.pseudoPerplexity).toBeGreaterThan(1);
  });
  it('scores substitutions to the preferred residue as favourable', async () => {
    const s = await scanProfile(seq, mock, vocab);
    expect(effectFromScan(s, seq, 0, 'G')).toBeGreaterThan(0); expect(effectFromScan(s, seq, 2, 'A')).toBeLessThan(0); // position 3 is already G
    expect(effectFromScan(s, seq, 0, 'A')).toBeCloseTo(0, 10);
  });
  it('positions where the wild type is strongly preferred are more constrained', async () => {
    const strong = (pos: number) => { const r = new Float32Array(40).fill(0); r[vocab[seq[pos]]] = pos === 1 ? 10 : 0; return r; };
    const s = await scanProfile(seq, strong, vocab), c = positionConstraint(s, seq); expect(c[1]).toBeLessThan(c[0]); expect(c[1]).toBeLessThan(c[3]);
  });
  it('reports progress', async () => { const seen: number[] = []; await scanProfile(seq, mock, vocab, (f) => seen.push(f)); expect(seen.at(-1)).toBe(1); expect(seen).toHaveLength(5); });
});

// Real model (needs network + ~30 MB download): RUN_PLM_NETWORK_TEST=1 npx vitest run src/studios/sequence/plm.test.ts
describe.skipIf(!process.env.RUN_PLM_NETWORK_TEST)('real ESM-2 8M model (network)', () => {
  it('prefers a conservative substitution (L8I) over a charged one (L8D) in ubiquitin', async () => {
    const { AutoTokenizer, AutoModelForMaskedLM } = await import('@huggingface/transformers');
    const id = 'Xenova/esm2_t6_8M_UR50D', tok = await AutoTokenizer.from_pretrained(id), model = await AutoModelForMaskedLM.from_pretrained(id, { dtype: 'q8' });
    const seq = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG', enc = tok(seq), ids = Array.from(enc.input_ids.data as unknown as BigInt64Array, Number);
    const vocab = Object.fromEntries([...AMINO_ACIDS].map((a) => [a, tok.convert_tokens_to_ids(a) as number])), mask = tok.convert_tokens_to_ids('<mask>') as number;
    const T = enc.input_ids.constructor as new (t: string, d: BigInt64Array, s: number[]) => never;
    const s = await scanProfile(seq.slice(0, 20), async (pos) => { const m = ids.slice(); m[pos + 1] = mask; const out = await model({ input_ids: new T('int64', BigInt64Array.from(m.map(BigInt)), [1, m.length]), attention_mask: new T('int64', BigInt64Array.from(m.map(() => 1n)), [1, m.length]) }) as { logits: { data: Float32Array; dims: number[] } }; const V = out.logits.dims[2]; return Float32Array.from(out.logits.data.slice((pos + 1) * V, (pos + 2) * V)); }, vocab);
    expect(effectFromScan(s, seq, 7, 'I')).toBeGreaterThan(effectFromScan(s, seq, 7, 'D'));
  }, 180_000);
});
