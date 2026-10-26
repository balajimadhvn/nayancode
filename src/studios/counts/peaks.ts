/** MACS-style peak calling: cross-correlation fragment size, local Poisson lambda, BH FDR and narrowPeak output. */
import { bh } from '@/studios/expression/kernels';
import { gammaP } from '@/studios/lab/dist';

export interface StrandRead { pos: number; strand: '+' | '-' }

export interface PeakOptions {
  genomeLength: number;
  chrom?: string;
  control?: StrandRead[];
  /** Exact fragment intervals (paired-end), added to any single-end reads. */
  fragments?: readonly [number, number][];
  controlFragments?: readonly [number, number][];
  d?: number | 'auto';
  binSize?: number;
  shift?: number;
  extend?: number;
  qCutoff?: number;
  gap?: number;
  minSize?: number;
}

export interface Peak {
  chrom: string; start: number; end: number; name: string; score: number;
  fold: number; p: number; q: number; summit: number;
}

export interface PeakResult { d: number; binSize: number; coverage: Int32Array; lambdaBg: number; peaks: Peak[] }

/** Cross-correlation of plus- and minus-strand 5' ends over lags 50..400 bp; returns the lag with the highest correlation. */
export function estimateFragmentSize(reads: readonly StrandRead[], o: { min?: number; max?: number; binSize?: number } = {}): number {
  const binSize = o.binSize ?? 10, min = o.min ?? 50, max = o.max ?? 400;
  let top = 0; for (const r of reads) top = Math.max(top, r.pos);
  if (top <= 0) return 0;
  const n = Math.floor(top / binSize) + 2, plus = new Int32Array(n), minus = new Int32Array(n);
  for (const r of reads) {
    const i = Math.floor(r.pos / binSize); if (i < 0 || i >= n) continue;
    (r.strand === '+' ? plus : minus)[i]++;
  }
  let bestLag = 0, best = -1;
  for (let lag = Math.ceil(min / binSize); lag <= Math.floor(max / binSize); lag++) {
    let c = 0;
    for (let i = 0; i + lag < n; i++) c += plus[i] * minus[i + lag];
    if (c > best) { best = c; bestLag = lag; }
  }
  return bestLag * binSize;
}

/** Extend each 5' end into a fragment using MACS shift/extend (plus: right, minus: left). */
export function fragmentIntervals(reads: readonly StrandRead[], d: number, shift = 0, extend = d): [number, number][] {
  const out: [number, number][] = [];
  for (const r of reads) {
    if (!Number.isFinite(r.pos)) continue;
    if (r.strand === '+') { const s = r.pos + shift; out.push([s, s + extend - 1]); }
    else { const e = r.pos - shift; out.push([e - extend + 1, e]); }
  }
  return out;
}

export function coverageBins(intervals: readonly [number, number][], genomeLength: number, binSize: number): Int32Array {
  const nb = Math.max(1, Math.ceil(genomeLength / binSize)), diff = new Int32Array(nb + 2);
  for (const [a, b] of intervals) {
    const s = Math.max(0, Math.min(genomeLength - 1, a)), e = Math.max(0, Math.min(genomeLength - 1, b));
    if (e < s) continue;
    const lo = Math.floor(s / binSize), hi = Math.floor(e / binSize);
    diff[lo]++; diff[hi + 1]--;
  }
  const cov = new Int32Array(nb); let run = 0;
  for (let i = 0; i < nb; i++) { run += diff[i]; cov[i] = run; }
  return cov;
}

/** Mean of a sliding window (in bins) around every bin, using prefix sums. */
function windowMeans(cov: Int32Array, widthBins: number): Float64Array {
  const n = cov.length, pre = new Float64Array(n + 1), half = Math.max(1, Math.floor(widthBins / 2));
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + cov[i];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half), hi = Math.min(n, i + half);
    out[i] = hi > lo ? (pre[hi] - pre[lo]) / (hi - lo) : 0;
  }
  return out;
}

const round10 = (v: number) => Math.max(50, Math.min(400, Math.round(v / 10) * 10));

