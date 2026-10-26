import { describe, expect, it } from 'vitest';
import { gammaP } from '@/studios/lab/dist';
import { callPeaks, coverageToBedGraph, estimateFragmentSize, fragmentIntervals, peaksToBed, type Peak } from './peaks';
import { simulatePeaks } from './simCounts';

describe('Poisson tail used by the peak caller', () => {
  it('matches scipy.special.gammainc / poisson.sf reference values', () => {
    expect(gammaP(5, 2.0)).toBeCloseTo(0.052653017343711125, 12);
    expect(gammaP(1, 0.1)).toBeCloseTo(0.09516258196404044, 12);
    expect(gammaP(30, 10)).toBeCloseTo(2.509951201527959e-7, 15);
  });
});

describe('fragment size', () => {
  it('extends plus and minus 5-prime ends into the same fragment', () => {
    expect(fragmentIntervals([{ pos: 100, strand: '+' }, { pos: 299, strand: '-' }], 200)).toEqual([[100, 299], [100, 299]]);
    expect(fragmentIntervals([{ pos: 100, strand: '+' }], 200, -100, 200)).toEqual([[0, 199]]);
  });

  it('estimates d = 180 +- 15 from stranded reads simulated with true d = 180', () => {
    const sim = simulatePeaks({ seed: 7, d: 180, background: 30_000 });
    const d = estimateFragmentSize(sim.treatment);
    expect(Math.abs(d - 180)).toBeLessThanOrEqual(15);
  });
});

describe('peak calling on the SYNTHETIC 10 Mb genome', () => {
  it('finds exactly the three planted peaks without a control, each summit near its centre', { timeout: 120_000 }, () => {
    const sim = simulatePeaks({ seed: 7 });
    const res = callPeaks(sim.treatment, { genomeLength: sim.genomeLength, d: 200 });
    expect(res.peaks).toHaveLength(3);
    const centres = sim.planted.map((p) => p.centre).sort((a, b) => a - b);
    for (const [i, p] of res.peaks.entries()) {
      expect(p.q).toBeLessThanOrEqual(0.01);
      expect(p.end - p.start).toBeGreaterThanOrEqual(200);
      expect(Math.abs(p.summit - centres[i])).toBeLessThanOrEqual(100);
      expect(p.fold).toBeGreaterThan(1);
    }
    expect(res.d).toBe(200);
  });

  it('still finds exactly three peaks with a uniform-background control', { timeout: 120_000 }, () => {
    const sim = simulatePeaks({ seed: 7 });
    const res = callPeaks(sim.treatment, { genomeLength: sim.genomeLength, d: 200, control: sim.control });
    expect(res.peaks).toHaveLength(3);
    for (const p of res.peaks) expect(p.q).toBeLessThanOrEqual(0.01);
    expect(res.peaks.map((p) => p.chrom)).toEqual(['chr1', 'chr1', 'chr1']);
  });

  it('uses auto fragment size near the simulated 200 bp', { timeout: 120_000 }, () => {
    const sim = simulatePeaks({ seed: 7 });
    const res = callPeaks(sim.treatment, { genomeLength: sim.genomeLength, d: 'auto' });
    expect(Math.abs(res.d - 200)).toBeLessThanOrEqual(15);
    expect(res.peaks).toHaveLength(3);
  });
});

describe('BED output', () => {
  it('writes ten narrowPeak columns with 0-based start and end-exclusive end', () => {
    const peak: Peak = { chrom: 'chr1', start: 5000, end: 5400, name: 'peak_1', score: 120, fold: 25.5, p: 1e-12, q: 1e-10, summit: 5200 };
    const line = peaksToBed([peak]).trim().split('\t');
    expect(line).toHaveLength(10);
    expect(line.slice(0, 6)).toEqual(['chr1', '5000', '5400', 'peak_1', '120', '.']);
    expect(line[9]).toBe('200');
  });

  it('merges equal coverage runs in a bedGraph', () => {
    expect(coverageToBedGraph([0, 2, 2, 0, 3], 'chr1', 10)).toBe('chr1\t10\t30\t2\nchr1\t40\t50\t3\n');
  });
});
