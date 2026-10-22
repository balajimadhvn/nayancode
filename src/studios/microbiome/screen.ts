/**
 * Reference screening for metagenomes with FracMinHash sketches (Mash / sourmash style, clean-room).
 * A genome is sketched by hashing its canonical k-mers and keeping every hash below 2^32/scaled, so a fixed random
 * subset of the k-mers is retained and two sketches can be compared by set intersection. Sketches are abundance
 * sketches (hash → number of k-mer occurrences) because distinct hashes saturate once a small reference is fully
 * covered, while sequencing errors keep adding new distinct hashes: with pure set ratios a 70 % lambda community at
 * 34× coverage reads as 17 % lambda. Weighting by occurrences restores the planted 70/30 split (measured 64.5/27.7).
 *   containment = Σ counts of shared hashes / Σ read counts   ("how much of the sample is explained by this reference")
 *   coverage    = distinct shared hashes / distinct reference hashes   ("how much of the reference was seen")
 * Limits: k ≤ 25 (canonical k-mers are packed into a double, as in the pseudoalignment index); repeats collapse to one
 * hash, so containment cannot resolve strains that differ only in copy number, and no full database is bundled.
 */
import { forEachKmer } from '../expression/pseudoalign';

export const K = 21;
export const SCALED = 50;
const MAX32 = 4294967296;

/** 32-bit mix of a packed canonical k-mer (< 2^42). Same construction as the pseudoalignment index. */
export const hash32 = (x: number) => {
  const lo = x % 4294967296 | 0, hi = Math.floor(x / 4294967296) | 0;
  let h = Math.imul(lo ^ Math.imul(hi, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 13)) >>> 0;
};

/** Abundance sketch: FracMinHash hash → number of k-mer occurrences with that hash. */
export type Sketch = Map<number, number>;
/** FracMinHash sketch of a nucleotide sequence. */
export function sketchGenome(seq: string, k = K, scaled = SCALED): Sketch {
  if (k < 11 || k > 25) throw new Error('k must be between 11 and 25.');
  const limit = MAX32 / scaled, out: Sketch = new Map();
  forEachKmer(seq.toUpperCase(), k, (km) => { const h = hash32(km); if (h < limit) out.set(h, (out.get(h) ?? 0) + 1); });
  return out;
}
/** Total number of sketched k-mer occurrences. */
export const sketchCounts = (s: Sketch) => { let n = 0; for (const c of s.values()) n += c; return n; };

export interface RefSketch { id: string; sketch: Sketch; length: number }
export const refSketch = (id: string, seq: string, k = K, scaled = SCALED): RefSketch => ({ id, sketch: sketchGenome(seq, k, scaled), length: seq.length });

export interface ScreenRow { id: string; shared: number; containment: number; coverage: number }
/** For each reference: containment (by occurrences) and reference coverage (by distinct hashes), best first. */
export function screenReads(read: Sketch, refs: RefSketch[]): ScreenRow[] {
  const total = sketchCounts(read);
  const rows = refs.map((r) => {
    let shared = 0, counts = 0;
    for (const h of read.keys()) if (r.sketch.has(h)) { shared++; counts += read.get(h)!; }
    return { id: r.id, shared, containment: total ? counts / total : 0, coverage: r.sketch.size ? shared / r.sketch.size : 0 };
  });
  return rows.sort((a, b) => b.containment - a.containment || b.shared - a.shared || a.id.localeCompare(b.id));
}

export interface Gathered { id: string; intersection: number; fractionOfSample: number }
/**
 * Minimum-metagenome-cover style greedy gather: repeatedly take the reference that explains the most hashes still
 * unexplained, then remove those hashes. `intersection` counts distinct hashes (the usual threshold unit) and
 * `fractionOfSample` is the share of the original sample's occurrences explained by that reference. Stops when the
 * best reference explains fewer than `minIntersection` hashes (the sourmash default of 5).
 */
export function gather(read: Sketch, refs: RefSketch[], minIntersection = 5): Gathered[] {
  const remaining = new Map(read), total = sketchCounts(read), out: Gathered[] = [], taken = new Set<string>();
  for (;;) {
    let best: RefSketch | null = null, bestHits: number[] = [];
    for (const r of refs) {
      if (taken.has(r.id)) continue;
      const hits: number[] = [];
      for (const h of remaining.keys()) if (r.sketch.has(h)) hits.push(h);
      if (hits.length > bestHits.length) { best = r; bestHits = hits; }
    }
    if (!best || bestHits.length < minIntersection) break;
    taken.add(best.id);
    let counts = 0;
    for (const h of bestHits) { counts += remaining.get(h)!; remaining.delete(h); }
    out.push({ id: best.id, intersection: bestHits.length, fractionOfSample: total ? counts / total : 0 });
  }
  return out;
}

/** Merge per-read sketches into one sample sketch (occurrences are summed). */
export function mergeSketches(sketches: Iterable<Sketch>): Sketch {
  const s: Sketch = new Map();
  for (const k of sketches) for (const [h, n] of k) s.set(h, (s.get(h) ?? 0) + n);
  return s;
}

/** Parse a multi-record FASTA: one reference per record, id = first word of the header. */
export function parseRefFasta(text: string): { id: string; seq: string }[] {
  const out: { id: string; seq: string }[] = []; let id = '', parts: string[] = [];
  const flush = () => { if (id && parts.length) out.push({ id, seq: parts.join('') }); parts = []; };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === '>') { flush(); id = line.slice(1).trim().split(/\s+/)[0] || `record${out.length + 1}`; }
    else if (id) parts.push(line.toUpperCase().replace(/[^ACGT]/g, 'N'));
  }
  flush();
  return out;
}

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
export const revComp = (s: string) => [...s].reverse().map((c) => COMP[c] ?? 'N').join('');

/**
 * Simulated shotgun reads from a mixture of references (planted truth for the tests and the demo). Reads are drawn
 * uniformly along each genome, half from each strand, with uniform substitution errors.
 */
export function simulateReads(refs: { id: string; seq: string }[], weights: number[], o: { nReads: number; readLen?: number; errorRate?: number; seed?: number }): string[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!refs.length || !(total > 0)) throw new Error('Simulate needs at least one reference with a positive weight.');
  if (refs.length !== weights.length) throw new Error('Each reference needs a weight.');
  const readLen = o.readLen ?? 150, err = o.errorRate ?? 0, BASES = 'ACGT';
  let s = (o.seed ?? 1) >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cum: number[] = []; weights.reduce((a, b, i) => (cum[i] = a + b), 0);
  const out: string[] = [];
  for (let n = 0; n < o.nReads; n++) {
    const u = rnd() * total; let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; }
    const seq = refs[lo].seq, span = seq.length - readLen;
    if (span <= 0) throw new Error(`Reference ${refs[lo].id} is shorter than the read length.`);
    const start = Math.floor(rnd() * span);
    let rd = seq.slice(start, start + readLen);
    if (rnd() < 0.5) rd = revComp(rd);
    if (err > 0) {
      const chars = [...rd];
      for (let i = 0; i < chars.length; i++) if (rnd() < err) chars[i] = BASES[Math.floor(rnd() * 4)];
      rd = chars.join('');
    }
    out.push(rd);
  }
  return out;
}
