import { describe, expect, it } from 'vitest';
import { canonicalKmer, estimateGenomeSize, kmerSpectrum, spectrumHistogram } from './kmer';
import { randomGenome, simulateReads } from './sim';

describe('canonical k-mers', () => {
  it('takes the lexicographically smaller of a k-mer and its reverse complement', () => {
    expect(canonicalKmer('ACGTA')).toBe('ACGTA');
    expect(canonicalKmer('TACGT')).toBe('ACGTA');
  });

  it('counts a small hand example', () => {
    const s = kmerSpectrum(['ACGTACGT'], 3);
    expect(s.counts.get('ACG')).toBe(4);
    expect(s.counts.get('GTA')).toBe(2);
    expect(s.distinct).toBe(2);
    expect(s.totalKmers).toBe(6);
    expect(s.truncated).toBe(false);
  });

  it('skips k-mers containing N', () => {
    expect(kmerSpectrum(['ACGTNACGT'], 3).totalKmers).toBe(4);
  });
});

describe('estimateGenomeSize', () => {
  it('recovers a 20 kb genome from 40x error-free reads within 5%', () => {
    const genome = randomGenome(20_000, 3);
    const reads = simulateReads(genome, { coverage: 40, readLength: 100, seed: 9 });
    const e = estimateGenomeSize(spectrumHistogram(kmerSpectrum(reads.map((r) => r.seq), 21)));
    // With 100 bp reads and k=21 each k-mer sees (100-21+1)/100 of the 40x base coverage.
    expect(e.peak).toBeGreaterThanOrEqual(25);
    expect(e.peak).toBeLessThanOrEqual(40);
    expect(Math.abs(e.genomeSize - 20_000) / 20_000).toBeLessThan(0.05);
  });

  it('stays within 10% with 1% substitution errors', () => {
    const genome = randomGenome(20_000, 5);
    const reads = simulateReads(genome, { coverage: 40, readLength: 100, seed: 11, errorRate: 0.01 });
    const e = estimateGenomeSize(spectrumHistogram(kmerSpectrum(reads.map((r) => r.seq), 21)));
    expect(Math.abs(e.genomeSize - 20_000) / 20_000).toBeLessThan(0.1);
  });
});
