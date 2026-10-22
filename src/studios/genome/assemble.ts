/**
 * Overlap-layout assembly of small genomes from long or high-accuracy reads, in the style of miniasm (clean-room):
 * minimizer indexing → overlap detection → string graph (containment and transitive edges removed) → unitigs built by
 * walking unambiguous paths. The output is raw read-level sequence: it is not polished, so it carries the reads' error
 * rate, and repeats collapse the graph, so a genome with long repeats will fragment.
 *
 * Coordinates: minimizers are canonical k-mers, so a minimizer carries its strand. Two reads overlap on the same strand
 * when posA − posB is constant, and on opposite strands when posA + posB is constant. From the diagonal d of read A
 * against partner P (P = B, or reverse-complemented B when the strands disagree):
 *   d > 0  A starts left of P  →  A → P with overlap min(lenA − d, lenP)
 *   d < 0  A starts right of P →  P → A with overlap min(lenP + d, lenA)
 * An overlap equal to the whole shorter read is containment, not a dovetail, and that read is dropped.
 */
import { forEachKmer } from '../expression/pseudoalign';

export interface AssembleOpts { k?: number; w?: number; minOverlap?: number; maxOcc?: number; minHits?: number }
export interface Contig { id: string; seq: string; reads: number }
export interface Assembly { contigs: Contig[]; reads: number; overlaps: number; contained: number }

export interface Mini { h: number; pos: number; rev: boolean }
const B32 = (x: number) => { let h = Math.imul(x ^ 0x9e3779b1, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 13)) >>> 0; };
const CODE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 };

/** k-mer code of a clean ACGT string (used to recover the strand of a canonical k-mer). */
function codeOf(s: string, k: number): number { let x = 0; for (let i = 0; i < k; i++) { const b = CODE[s[i]]; if (b === undefined) return -1; x = x * 4 + b; } return x; }
const rc = (s: string) => [...s].reverse().map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' }[c] ?? 'N')).join('');

/** Minimizers (minimum-hash canonical k-mer in each window of w k-mers), with position and strand. */
export function minimizers(seq: string, k = 15, w = 10): Mini[] {
  const km: { km: number; pos: number }[] = [];
  forEachKmer(seq, k, (x, pos) => { km.push({ km: x, pos }); });
  const out: Mini[] = []; let run = 0;
  const emit = (a: number, b: number) => {
    if (b - a < w) return;
    let prev = -1;
    for (let i = a; i + w <= b; i++) {
      let best = i, bh = B32(km[i].km);
      for (let j = i + 1; j < i + w; j++) { const h = B32(km[j].km); if (h < bh) { bh = h; best = j; } }
      if (best === prev) continue; prev = best;
      const { km: x, pos } = km[best];
      out.push({ h: bh, pos, rev: codeOf(seq.slice(pos, pos + k), k) !== x });
    }
  };
  for (let i = 1; i <= km.length; i++) if (i === km.length || km[i].pos !== km[i - 1].pos + 1) { emit(run, i); run = i; }
  return out;
}

interface Hit { r: number; p: number; rev: boolean }
interface Edge { to: number; ovl: number } // in the oriented-node graph

const isDovetail = (ovl: number, lenLeft: number, lenRight: number) => ovl < lenLeft && ovl < lenRight && ovl > 0;

/**
 * Simulated long reads from one genome: uniform length, both strands, substitution errors (used by the demo and tests).
 */
export function simulateLongReads(seq: string, o: { coverage: number; minLen?: number; maxLen?: number; errorRate?: number; seed?: number }): string[] {
  const minLen = o.minLen ?? 3000, maxLen = o.maxLen ?? 8000, err = o.errorRate ?? 0.003;
  let s = (o.seed ?? 1) >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const nReads = Math.max(1, Math.round((o.coverage * seq.length) / ((minLen + maxLen) / 2))), out: string[] = [];
  for (let n = 0; n < nReads; n++) {
    const len = Math.min(seq.length, minLen + Math.floor(rnd() * (maxLen - minLen + 1))), start = Math.floor(rnd() * (seq.length - len));
    const chars = [...seq.slice(start, start + len)];
    for (let i = 0; i < chars.length; i++) if (rnd() < err) chars[i] = 'ACGT'[Math.floor(rnd() * 4)];
    out.push(rnd() < 0.5 ? chars.join('') : rc(chars.join('')));
  }
  return out;
}

/**
 * Assemble reads into contigs. Reads shorter than 500 nt are ignored; fewer than 5 usable reads is an error.
 */
