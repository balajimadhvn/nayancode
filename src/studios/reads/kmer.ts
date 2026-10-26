/** Canonical k-mer spectrum and genome-size estimate. */
export const MAX_KMERS = 30_000_000;

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
function revComp(s: string): string {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += COMP[s[i]] ?? 'N';
  return out;
}
export const canonicalKmer = (s: string) => (s <= revComp(s) ? s : revComp(s));

export interface Spectrum { counts: Map<string, number>; distinct: number; totalKmers: number; truncated: boolean }

/** Canonical k-mer counts, capped at MAX_KMERS distinct entries with a visible truncation flag. */
export function kmerSpectrum(seqs: Iterable<string>, k = 21): Spectrum {
  const counts = new Map<string, number>();
  let totalKmers = 0, truncated = false;
  for (const seq of seqs) {
    const s = seq.toUpperCase();
    for (let i = 0; i + k <= s.length; i++) {
      const kmer = canonicalKmer(s.slice(i, i + k));
      if (kmer.includes('N')) continue;
      totalKmers++;
      const n = counts.get(kmer);
      if (n !== undefined) counts.set(kmer, n + 1);
      else if (counts.size < MAX_KMERS) counts.set(kmer, 1);
      else truncated = true;
    }
  }
  return { counts, distinct: counts.size, totalKmers, truncated };
}

/** Coverage -> number of distinct k-mers with that coverage. */
export function spectrumHistogram(spectrum: Spectrum | Map<string, number>): Map<number, number> {
  const counts = spectrum instanceof Map ? spectrum.values() : spectrum.counts.values();
  const hist = new Map<number, number>();
  for (const c of counts) hist.set(c, (hist.get(c) ?? 0) + 1);
  return hist;
}

export interface GenomeEstimate { genomeSize: number; peak: number; valley: number; totalKmers: number }

/**
 * Main coverage peak of a k-mer histogram (counts 1-2 are error coverage and
 * are ignored), then size = sum(count * frequency for count >= valley) / peak.
 * The tallest coverage with at least two supporting k-mers wins, so a single
 * error spike cannot define the peak. Repeats and heterozygosity bias the result.
 */
export function estimateGenomeSize(hist: Map<number, number>): GenomeEstimate {
  let peak = 0;
  for (const [c, f] of hist) {
    if (c >= 3 && f > (hist.get(peak) ?? 0)) peak = c;
  }
  const valley = 3;
  let total = 0;
  for (const [c, f] of hist) if (c >= valley) total += c * f;
  return { genomeSize: peak ? total / peak : 0, peak, valley, totalKmers: total };
}