/** Call enriched regions. One chromosome per call; the caller loops over contigs from the SAM header. */
export function callPeaks(reads: readonly StrandRead[], opt: PeakOptions): PeakResult {
  const binSize = opt.binSize ?? 10, genomeLength = Math.max(1, Math.round(opt.genomeLength));
  const d = opt.d === 'auto' || opt.d === undefined ? round10(estimateFragmentSize(reads) || 200) : Math.round(opt.d);
  const shift = opt.shift ?? 0, extend = opt.extend ?? d, qCutoff = opt.qCutoff ?? 0.01, gap = opt.gap ?? 50, minSize = opt.minSize ?? 200;
  const intervals = [...fragmentIntervals(reads, d, shift, extend), ...(opt.fragments ?? [])];
  const cov = coverageBins(intervals, genomeLength, binSize);
  const coverageBp = opt.fragments?.length ? intervals.reduce((a, [s, e]) => a + Math.max(0, e - s + 1), 0) : reads.length * extend;
  const lambdaBg = coverageBp / genomeLength;
  const ctrl = opt.control && opt.control.length ? opt.control : null;
  const ctrlIntervals = ctrl || opt.controlFragments?.length ? [...(ctrl ? fragmentIntervals(ctrl, d, shift, extend) : []), ...(opt.controlFragments ?? [])] : null;
  const ctrlCov = ctrlIntervals ? coverageBins(ctrlIntervals, genomeLength, binSize) : null;
  const ctrlScale = ctrlIntervals && ctrlIntervals.length ? intervals.length / ctrlIntervals.length : 1;
  const w1 = windowMeans(ctrlCov ?? cov, Math.round(1000 / binSize));
  const w5 = windowMeans(ctrlCov ?? cov, Math.round(5000 / binSize));
  const w10 = windowMeans(ctrlCov ?? cov, Math.round(10000 / binSize));
  const n = cov.length, lambda = new Float64Array(n), p = new Float64Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    lambda[i] = Math.max(lambdaBg, w1[i] * ctrlScale, w5[i] * ctrlScale, w10[i] * ctrlScale);
    const k = cov[i];
    if (k >= 1) p[i] = gammaP(k, lambda[i]);
  }
  const q = bh(Array.from(p));
  const sig: number[] = [];
  for (let i = 0; i < n; i++) if (cov[i] >= 1 && q[i] <= qCutoff) sig.push(i);
  const regions: [number, number][] = [];
  for (const i of sig) {
    const last = regions[regions.length - 1];
    if (last && (i - last[1] - 1) * binSize <= gap) last[1] = i; else regions.push([i, i]);
  }
  const chrom = opt.chrom ?? 'chr1', peaks: Peak[] = [];
  for (const [a, b] of regions) {
    const start = a * binSize, end = Math.min(genomeLength, (b + 1) * binSize);
    if (end - start < minSize) continue;
    let best = a;
    for (let i = a + 1; i <= b; i++) if (cov[i] > cov[best]) best = i;
    const e = cov[best], ps = p[best], qs = q[best];
    peaks.push({
      chrom, start, end, name: `peak_${peaks.length + 1}`, score: Math.max(0, Math.min(1000, Math.round(-10 * Math.log10(Math.max(qs, 1e-300))))),
      fold: e / Math.max(lambda[best], 1e-12), p: ps, q: qs, summit: best * binSize,
    });
  }
  return { d, binSize, coverage: cov, lambdaBg, peaks };
}

/** narrowPeak-like BED: chrom, start, end, name, score, strand, fold, -log10 p, -log10 q, summit offset. */
export function peaksToBed(peaks: readonly Peak[]): string {
  return peaks.map((p) => [p.chrom, p.start, p.end, p.name, p.score, '.', p.fold.toFixed(3), (-Math.log10(Math.max(p.p, 1e-300))).toFixed(3), (-Math.log10(Math.max(p.q, 1e-300))).toFixed(3), p.summit - p.start].join('\t')).join('\n') + (peaks.length ? '\n' : '');
}

/** bedGraph of binned coverage with equal adjacent runs merged. */
export function coverageToBedGraph(cov: ArrayLike<number>, chrom: string, binSize = 10): string {
  const lines: string[] = [];
  let i = 0;
  while (i < cov.length) {
    let j = i + 1;
    while (j < cov.length && cov[j] === cov[i]) j++;
    if (cov[i] > 0) lines.push(`${chrom}\t${i * binSize}\t${j * binSize}\t${cov[i]}`);
    i = j;
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
