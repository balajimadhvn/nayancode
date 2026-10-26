/** Seeded read simulator for known-answer tests and the synthetic demo. */
import type { FastqRecord } from './fastq';
import { mulberry32 } from './tools';
import { ADAPTERS } from './trim';

const BASES = 'ACGT';
export function randomGenome(n: number, seed: number): string {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => BASES[Math.floor(r() * 4)]).join('');
}

export interface SimOpts { coverage?: number; readLength?: number; seed?: number; errorRate?: number; quality?: number }

/** Uniform error-free (or substitution-error) reads from a genome. */
export function simulateReads(genome: string, opts: SimOpts = {}): FastqRecord[] {
  const coverage = opts.coverage ?? 40, len = opts.readLength ?? 100, r = mulberry32(opts.seed ?? 1), errorRate = opts.errorRate ?? 0, q = opts.quality ?? 40;
  const n = Math.max(1, Math.round((coverage * genome.length) / len));
  const out: FastqRecord[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor(r() * Math.max(1, genome.length - len));
    let seq = genome.slice(start, start + len);
    if (errorRate > 0) {
      const chars = seq.split('');
      for (let j = 0; j < chars.length; j++) if (r() < errorRate) chars[j] = BASES[(BASES.indexOf(chars[j]) + 1 + Math.floor(r() * 3)) % 4];
      seq = chars.join('');
    }
    const qual = String.fromCharCode(33 + q).repeat(seq.length);
    out.push({ id: `sim${i + 1}`, desc: `pos=${start}`, seq, qual });
  }
  return out;
}

/**
 * The 20,000-read demo: random 150 bp reads, a quality drop-off along the read,
 * adapter contamination in a third of reads and some NovaSeq poly-G tails.
 * Clearly synthetic; sequence content is random, not a real sample.
 */
export function syntheticFastq(n = 20_000, seed = 12): FastqRecord[] {
  const r = mulberry32(seed), out: FastqRecord[] = [];
  const adapters = Object.values(ADAPTERS);
  for (let i = 0; i < n; i++) {
    const len = 100 + Math.floor(r() * 51);
    let seq = randomGenome(len, Math.floor(r() * 2 ** 31));
    if (r() < 0.33) seq += adapters[Math.floor(r() * adapters.length)].slice(0, 8 + Math.floor(r() * 6));
    if (r() < 0.05) seq += 'G'.repeat(10 + Math.floor(r() * 6));
    const drop = 38 - (18 * i) / n;
    const qual = Array.from({ length: seq.length }, (_, j) => String.fromCharCode(33 + Math.max(2, Math.round(drop - (j / seq.length) * 6 + (r() - 0.5) * 4)))).join('');
    out.push({ id: `SYN${String(i + 1).padStart(5, '0')}`, desc: 'SYNTHETIC demo', seq, qual });
  }
  return out;
}
