/** Seeded SYNTHETIC data for the Counts & Peaks Studio: a 20-gene 100 kb counting truth and a 10 Mb peak truth. */
import type { AlignedRead } from './count';
import type { GffGene } from './gff';
import type { StrandRead } from './peaks';

/** Small deterministic PRNG (mulberry32); no package, identical in Node and the browser. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface CountsSim {
  refName: string;
  refLength: number;
  genes: GffGene[];
  reads: AlignedRead[];
  /** Planted read counts per gene id. */
  planted: Map<string, number>;
  /** Reads that overlap two or more genes when strandedness is ignored. */
  overlapReads: number;
  readLength: number;
  /** The annotation as GFF3 text, so the demo can be re-run after changing a setting. */
  annotation: string;
}

/** GFF3 text for a gene list (one gene row plus its exons). */
export function genesToGff(genes: readonly GffGene[]): string {
  const lines = ['##gff-version 3'];
  for (const g of genes) {
    lines.push([g.seqid, 'counts', 'gene', g.exons[0][0], g.exons[g.exons.length - 1][1], '.', g.strand, '.', `ID=${g.id};Name=${g.name}`].join('\t'));
    lines.push([g.seqid, 'counts', 'mRNA', g.exons[0][0], g.exons[g.exons.length - 1][1], '.', g.strand, '.', `ID=${g.id}.t1;Parent=${g.id}`].join('\t'));
    g.exons.forEach(([s, e], i) => lines.push([g.seqid, 'counts', 'exon', s, e, '.', g.strand, '.', `ID=${g.id}.e${i + 1};Parent=${g.id}.t1`].join('\t')));
  }
  return lines.join('\n') + '\n';
}

const gene = (id: string, name: string, strand: '+' | '-', start: number, end: number): GffGene => ({ id, name, seqid: 'chr1', strand, exons: [[start, end]], length: end - start + 1 });

/** 20 genes on a 100 kb contig. GENE18 (+) overlaps GENE19 (-) and GENE20 (-) in two separate regions. */
export function countsGenes(): GffGene[] {
  const out: GffGene[] = [];
  for (let i = 0; i < 17; i++) {
    const start = 1000 + i * 4700;
    out.push(gene(`gene${String(i + 1).padStart(2, '0')}`, `GENE${String(i + 1).padStart(2, '0')}`, '+', start, start + 1999));
  }
  out.push(gene('gene18', 'GENE18', '+', 80000, 82000));
  out.push(gene('gene19', 'GENE19', '-', 79500, 80600));
  out.push(gene('gene20', 'GENE20', '-', 81400, 82500));
  return out;
}

export function simulateCounts(opt: { seed?: number; readLength?: number } = {}): CountsSim {
  const rng = mulberry32(opt.seed ?? 11), readLength = opt.readLength ?? 100, genes = countsGenes();
  const planted = new Map<string, number>(), reads: AlignedRead[] = [];
  const place = (g: GffGene, n: number, lo: number, hi: number) => {
    const strand: '+' | '-' = g.strand === '+' ? '-' : '+';
    const maxStart = hi - readLength + 1;
    if (maxStart < lo) throw new Error(`Read ${readLength} bp does not fit in ${g.id} region ${lo}-${hi}`);
    for (let i = 0; i < n; i++) {
      const start = lo + Math.floor(rng() * (maxStart - lo + 1));
      reads.push({ seqid: 'chr1', blocks: [[start, start + readLength - 1]], strand, mapq: 60 });
    }
  };
  genes.forEach((g, i) => {
    if (i < 17) {
      const n = 10 + i * 5;
      planted.set(g.id, n);
      place(g, n, g.exons[0][0], g.exons[0][1]);
      return;
    }
    const n = g.id === 'gene18' ? 30 : g.id === 'gene19' ? 20 : 25;
    planted.set(g.id, n);
    if (g.id === 'gene18') { place(g, 5, 80601, 81399); place(g, 10, 80000, 80600); place(g, 15, 81400, 81901); }
    if (g.id === 'gene19') { place(g, 8, 79500, 79999); place(g, 12, 80000, 80501); }
    if (g.id === 'gene20') { place(g, 10, 82001, 82500); place(g, 15, 81400, 81901); }
  });
  // Reads from GENE18's unique part can still be 100 bp long inside 80601..81399; GENE20 starts at 81400.
  return { refName: 'chr1', refLength: 100000, genes, reads, planted, overlapReads: 52, readLength, annotation: genesToGff(genes) };
}

