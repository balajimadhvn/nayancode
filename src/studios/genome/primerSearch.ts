/** Primer specificity search: binding sites with mismatches (3′-weighted) on both strands, and the amplicons they predict.
 *  Clean-room: an exact-seed (pigeonhole) k-mer index finds candidate windows and every candidate is verified base by base,
 *  so the result is identical to scanning every window (checked against `bruteForceSites` in the tests and benchmarks). */
import { encodeSeq, revCompCodes, type Contig } from './genomeData';

export interface SiteOpts {
  /** Maximum mismatches over the whole primer. */
  maxMismatch: number;
  /** Maximum mismatches within the last `threeLen` bases of the 3′ end (extension needs a matched 3′ end). */
  max3Mismatch: number;
  threeLen: number;
}
export const DEFAULT_SITE_OPTS: SiteOpts = { maxMismatch: 3, max3Mismatch: 1, threeLen: 5 };
/** Penalty of a mismatch by distance d from the 3′ end (0 = terminal base): 5, 4, 3, 2, 2, then 1. */
export const threePrimeWeight = (d: number) => (d < 2 ? 5 - d : d === 2 ? 3 : d < 5 ? 2 : 1);

export interface PrimerSite {
  primer: number;
  /** '+': primer sequence equals the + strand here (extends rightwards, a forward primer); '-': it equals the − strand (extends leftwards). */
  strand: '+' | '-';
  contig: number;
  /** 0-based leftmost base of the footprint on the + strand. */
  pos: number;
  length: number;
  mismatches: number;
  mismatches3: number;
  penalty: number;
  /** 0-based mismatch offsets within the footprint (left to right). */
  mmAt: number[];
}

/** One concatenated code array (contigs separated by code 4) so a single index serves a multi-contig genome. */
export interface GenomeIndexBase { codes: Uint8Array; starts: number[]; ends: number[]; contigs: Contig[] }
export function concatContigs(contigs: Contig[]): GenomeIndexBase {
  const total = contigs.reduce((a, c) => a + c.length + 1, 0), codes = new Uint8Array(total).fill(4), starts: number[] = [], ends: number[] = []; let o = 0;
  for (const c of contigs) { codes.set(c.codes, o); starts.push(o); ends.push(o + c.length); o += c.length + 1; }
  return { codes, starts, ends, contigs };
}
const contigOf = (g: GenomeIndexBase, p: number) => { let lo = 0, hi = g.starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g.starts[m] <= p) lo = m; else hi = m - 1; } return lo; };

/** Positions of every k-mer, by counting sort. k ≤ 11 (4^11 offsets). */
export class KmerIndex {
  readonly offsets: Int32Array; readonly positions: Int32Array;
  constructor(readonly g: GenomeIndexBase, readonly k: number) {
    const n = g.codes.length, size = 4 ** k, mask = size - 1, counts = new Int32Array(size + 1);
    const walk = (fn: (key: number, p: number) => void) => { let key = 0, run = 0; for (let i = 0; i < n; i++) { const c = g.codes[i]; if (c > 3) { run = 0; key = 0; continue; } key = ((key << 2) | c) & mask; if (++run >= k) fn(key, i - k + 1); } };
    walk((key) => counts[key + 1]++); for (let i = 0; i < size; i++) counts[i + 1] += counts[i];
    this.offsets = counts; const fill = counts.slice(0, size); this.positions = new Int32Array(counts[size]); walk((key, p) => { this.positions[fill[key]++] = p; });
  }
  *hits(kmer: Uint8Array, at: number): Generator<number> { let key = 0; for (let i = 0; i < this.k; i++) { const c = kmer[at + i]; if (c > 3) return; key = (key << 2) | c; } for (let j = this.offsets[key]; j < this.offsets[key + 1]; j++) yield this.positions[j]; }
}
/** k that makes the pigeonhole seed exact for `maxMismatch` (each of maxMismatch+1 disjoint segments holds one k-mer), or 0 when seeds would be too short to help (under 4 bases). */
export const seedLength = (primerLen: number, maxMismatch: number) => { const s = Math.floor(primerLen / (maxMismatch + 1)); return s < 4 ? 0 : Math.min(s, 11); };

/** Verify one window of the genome against `target` (the primer or its reverse complement); 3′ end is at the right for '+', left for '-'. */
function verify(g: GenomeIndexBase, pos: number, target: Uint8Array, strand: '+' | '-', o: SiteOpts): { mm: number; mm3: number; pen: number; at: number[] } | null {
  const L = target.length; let mm = 0, mm3 = 0, pen = 0; const at: number[] = [];
  for (let j = 0; j < L; j++) {
    if (g.codes[pos + j] === target[j]) continue;
    const d = strand === '+' ? L - 1 - j : j;
    if (++mm > o.maxMismatch) return null; if (d < o.threeLen && ++mm3 > o.max3Mismatch) return null;
    pen += threePrimeWeight(d); at.push(j);
  }
  return { mm, mm3, pen, at };
}
const clean = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

