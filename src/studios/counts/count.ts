/** featureCounts-style unique gene assignment with an interval index. Pure TypeScript. */
import type { GffGene } from './gff';

export type Strandedness = 'none' | 'forward' | 'reverse';

export interface AlignedRead {
  seqid: string;
  /** 1-based inclusive aligned reference blocks (splice junctions already split). */
  blocks: [number, number][];
  strand: '+' | '-';
  mapq: number;
  unmapped?: boolean;
}

export interface CountOpts { stranded?: Strandedness; minMapq?: number; minOverlap?: number }

export interface CountSummary {
  /** Every annotation gene, in annotation order, including zeros. */
  counts: Map<string, number>;
  assigned: number;
  ambiguous: number;
  noFeature: number;
  lowMapq: number;
  unmapped: number;
}

interface Row { s: number; e: number; g: number }
interface SeqIndex { starts: number[]; rows: Row[]; maxEnd: number[] }

export interface GeneIndex { genes: GffGene[]; bySeq: Map<string, SeqIndex> }

export function buildGeneIndex(genes: GffGene[]): GeneIndex {
  const bySeq = new Map<string, Row[]>();
  genes.forEach((g, gi) => {
    if (!g.seqid) return;
    for (const [s, e] of g.exons) {
      const list = bySeq.get(g.seqid) ?? []; list.push({ s, e, g: gi }); bySeq.set(g.seqid, list);
    }
  });
  const out = new Map<string, SeqIndex>();
  for (const [seqid, rows] of bySeq) {
    rows.sort((a, b) => a.s - b.s || a.e - b.e);
    const starts = rows.map((r) => r.s), maxEnd: number[] = [];
    let m = 0; for (const r of rows) { m = Math.max(m, r.e); maxEnd.push(m); }
    out.set(seqid, { starts, rows, maxEnd });
  }
  return { genes, bySeq: out };
}

const upperBound = (xs: number[], v: number) => { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] <= v) lo = m + 1; else hi = m; } return lo; };

/** Overlap in bases between a read's blocks and the exon union of each candidate gene. */
function overlaps(idx: SeqIndex | undefined, blocks: [number, number][]): Map<number, number> {
  const hit = new Map<number, number>();
  if (!idx) return hit;
  for (const [s0, e0] of blocks) {
    const s = Math.min(s0, e0), e = Math.max(s0, e0);
    for (let i = upperBound(idx.starts, e) - 1; i >= 0 && idx.maxEnd[i] >= s; i--) {
      const r = idx.rows[i];
      if (r.e < s) continue;
      const ov = Math.min(e, r.e) - Math.max(s, r.s) + 1;
      if (ov > 0) hit.set(r.g, (hit.get(r.g) ?? 0) + ov);
    }
  }
  return hit;
}

const strandOk = (stranded: Strandedness, read: '+' | '-', gene: '+' | '-') =>
  stranded === 'none' || (stranded === 'forward' ? read === gene : read !== gene);

/** Assign each read to exactly one gene, or count it as ambiguous / noFeature / lowMapq / unmapped. */
export function countReads(reads: Iterable<AlignedRead>, genes: GffGene[], opts: CountOpts = {}): CountSummary {
  const stranded = opts.stranded ?? 'none', minMapq = opts.minMapq ?? 10, minOverlap = opts.minOverlap ?? 1;
  const index = buildGeneIndex(genes), counts = new Map<string, number>(genes.map((g) => [g.id, 0]));
  let assigned = 0, ambiguous = 0, noFeature = 0, lowMapq = 0, unmapped = 0;
  for (const read of reads) {
    if (read.unmapped || !read.seqid || read.seqid === '*') { unmapped++; continue; }
    if (read.mapq < minMapq) { lowMapq++; continue; }
    const hit = overlaps(index.bySeq.get(read.seqid), read.blocks);
    const good: number[] = [];
    for (const [gi, bases] of hit) {
      if (bases >= minOverlap && strandOk(stranded, read.strand, index.genes[gi].strand)) good.push(gi);
    }
    if (good.length === 1) {
      const id = index.genes[good[0]].id; counts.set(id, (counts.get(id) ?? 0) + 1); assigned++;
    } else if (good.length > 1) ambiguous++;
    else noFeature++;
  }
  return { counts, assigned, ambiguous, noFeature, lowMapq, unmapped };
}

/** TPM from parallel count and length arrays: rate = count / (length/1e3); TPM = rate / sum(rate) * 1e6. */
export function tpmFromCounts(counts: number[], lengths: number[]): number[] {
  if (counts.length !== lengths.length) throw new Error('counts and lengths must have the same length');
  const rate = counts.map((c, i) => (lengths[i] > 0 ? c / (lengths[i] / 1000) : 0));
  const total = rate.reduce((a, b) => a + b, 0);
  return rate.map((r) => (total > 0 ? (r / total) * 1e6 : 0));
}

export function tpm(counts: Map<string, number>, lengths: Map<string, number>): Map<string, number> {
  const ids = [...counts.keys()];
  const values = tpmFromCounts(ids.map((id) => counts.get(id) ?? 0), ids.map((id) => lengths.get(id) ?? 0));
  return new Map(ids.map((id, i) => [id, values[i]]));
}