const cigarOf = (blocks: readonly [number, number][]): string => {
  if (!blocks.length) return '*';
  let out = '';
  for (let i = 0; i < blocks.length; i++) {
    out += `${blocks[i][1] - blocks[i][0] + 1}M`;
    if (i + 1 < blocks.length) { const gap = blocks[i + 1][0] - blocks[i][1] - 1; if (gap > 0) out += `${gap}N`; }
  }
  return out;
};

/** SAM text (with a @SQ header) for the simulated alignments; used by the demo and by the UI tests. */
export function samFromReads(reads: readonly AlignedRead[], refName = 'chr1', refLength = 100000, mapq = 60): string {
  const head = `@HD\tVN:1.6\tSO:unsorted\n@SQ\tSN:${refName}\tLN:${refLength}`;
  const lines = reads.map((r, i) => {
    const flag = r.strand === '-' ? 16 : 0;
    return [`read${i + 1}`, flag, r.seqid, r.blocks[0]?.[0] ?? 1, mapq, cigarOf(r.blocks), '*', 0, 0, '*', '*'].join('\t');
  });
  return [head, ...lines].join('\n') + '\n';
}

export interface PlantedPeak { centre: number; start: number; end: number; fragments: number }
export interface PeakSim {
  refName: string; genomeLength: number; d: number;
  treatment: StrandRead[]; control: StrandRead[];
  planted: PlantedPeak[];
}

/** 10 Mb contig: uniform background fragments plus Gaussian peaks, with stranded 5' reads at both fragment ends. */
export function simulatePeaks(opt: { seed?: number; genomeLength?: number; background?: number; d?: number; centres?: number[]; fragments?: number; sd?: number; halfWidth?: number } = {}): PeakSim {
  const G = opt.genomeLength ?? 10_000_000, d = opt.d ?? 200, background = opt.background ?? 100_000;
  const centres = opt.centres ?? [2_000_000, 5_000_000, 8_000_000], n = opt.fragments ?? 1500, sd = opt.sd ?? 80, half = opt.halfWidth ?? 200;
  const rng = mulberry32(opt.seed ?? 7), crng = mulberry32((opt.seed ?? 7) + 101), srng = mulberry32((opt.seed ?? 7) + 202);
  const add = (out: StrandRead[], start: number) => {
    const s = Math.max(0, Math.min(G - d, Math.round(start)));
    if (srng() < 0.5) out.push({ pos: s, strand: '+' });
    else out.push({ pos: s + d - 1, strand: '-' });
  };
  const treatment: StrandRead[] = [], control: StrandRead[] = [];
  for (let i = 0; i < background; i++) { const s = Math.floor(rng() * (G - d)); add(treatment, s); add(control, Math.floor(crng() * (G - d))); }
  const planted: PlantedPeak[] = [];
  for (const c of centres) {
    let made = 0, guard = 0;
    while (made < n && guard++ < n * 20) {
      const x = c + (rng() + rng() + rng() + rng() - 2) * sd * 1.73; // approximately normal, truncated below
      if (x < c - half || x > c + half) continue;
      add(treatment, x); made++;
    }
    planted.push({ centre: c, start: c - half, end: c + half, fragments: made });
  }
  return { refName: 'chr1', genomeLength: G, d, treatment, control, planted };
}
