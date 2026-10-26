/** Seeded 16S amplicon and synthetic taxonomy-reference simulator (no real data). */
import type { FastqRecord } from '../reads/fastq';
import { revComp } from '../reads/merge';
import { mulberry32 } from '../reads/tools';

export const PRIMER_F = 'GTGYCAGCMGCCGCGGTAA';
export const PRIMER_R = 'GGACTACNVGGGTWTCTAAT';
const IUPAC: Record<string, string> = { A: 'A', C: 'C', G: 'G', T: 'T', R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT' };
const BASES = 'ACGT';
/** First 8 bases of the three 3' adapters that N1's mergePair strips; random ASVs avoid them. */
const ADAPTER_HEADS = ['AGATCGGA', 'CTGTCTCT', 'TGGAATTC'];

export type Rng = () => number;

export function randomDna(n: number, rnd: Rng): string {
  let s = '';
  for (let i = 0; i < n; i++) s += BASES[Math.floor(rnd() * 4)];
  return s;
}

/** One concrete base sequence drawn from an IUPAC primer (used to build a synthetic amplicon). */
export function resolvePrimer(primer: string, rnd: Rng): string {
  let s = '';
  for (const code of primer.toUpperCase()) {
    const set = IUPAC[code] ?? 'ACGT';
    s += set[Math.floor(rnd() * set.length)];
  }
  return s;
}

export function mutateSeq(seq: string, rate: number, rnd: Rng): string {
  const out = seq.split('');
  for (let i = 0; i < out.length; i++) {
    if (rnd() >= rate) continue;
    const from = out[i];
    let to = from;
    while (to === from) to = BASES[Math.floor(rnd() * 4)];
    out[i] = to;
  }
  return out.join('');
}

const cleanDna = (n: number, rnd: Rng): string => {
  for (;;) { const s = randomDna(n, rnd); if (!ADAPTER_HEADS.some((a) => s.includes(a))) return s; }
};

export interface AmpSample { sample: string; reads: FastqRecord[]; reverse: FastqRecord[] }
export interface SimOpts { readLength?: number; errorRate?: number; quality?: number }

/**
 * Paired 200 bp reads (read-through into the opposite primer) from full amplicons
 * built as primer + 250 nt ASV + reverse-complement of the reverse primer.
 */
export function simulateSample(asvs: string[], counts: number[], seed: number, sample: string, opts: SimOpts = {}): AmpSample {
  const readLength = opts.readLength ?? 200, errorRate = opts.errorRate ?? 0.003, quality = opts.quality ?? 35;
  const setup = mulberry32(seed ^ 0x9e3779b9), f = resolvePrimer(PRIMER_F, setup), r = resolvePrimer(PRIMER_R, setup);
  const amplicons = asvs.map((a) => f + a + revComp(r));
  const q = String.fromCharCode(33 + quality), rnd = mulberry32(seed);
  const reads: FastqRecord[] = [], reverse: FastqRecord[] = [];
  for (let a = 0; a < asvs.length; a++) {
    for (let i = 0; i < (counts[a] ?? 0); i++) {
      const amp = amplicons[a], id = `${sample}_${a + 1}_${i + 1}`;
      const r1 = mutateSeq(amp.slice(0, readLength), errorRate, rnd);
      const r2 = mutateSeq(revComp(amp.slice(-readLength)), errorRate, rnd);
      reads.push({ id: `${id}/1`, desc: `SYNTHETIC ASV${a + 1}`, seq: r1, qual: q.repeat(r1.length) });
      reverse.push({ id: `${id}/2`, desc: `SYNTHETIC ASV${a + 1}`, seq: r2, qual: q.repeat(r2.length) });
    }
  }
  return { sample, reads, reverse };
}

export interface RefWell { phylum: string; genus: string; base: string }
export interface TaxQuery { seq: string; phylum: string; genus: string }
export interface TaxonomySim { reference: string; wells: RefWell[]; queries: TaxQuery[] }

const PHYLA = [
  ['Firmicutes', ['Faecalibacterium', 'Roseburia', 'Lactobacillus']],
  ['Proteobacteria', ['Escherichia', 'Pseudomonas', 'Vibrio']],
  ['Actinobacteria', ['Bifidobacterium', 'Corynebacterium', 'Streptomyces']],
] as const;

/**
 * 3 phyla × 3 genera × 4 reference sequences of 250 nt. Sequences 1-3 are 5 %
 * substitutions of the genus prototype; 10 held-out queries per genus carry 3 %.
 */
export function syntheticTaxonomy(seed = 7): TaxonomySim {
  const rnd = mulberry32(seed), wells: RefWell[] = [], lines: string[] = [], queries: TaxQuery[] = [];
  for (const [phylum, genera] of PHYLA) for (const genus of genera) {
    const base = cleanDna(250, rnd);
    wells.push({ phylum, genus, base });
    for (let i = 0; i < 4; i++) {
      const seq = i === 0 ? base : mutateSeq(base, 0.05, rnd);
      lines.push(`>ref_${genus}_${i} Bacteria;${phylum};${genus}\n${seq}`);
    }
    for (let i = 0; i < 10; i++) queries.push({ seq: mutateSeq(base, 0.03, rnd), phylum, genus });
  }
  return { reference: lines.join('\n') + '\n', wells, queries };
}

export const DEMO_MIXES: number[][] = [
  [2000, 800, 320, 200, 100],
  [200, 1600, 1000, 600, 200],
  [100, 200, 400, 800, 1200],
];
export const DEMO_WELLS = [0, 2, 4, 6, 8];

export interface AmpliconDemo { samples: AmpSample[]; reference: string; asvs: string[]; mixes: number[][]; genera: string[]; phyla: string[] }

/** Three SYNTHETIC samples drawn from five genera of the synthetic reference. */
export function demoAmplicon(seed = 21): AmpliconDemo {
  const tax = syntheticTaxonomy(seed + 1), picked = DEMO_WELLS.map((i) => tax.wells[i]);
  const asvs = picked.map((w) => w.base);
  const samples = DEMO_MIXES.map((mix, i) => simulateSample(asvs, mix, seed + i * 101, `sample${i + 1}`));
  return { samples, reference: tax.reference, asvs, mixes: DEMO_MIXES, genera: picked.map((w) => w.genus), phyla: picked.map((w) => w.phylum) };
}