export function assemble(reads: string[], o: AssembleOpts = {}): Assembly {
  const k = o.k ?? 15, w = o.w ?? 10, maxOcc = o.maxOcc ?? 100, minHits = o.minHits ?? 4;
  const seqs = reads.map((r) => r.toUpperCase()).filter((r) => r.length >= 500);
  if (seqs.length < 5) throw new Error(`Assembly needs at least 5 reads of 500 nt or longer (found ${seqs.length}).`);
  const lens = seqs.map((s) => s.length), n = seqs.length;

  // ---- minimizer index, dropping hashes that occur in more than `maxOcc` reads (repeats)
  const minis = seqs.map((s) => minimizers(s, k, w));
  const raw = new Map<number, Hit[]>();
  minis.forEach((list, r) => {
    const seen = new Set<number>();
    for (const m of list) {
      if (seen.has(m.h)) continue; seen.add(m.h);
      let a = raw.get(m.h); if (!a) raw.set(m.h, (a = []));
      a.push({ r, p: m.pos, rev: m.rev });
    }
  });
  const index = new Map<number, Hit[]>();
  for (const [h, hits] of raw) if (hits.length <= maxOcc) index.set(h, hits);

  // ---- overlaps: group hits by (partner, strand relation, diagonal bucket of 100 nt)
  interface Cand { n: number; sum: number; lo: number; hi: number }
  const cands: { a: number; b: number; flipped: boolean; d: number; n: number; span: number }[] = [];
  for (let a = 0; a < n; a++) {
    const groups = new Map<number, Cand>();
    for (const m of minis[a]) {
      const list = index.get(m.h); if (!list) continue;
      for (const e of list) {
        if (e.r === a) continue;
        const flipped = m.rev !== e.rev;
        const diag = flipped ? m.pos + e.p : m.pos - e.p;
        const bucket = Math.floor(diag / 100);
        const key = ((bucket + 16384) * 262144 + e.r) * 2 + (flipped ? 1 : 0);
        const g = groups.get(key);
        if (g) { g.n++; g.sum += diag; if (m.pos < g.lo) g.lo = m.pos; if (m.pos > g.hi) g.hi = m.pos; }
        else groups.set(key, { n: 1, sum: diag, lo: m.pos, hi: m.pos });
      }
    }
    for (const [key, g] of groups) {
      if (g.n < minHits) continue;
      const flipped = (key % 2) === 1;
      const b = Math.floor(key / 2) % 262144;
      const mean = g.sum / g.n;
      cands.push({ a, b, flipped, d: flipped ? mean + k - lens[b] : mean, n: g.n, span: g.hi - g.lo + k });
    }
  }

  // ---- keep the best candidate per read pair, then apply the dovetail / containment rules
  const best = new Map<string, { a: number; b: number; flipped: boolean; d: number; n: number; span: number }>();
  for (const c of cands) {
    const key = c.a < c.b ? `${c.a},${c.b},${c.flipped ? 1 : 0}` : `${c.b},${c.a},${c.flipped ? 1 : 0}`;
    const cur = best.get(key); if (!cur || c.n > cur.n) best.set(key, c);
  }
  const contained = new Set<number>();
  interface Ov { left: number; right: number; flipLeft: boolean; flipRight: boolean; ovl: number }
  const ovs: Ov[] = [];
  const minOv = (x: number, y: number) => (Math.min(x, y) < 2500 ? 0.4 * Math.min(x, y) : (o.minOverlap ?? 1000));
  for (const c of best.values()) {
    const { a, b, flipped } = c, d = Math.round(c.d), lenP = lens[b];
    if (d === 0 && flipped) continue;
    const ovl = d >= 0 ? Math.min(lens[a] - d, lenP) : Math.min(lenP + d, lens[a]);
    if (ovl <= 0 || ovl < minOv(lens[a], lenP)) continue;
    // The supporting minimizers must span the claimed overlap; hits parked in one repeat do not count.
    if (c.span < 0.5 * ovl) continue;
    if (d >= 0) {
      if (!isDovetail(ovl, lens[a], lenP)) { contained.add(b); continue; }
      ovs.push({ left: a, right: b, flipLeft: false, flipRight: flipped, ovl });
    } else {
      if (!isDovetail(ovl, lenP, lens[a])) { contained.add(a); continue; }
      // P (rc(B) when the strands disagree) is on the left.
      ovs.push(flipped ? { left: b, right: a, flipLeft: true, flipRight: false, ovl } : { left: b, right: a, flipLeft: false, flipRight: false, ovl });
    }
  }
  const kept = ovs.filter((e) => !contained.has(e.left) && !contained.has(e.right));

  // ---- oriented-node graph: node = read*2 + flip; each overlap gives both traversal directions
  const out = new Map<number, Edge[]>();
  const addEdge = (u: number, v: number, ovl: number) => { const a = out.get(u); if (a) a.push({ to: v, ovl }); else out.set(u, [{ to: v, ovl }]); };
  for (const e of kept) {
    const l = e.left * 2 + (e.flipLeft ? 1 : 0), r = e.right * 2 + (e.flipRight ? 1 : 0);
    addEdge(l, r, e.ovl);
    addEdge(r ^ 1, l ^ 1, e.ovl);
  }

  // ---- transitive edges (Myers 2005): drop u→v when u→w→v lands on the same offset within 10 %
  {
    for (const [u, edges] of [...out]) {
      const fromU = edges.filter((e) => out.has(e.to));
      const drop = new Set<Edge>();
      for (const e of edges) {
        const viaW = fromU.filter((w) => w.to !== e.to && (out.get(w.to) ?? []).some((x) => x.to === e.to));
        const directOff = lens[u >> 1] - e.ovl;
        for (const w of viaW) {
          const next = (out.get(w.to) ?? []).find((x) => x.to === e.to)!;
          const implied = (lens[u >> 1] - w.ovl) + (lens[w.to >> 1] - next.ovl);
          if (Math.abs(implied - directOff) <= 0.1 * Math.min(lens[u >> 1], lens[e.to >> 1])) { drop.add(e); break; }
        }
      }
      if (drop.size) out.set(u, edges.filter((e) => !drop.has(e)));
    }
  }
  // ---- contigs by greedy overlap extension: from an unused read, take the longest overlap into an unused read and
  // repeat rightward and leftward. Shortcuts removed above cannot strand a read, because every candidate is retried.
  const adj = new Map<number, { to: number; ovl: number }[]>(), radj = new Map<number, { from: number; ovl: number }[]>();
  for (const [u, edges] of out) for (const e of edges) {
    const a = adj.get(u); if (a) a.push({ to: e.to, ovl: e.ovl }); else adj.set(u, [{ to: e.to, ovl: e.ovl }]);
    const b = radj.get(e.to); if (b) b.push({ from: u, ovl: e.ovl }); else radj.set(e.to, [{ from: u, ovl: e.ovl }]);
  }
  for (const list of adj.values()) list.sort((x, y) => y.ovl - x.ovl);
  for (const list of radj.values()) list.sort((x, y) => y.ovl - x.ovl);

  const used = new Set<number>(), chains: { node: number; ovl: number }[][] = [];
  const nodes = [...new Set([...adj.keys(), ...[...adj.values()].flatMap((l) => l.map((e) => e.to))])].sort((x, y) => (lens[y >> 1] - lens[x >> 1]) || x - y);
  for (const start of nodes) {
    if (used.has(start >> 1)) continue;
    const chain: { node: number; ovl: number }[] = [{ node: start, ovl: 0 }];
    used.add(start >> 1);
    for (;;) { // rightward
      const last = chain[chain.length - 1];
      const best = (adj.get(last.node) ?? []).find((e) => !used.has(e.to >> 1));
      if (!best) break;
      last.ovl = best.ovl; chain.push({ node: best.to, ovl: 0 }); used.add(best.to >> 1);
    }
    for (;;) { // leftward
      const first = chain[0];
      const best = (radj.get(first.node) ?? []).find((e) => !used.has(e.from >> 1));
      if (!best) break;
      chain.unshift({ node: best.from, ovl: best.ovl }); used.add(best.from >> 1);
    }
    chains.push(chain);
  }

  const contigs: Contig[] = chains.map((chain) => {
    let s = (chain[0].node & 1) ? rc(seqs[chain[0].node >> 1]) : seqs[chain[0].node >> 1];
    for (let i = 1; i < chain.length; i++) { const node = chain[i].node, seq = (node & 1) ? rc(seqs[node >> 1]) : seqs[node >> 1]; s += seq.slice(Math.min(chain[i - 1].ovl, seq.length)); }
    return { id: '', seq: s, reads: chain.length };
  }).sort((x, y) => y.seq.length - x.seq.length).map((c, i) => ({ ...c, id: `ctg${i + 1}` }));
  return { contigs, reads: n, overlaps: kept.length, contained: contained.size };
}
