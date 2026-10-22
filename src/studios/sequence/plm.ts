/** Pure math functions for ESM-2 protein language model.
 *
 * These functions take a logits provider so they can be tested without the model.
 * When the model is loaded, the same functions can operate on the model's logits.
 */

/** Log-softmax of a row (returns log probabilities that sum to 1 in prob space). */
export function logSoftmax(row: Float32Array): Float32Array {
  const max = Math.max(...row);
  const sum = row.reduce((acc, v) => acc + Math.exp(v - max), 0);
  return row.map((v) => v - max - Math.log(sum));
}

/** maskedMarginal(wt, mut, logitsAtMasked, vocab).
 *  Returns log p(mut) - log p(wt) at the masked position.
 *  Positive means the mutant is favoured over the wild type.
 */
export function maskedMarginal(
  wt: string,
  mut: string,
  logitsAtMasked: Float32Array,
  vocab: Record<string, number>,
): number {
  const logwt = logitsAtMasked[vocab[wt] ?? -1] ?? -Infinity;
  const logmut = logitsAtMasked[vocab[mut] ?? -1] ?? -Infinity;
  if (logwt === -Infinity || logmut === -Infinity) return NaN;
  return logmut - logwt;
}

/** pseudoPerplexity(logProbsOfTruth).
 *  exp(−mean(logProbs)): a measure of how surprising the truth is under the model.
 */
export function pseudoPerplexity(logProbsOfTruth: number[]): number {
  if (!logProbsOfTruth.length) return 1;
  const mean = logProbsOfTruth.reduce((a, b) => a + b, 0) / logProbsOfTruth.length;
  return Math.exp(-mean);
}

/** meanPool(hidden, mask).
 *  If mask is provided, only average the hidden states at masked positions.
 *  Otherwise average all positions.
 */
export function meanPool(hidden: Float32Array[], mask?: boolean[]): Float32Array | undefined {
  if (!hidden.length) return undefined;
  const n = hidden[0].length;
  if (mask) {
    const active = mask.filter((m) => m).length;
    if (!active) return new Float32Array(n);
    const sum = new Float32Array(n);
    for (let i = 0; i < hidden.length; i++) {
      if (!mask[i]) continue;
      for (let j = 0; j < n; j++) sum[j] += hidden[i][j];
    }
    return sum.map((s) => s / active);
  } else {
    const sum = new Float32Array(n);
    for (const h of hidden) for (let j = 0; j < n; j++) sum[j] += h[j];
    return sum.map((s) => s / hidden.length);
  }
}

/** parseMutation('A123G', seq) → validates the wild-type residue matches seq[pos]; throws a clear error otherwise. */
export function parseMutation(mutation: string, seq: string): { pos: number; wt: string; mut: string } {
  const m = mutation.match(/^([A-Z])(\d+)([A-Z])$/);
  if (!m) throw new Error(`Invalid mutation format: "${mutation}". Expected format: ResidueNumberResidue, e.g. "A123G".`);
  const [, wt, numStr, mut] = m;
  const pos = Number(numStr) - 1; // 1-indexed to 0-indexed
  if (pos < 0 || pos >= seq.length) throw new Error(`Position ${pos + 1} is out of range for sequence of length ${seq.length}.`);
  if (seq[pos] !== wt) throw new Error(`Wild-type mismatch: position ${pos + 1} expects "${wt}" but sequence has "${seq[pos]}".`);
  return { pos, wt, mut };
}