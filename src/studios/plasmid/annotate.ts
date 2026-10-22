/** Feature annotation of plasmid sequences against a small built-in library,
 * plus primer binding-site search. Nucleotide screening only: identity and
 * coverage come from the shared Smith–Waterman local aligner.
 */
import { align, revComp } from '@/studios/sequence/kernels';
import type { Feature } from './genbank';
import type { LibraryElement } from './features-library';

export interface AnnotateOptions { minIdentity?: number; circular?: boolean }

const K = 12;

/** Forward k-mer positions of a string (non-canonical). */
function kmerMap(s: string, k: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + k <= s.length; i++) {
    const km = s.slice(i, i + k);
    if (!m.has(km)) m.set(km, i);
  }
  return m;
}

/**
 * Finds library elements on both strands of `seq`.
 * Elements shorter than 40 nt must match perfectly; longer ones are seeded with
 * 12-mers, verified with a local alignment and kept at ≥ minIdentity identity and
 * ≥ 90 % coverage. Circular plasmids are searched across the origin.
 */
export function annotate(seq: string, library: LibraryElement[], opt: AnnotateOptions = {}): Feature[] {
  const minIdentity = opt.minIdentity ?? 0.95;
  const S = seq.toUpperCase();
  const len = S.length;
  const circular = opt.circular ?? true;
  const maxLen = Math.max(0, ...library.map((e) => e.seq.length));
  const ext = circular ? S + S.slice(0, Math.max(0, maxLen - 1)) : S;
  const rcExt = revComp(ext);
  const out: Feature[] = [];

  const add = (el: LibraryElement, startExt: number, alnLen: number, strand: 1 | -1, identity: number, coverage: number) => {
    const start = (startExt % len) + 1;
    const end = start + alnLen - 1;
    const wraps = circular && end > len;
    out.push({ type: el.type, start, end: wraps ? end : Math.min(end, len), strand, label: el.name, qualifiers: { note: el.note }, identity, coverage, wraps });
  };

  for (const el of library) {
    const L = el.seq.toUpperCase();
    if (L.length < 40) {
      for (const strand of [1, -1] as const) {
        const target = strand === 1 ? ext : rcExt;
        let i = target.indexOf(L);
        const seen = new Set<number>();
        while (i >= 0) {
          const key = i % len;
          if (!seen.has(key)) { seen.add(key); add(el, i, L.length, strand, 1, 1); }
          i = target.indexOf(L, i + 1);
        }
      }
      continue;
    }
    const kmers = kmerMap(L, K);
    for (const strand of [1, -1] as const) {
      const target = strand === 1 ? ext : rcExt;
      const votes = new Map<number, { n: number; q: number }>();
      for (let i = 0; i + K <= target.length; i++) {
        const pos = kmers.get(target.slice(i, i + K));
        if (pos === undefined) continue;
        const diag = Math.round((i - pos) / 8);
        const v = votes.get(diag);
        if (v) v.n++;
        else votes.set(diag, { n: 1, q: i - pos });
      }
      const best = [...votes.values()].sort((a, b) => b.n - a.n).slice(0, 3);
      for (const cand of best) {
        if (cand.n < 4) continue;
        const from = Math.max(0, cand.q - 50), to = Math.min(target.length, cand.q + L.length + 50);
        const window = target.slice(from, to);
        const aln = align(L, window, { mode: 'local', kind: 'dna' });
        const coverage = aln.length / L.length;
        if (aln.identity < minIdentity || coverage < 0.9) continue;
        const at = from + aln.bStart;
        // Reverse-strand hits are in the reverse-complement coordinate system; convert back.
        const startExt = strand === 1 ? at : target.length - (at + aln.length);
        add(el, startExt, aln.length, strand, aln.identity, coverage);
      }
    }
  }

  // Drop duplicate hits of the same element at (nearly) the same place, then any
  // hit fully contained in a longer hit of the same name.
  const dedup: Feature[] = [];
  for (const f of out) {
    const span = f.end >= f.start ? f.end - f.start : len - f.start + f.end;
    if (!dedup.some((g) => g.label === f.label && g.strand === f.strand && Math.abs(((g.start - f.start) % len + len) % len) < 10 && Math.abs(((g.end >= g.start ? g.end - g.start : len - g.start + g.end) - span)) < 10)) dedup.push(f);
  }
  const contained = (a: Feature, b: Feature) => {
    const aLen = a.end - a.start + 1, bLen = b.end - b.start + 1;
    if (aLen >= bLen) return false;
    if (a.start <= b.start && a.end >= b.end) return true;
    return a.start > a.end && (a.start <= b.start || a.end >= b.end);
  };
  return dedup.filter((f) => !dedup.some((g) => g !== f && g.label === f.label && g.strand === f.strand && contained(f, g))).sort((a, b) => a.start - b.start);
}

export interface PrimerSite { start: number; end: number; strand: 1 | -1; mismatches: number; seq: string }

/**
 * Every binding site of a primer on either strand: the 3' terminal 12 nt must
 * match exactly and at most `maxMismatch` other positions may differ.
 */
export function findPrimerSites(seq: string, primer: string, maxMismatch = 2): PrimerSite[] {
  const S = seq.toUpperCase(), P = primer.toUpperCase().replace(/[^ACGT]/g, '');
  if (P.length < 12) throw new Error('The primer must be at least 12 nt long.');
  const sites: PrimerSite[] = [];
  for (const strand of [1, -1] as const) {
    const target = strand === 1 ? S : revComp(S);
    const anchor = P.slice(-12);
    const seen = new Set<number>();
    for (let i = 0; i + 12 <= target.length; i++) {
      if (target.slice(i, i + 12) !== anchor) continue;
      const start = i + 12 - P.length;
      if (start < 0) continue;
      let mm = 0;
      for (let j = 0; j < P.length; j++) if (target[start + j] !== P[j]) mm++;
      if (mm > maxMismatch) continue;
      const key = strand === 1 ? start : S.length - (start + P.length);
      if (seen.has(key)) continue;
      seen.add(key);
      sites.push({ start: (key % S.length) + 1, end: (key % S.length) + P.length, strand, mismatches: mm, seq: target.slice(start, start + P.length) });
    }
  }
  return sites.sort((a, b) => a.start - b.start);
}
