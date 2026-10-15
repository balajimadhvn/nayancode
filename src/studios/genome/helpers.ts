export const distanceMatrixFromAni = (ani: number[][]) => ani.map((r) => r.map((v) => 1 - v));
/** Collapse a count array into at most `bins` bars. */
export function rebin(counts: number[], bins: number, labelOf: (i: number) => string): { labels: string[]; values: number[] } {
  if (counts.length <= bins) return { labels: counts.map((_, i) => labelOf(i)), values: counts };
  const step = Math.ceil(counts.length / bins), labels: string[] = [], values: number[] = [];
  for (let i = 0; i < counts.length; i += step) { labels.push(labelOf(i)); values.push(counts.slice(i, i + step).reduce((a, b) => a + b, 0)); }
  return { labels, values };
}
