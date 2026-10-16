// Primer specificity search against exhaustive references. Two independent references: (1) `bruteForceSites`, which tests every window
// of every contig with the same acceptance rule; (2) a string-based scan written separately in this file. The seed-indexed search
// must return exactly the same sites, and the predicted amplicons must equal an all-pairs enumeration.
import { describe, expect, it } from 'vitest';
import { decodeSeq } from '@/studios/genome/genomeData';
import { bruteForceSites, concatContigs, findSites, predictProducts, threePrimeWeight, type PrimerSite, type SiteOpts } from '@/studios/genome/primerSearch';
import { designPrimers } from '@/studios/sequence/design';
import { round, writeJson } from '../lib/metrics';
import { loadGenome } from './lib';

const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const comp: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const rc = (s: string) => [...s].reverse().map((c) => comp[c] ?? 'N').join('');
const gcOf = (s: string) => [...s].filter((c) => c === 'G' || c === 'C').length / s.length;

/** Independent reference: plain strings and nested loops, no shared code with the Workbench search. */
function naiveSites(contigs: string[], primers: string[], o: SiteOpts) {
  const out: string[] = [];
  primers.forEach((p, pi) => {
    const L = p.length;
    for (const [strand, t] of [['+', p], ['-', rc(p)]] as const) contigs.forEach((c, ci) => {
      for (let i = 0; i + L <= c.length; i++) {
        let mm = 0, mm3 = 0, pen = 0, ok = true;
        for (let j = 0; j < L; j++) if (c[i + j] !== t[j]) { const d = strand === '+' ? L - 1 - j : j; mm++; if (d < o.threeLen) mm3++; pen += threePrimeWeight(d); if (mm > o.maxMismatch || mm3 > o.max3Mismatch) { ok = false; break; } }
        if (ok) out.push(`${pi}:${strand}:${ci}:${i}:${mm}:${pen}`);
      }
    });
  });
  return out.sort();
}
const key = (s: PrimerSite) => `${s.primer}:${s.strand}:${s.contig}:${s.pos}:${s.mismatches}:${s.penalty}`;
const rows: Record<string, unknown>[] = [];

describe('primer binding sites and amplicons against exhaustive search', () => {
  for (const [id, mm, nPrimers] of [['ecoli-k12', 3, 12], ['bsubtilis-168', 4, 12], ['scer-s288c', 3, 10], ['lambda', 5, 8]] as const) {
    it(`${id}: ≤ ${mm} mismatches, ≤ 1 in the last 5 bases`, () => {
      const g = loadGenome(id), strs = g.contigs.map((c) => decodeSeq(c.codes)), r = rng(mm * 1000 + id.length), primers: string[] = [];
      while (primers.length < nPrimers) { const c = strs[Math.floor(r() * strs.length)], L = 18 + Math.floor(r() * 9), i = Math.floor(r() * (c.length - L)), p = c.slice(i, i + L); if (!/[^ACGT]/.test(p) && gcOf(p) >= 0.4 && gcOf(p) <= 0.6) primers.push(r() < 0.5 ? p : rc(p)); }
      const opts: SiteOpts = { maxMismatch: mm, max3Mismatch: 1, threeLen: 5 }, gi = concatContigs(g.contigs), idx = new Map();
      const t0 = performance.now(); const got = findSites(gi, primers, opts, idx); const tSeed = performance.now() - t0;
      const t1 = performance.now(); const brute = bruteForceSites(gi, primers, opts); const tBrute = performance.now() - t1;
      const naive = naiveSites(strs, primers, opts);
      expect(got.map(key).sort()).toEqual(brute.map(key).sort()); expect(got.map(key).sort()).toEqual(naive);
      expect(got.filter((s) => s.mismatches === 0).length).toBeGreaterThanOrEqual(primers.length); // every primer is cut from the genome, so it has an exact site
      rows.push({ genome: id, primers: nPrimers, maxMismatch: mm, sitesFound: got.length, exactSites: got.filter((s) => s.mismatches === 0).length, identicalToBruteForce: true, identicalToIndependentScan: true, seedIndex: mm >= 5 ? 'none (seeds too short; scans)' : 'pigeonhole k-mers', msSeeded: round(tSeed, 0), msBruteForce: round(tBrute, 0), genomeBp: gi.codes.length });
    });
  }
  it('primers designed by Sequence Studio: every intended amplicon is found at its exact coordinates, with the same products as all-pairs enumeration', () => {
    const g = loadGenome('ecoli-k12'), seq = decodeSeq(g.contigs[0].codes), gi = concatContigs(g.contigs), r = rng(77); let found = 0, planned = 0, specific = 0; const pairs: { left: string; right: string; start: number; end: number }[] = [];
    for (let t = 0; t < 8; t++) {
      const from = 100_000 + Math.floor(r() * 4_000_000), win = seq.slice(from, from + 900); if (/[^ACGT]/.test(win)) continue;
      try { const d = designPrimers(win, { start: 400, len: 100 }, { minProduct: 150, maxProduct: 700 }); const p = d.pairs[0]; const lo = from + p.left.start, hi = from + p.right.end; pairs.push({ left: p.left.seq, right: p.right.seq, start: lo, end: hi }); } catch { /* region without a valid pair: skip */ }
    }
    expect(pairs.length).toBeGreaterThanOrEqual(6);
    for (const [i, p] of pairs.entries()) {
      const sites = findSites(gi, [p.left, p.right], { maxMismatch: 3, max3Mismatch: 1, threeLen: 5 }), { products } = predictProducts(sites, [[0, 1]], 50, 2000); planned++;
      const hit = products.find((x) => x.perfect && x.start === p.start && x.end === p.end); if (hit) found++; if (products.filter((x) => x.perfect).length === 1) specific++;
      // all-pairs enumeration
      const f = sites.filter((s) => s.strand === '+'), rv = sites.filter((s) => s.strand === '-'), want: string[] = [];
      for (const a of f) for (const b of rv) { const size = b.pos + b.length - a.pos; if (a.contig === b.contig && size >= 50 && size <= 2000) want.push(`${a.primer}:${a.pos}:${b.primer}:${b.pos}`); }
      expect(products.map((x) => `${x.fwd.primer}:${x.fwd.pos}:${x.rev.primer}:${x.rev.pos}`).sort()).toEqual(want.sort()); void i;
    }
    expect(found).toBe(planned); rows.push({ experiment: 'Sequence Studio primer pairs on E. coli K-12', pairs: planned, intendedProductFoundAtExactCoordinates: found, pairsWithASinglePerfectProduct: specific });
  });
  it('writes results', () => { writeJson('benchmarks/results/genome-tools-primers.json', { rows }); expect(rows.length).toBe(5); });
});
