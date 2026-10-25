/** Quality trimming (Mott and window) and mixed-peak detection. */
import type { AbifTrace } from './abif';

type Traces = AbifTrace['traces'];

/** Mott's algorithm on p = 10^(-Q/10): maximum-scoring contiguous segment, empty when none is positive. */
export function mottTrim(quality: number[], cutoff = 0.05): [number, number] {
  let best = 0, bestStart = 0, bestEnd = 0, sum = 0, start = 0;
  for (let i = 0; i < quality.length; i++) {
    sum += cutoff - 10 ** (-quality[i] / 10);
    if (sum <= 0) { sum = 0; start = i + 1; }
    else if (sum > best) { best = sum; bestStart = start; bestEnd = i + 1; }
  }
  return best > 0 ? [bestStart, bestEnd] : [0, 0];
}

export function meanQ(quality: number[]): number {
  if (!quality.length) return 0;
  return quality.reduce((a, b) => a + b, 0) / quality.length;
}

export function q20Fraction(quality: number[]): number {
  if (!quality.length) return 0;
  return quality.filter((q) => q >= 20).length / quality.length;
}

/** Trim each end until a full window has a mean quality of at least minMean. */
export function windowTrim(quality: number[], window = 10, minMean = 20): [number, number] {
  if (!quality.length) return [0, 0];
  const w = Math.min(window, quality.length);
  const means: number[] = [];
  for (let i = 0; i + w <= quality.length; i++) means.push(meanQ(quality.slice(i, i + w)));
  const first = means.findIndex((m) => m >= minMean);
  if (first < 0) return [0, 0];
  let last = first;
  for (let i = means.length - 1; i >= first; i--) if (means[i] >= minMean) { last = i; break; }
  return [first, last + w];
}

export interface MixedPeak { index: number; position: number; primary: string; secondary: string; code: string }

const IUPAC: Record<string, string> = { AG: 'R', CT: 'Y', GT: 'K', AC: 'M', CG: 'S', AT: 'W' };
const BASES = ['A', 'C', 'G', 'T'] as const;

const at = (arr: Int16Array, i: number) => (i >= 0 && i < arr.length ? arr[i] : 0);
function channelMax(traces: Traces, base: string, peak: number): number {
  const t = traces[base as keyof Traces];
  let m = 0;
  for (let i = peak - 2; i <= peak + 2; i++) m = Math.max(m, at(t, i));
  return m;
}

/** Flag positions where a second channel reaches `ratio ×` the called channel (primary > 50). */
export function secondaryPeaks(traces: Traces, peaks: number[], order = 'GATC', opts: { ratio?: number } = {}): MixedPeak[] {
  const ratio = opts.ratio ?? 0.25;
  const preference = [...new Set(order.toUpperCase().split('').filter((b) => (BASES as readonly string[]).includes(b)))];
  const out: MixedPeak[] = [];
  peaks.forEach((peak, index) => {
    const values = new Map<string, number>();
    for (const b of [...preference, ...BASES.filter((x) => !preference.includes(x))]) values.set(b, channelMax(traces, b, peak));
    const sorted = [...values.entries()].sort((a, b) => b[1] - a[1] || preference.indexOf(a[0]) - preference.indexOf(b[0]));
    const [primary, primaryValue] = sorted[0];
    const [secondary, secondValue] = sorted[1];
    if (primaryValue <= 50 || secondValue < ratio * primaryValue) return;
    const key = [primary, secondary].sort().join('');
    out.push({ index, position: index + 1, primary, secondary, code: IUPAC[key] ?? 'N' });
  });
  return out;
}