/** All binding sites of the primers (5′→3′ strings) in the genome. Uses the seed index when seeds are long enough, else scans. */
export function findSites(g: GenomeIndexBase, primers: string[], opts: Partial<SiteOpts> = {}, indexes: Map<number, KmerIndex> = new Map()): PrimerSite[] {
  const o = { ...DEFAULT_SITE_OPTS, ...opts }, out: PrimerSite[] = [];
  primers.forEach((raw, pi) => {
    const p = encodeSeq(clean(raw)), L = p.length; if (L < 8) throw new Error(`Primer ${pi + 1} is shorter than 8 bases`); if (p.some((c) => c > 3)) throw new Error(`Primer ${pi + 1} contains characters other than A, C, G, T`);
    const k = seedLength(L, o.maxMismatch);
    for (const strand of ['+', '-'] as const) {
      const t = strand === '+' ? p : revCompCodes(p), seen = new Set<number>();
      const consider = (pos: number) => {
        if (pos < 0 || pos + L > g.codes.length || seen.has(pos)) return; seen.add(pos);
        const ci = contigOf(g, pos); if (pos + L > g.ends[ci]) return;
        const v = verify(g, pos, t, strand, o); if (v) out.push({ primer: pi, strand, contig: ci, pos: pos - g.starts[ci], length: L, mismatches: v.mm, mismatches3: v.mm3, penalty: v.pen, mmAt: v.at });
      };
      if (k) {
        let idx = indexes.get(k); if (!idx) indexes.set(k, (idx = new KmerIndex(g, k)));
        for (let s = 0; s <= o.maxMismatch; s++) { const off = s * Math.floor(L / (o.maxMismatch + 1)); for (const h of idx.hits(t, off)) consider(h - off); }
      } else for (let ci = 0; ci < g.starts.length; ci++) for (let i = g.starts[ci]; i + L <= g.ends[ci]; i++) { const v = verify(g, i, t, strand, o); if (v) out.push({ primer: pi, strand, contig: ci, pos: i - g.starts[ci], length: L, mismatches: v.mm, mismatches3: v.mm3, penalty: v.pen, mmAt: v.at }); }
    }
  });
  return out.sort((a, b) => a.contig - b.contig || a.pos - b.pos || a.primer - b.primer || (a.strand < b.strand ? -1 : 1));
}
/** Reference implementation: test every window. Slow; used to check `findSites`. */
export function bruteForceSites(g: GenomeIndexBase, primers: string[], opts: Partial<SiteOpts> = {}): PrimerSite[] {
  const o = { ...DEFAULT_SITE_OPTS, ...opts }, out: PrimerSite[] = [];
  primers.forEach((raw, pi) => {
    const p = encodeSeq(clean(raw)), L = p.length;
    for (const strand of ['+', '-'] as const) { const t = strand === '+' ? p : revCompCodes(p);
      for (let ci = 0; ci < g.starts.length; ci++) for (let i = g.starts[ci]; i + L <= g.ends[ci]; i++) { const v = verify(g, i, t, strand, o); if (v) out.push({ primer: pi, strand, contig: ci, pos: i - g.starts[ci], length: L, mismatches: v.mm, mismatches3: v.mm3, penalty: v.pen, mmAt: v.at }); } }
  });
  return out.sort((a, b) => a.contig - b.contig || a.pos - b.pos || a.primer - b.primer || (a.strand < b.strand ? -1 : 1));
}

export interface Product {
  contig: number; start: number; end: number; size: number;
  fwd: PrimerSite; rev: PrimerSite;
  mismatches: number; penalty: number;
  /** Both primers match perfectly. */
  perfect: boolean;
  /** Forward and reverse primer belong to the same user-defined pair. */
  intended: boolean;
}
/** Amplicons: a '+' site upstream of a '-' site, with product size within [minSize, maxSize]. Linear sequences only (no wrap across the origin of a circular genome). */
export function predictProducts(sites: PrimerSite[], pairs: [number, number][], minSize: number, maxSize: number, cap = 5000): { products: Product[]; truncated: boolean } {
  const fw = sites.filter((s) => s.strand === '+'), rv = sites.filter((s) => s.strand === '-').sort((a, b) => a.contig - b.contig || a.pos - b.pos), products: Product[] = [], pairSet = new Set(pairs.map(([a, b]) => `${a}:${b}`));
  let truncated = false;
  for (const f of fw) {
    let lo = 0, hi = rv.length; while (lo < hi) { const m = (lo + hi) >> 1; if (rv[m].contig < f.contig || (rv[m].contig === f.contig && rv[m].pos + rv[m].length < f.pos + minSize)) lo = m + 1; else hi = m; }
    for (let i = lo; i < rv.length && rv[i].contig === f.contig; i++) {
      const r = rv[i], end = r.pos + r.length, size = end - f.pos; if (size > maxSize && r.pos > f.pos + maxSize) break; if (size < minSize || size > maxSize) continue;
      if (products.length >= cap) { truncated = true; break; }
      products.push({ contig: f.contig, start: f.pos, end, size, fwd: f, rev: r, mismatches: f.mismatches + r.mismatches, penalty: f.penalty + r.penalty, perfect: f.mismatches + r.mismatches === 0, intended: pairSet.has(`${f.primer}:${r.primer}`) });
    }
    if (truncated) break;
  }
  return { products: products.sort((a, b) => a.contig - b.contig || a.start - b.start || a.size - b.size), truncated };
}
export interface SpecificitySummary { perfectProducts: number; intendedPerfect: number; offTargetProducts: number; verdict: 'specific' | 'off-target products' | 'no product' }
/** `pairs` = number of user-defined primer pairs; the verdict is 'specific' when each gives exactly one perfect product and nothing else is predicted. */
export function summariseProducts(ps: Product[], pairs = 1): SpecificitySummary {
  const perfectProducts = ps.filter((p) => p.perfect).length, intendedPerfect = ps.filter((p) => p.perfect && p.intended).length, offTargetProducts = ps.length - intendedPerfect;
  return { perfectProducts, intendedPerfect, offTargetProducts, verdict: ps.length === 0 ? 'no product' : intendedPerfect === pairs && offTargetProducts === 0 ? 'specific' : 'off-target products' };
}
