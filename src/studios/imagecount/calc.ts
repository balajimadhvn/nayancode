/** Colony-count calculations and object-size summaries. */

export function cfuPerMl(count: number, dilutionFactor: number, platedMl: number): number {
  if (!(platedMl > 0)) throw new Error('The plated volume must be greater than zero.');
  return (count * dilutionFactor) / platedMl;
}

export function areaMm2(pixels: number, pxPerMm: number): number {
  if (!(pxPerMm > 0)) throw new Error('Pixels per mm must be greater than zero.');
  return pixels / (pxPerMm * pxPerMm);
}

export interface SizeSummary { n: number; mean: number; median: number; sd: number; min: number; max: number }

export function summary(sizes: number[]): SizeSummary {
  if (!sizes.length) return { n: 0, mean: 0, median: 0, sd: 0, min: 0, max: 0 };
  const sorted = [...sizes].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const variance = n > 1 ? sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, median, sd: Math.sqrt(variance), min: sorted[0], max: sorted[n - 1] };
}

/** Counts below 25 or above 250 are outside the usual countable range for a pour/spread plate. */
export function countableRangeFlag(count: number): string | null {
  if (count < 25) return 'outside the usual countable range (25–250 colonies): the count is low and sampling error is large';
  if (count > 250) return 'outside the usual countable range (25–250 colonies): colonies may be crowded and merged';
  return null;
}
