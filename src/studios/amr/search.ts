/** Nucleotide screening of assembled contigs against the NCBI AMRFinderPlus reference gene set.
 *  Pure TypeScript: no DOM, so the same code runs in the worker and in Node tests. */

import { align, parseFasta, revComp } from '@/studios/sequence/kernels';

export interface AmrHeader {
  proteinAccession: string;
  nucleotideAccession: string;
  symbol: string;
  allele: string;
  product: string;
}

/** `>WP_1|NG_1|1|1|blaTEM-34|blaTEM|product name NG_1:101-961` → the pipe-delimited AMR_CDS fields. */
export function parseAmrHeader(header: string): AmrHeader {
  const fields = header.replace(/^>/, '').trim().split('|');
  const at = (i: number) => (fields[i] ?? '').trim();
  return {
    proteinAccession: at(0),
    nucleotideAccession: at(1),
    symbol: at(4),
    allele: at(5),
    product: at(6).split(/\s+/)[0] ?? '',
  };
}

export interface AmrRef {
  accession: string;
  nucleotideAccession: string;
  symbol: string;
  allele: string;
  product: string;
  drugClass: string;
  subclass: string;
  seq: string;
}

export function parseAmrFasta(text: string): AmrRef[] {
  return parseFasta(text).map((r) => {
    const h = parseAmrHeader(r.description ? `${r.id} ${r.description}` : r.id);
    return {
      accession: h.proteinAccession || r.id,
      nucleotideAccession: h.nucleotideAccession,
      symbol: h.symbol,
      allele: h.allele,
      product: h.product,
      drugClass: '',
      subclass: '',
      seq: r.seq,
    };
  });
}

export interface DrugClass { drugClass: string; subclass: string }

function mergeClass(map: Map<string, DrugClass>, key: string, cls: string, sub: string) {
  if (!key || !cls) return;
  const cur = map.get(key);
  if (!cur) { map.set(key, { drugClass: cls, subclass: sub }); return; }
  if (!cur.drugClass.split('; ').includes(cls)) cur.drugClass += `; ${cls}`;
  if (sub && !cur.subclass.split('; ').includes(sub)) cur.subclass = cur.subclass ? `${cur.subclass}; ${sub}` : sub;
}

/** ReferenceGeneCatalog.txt: drug class and subclass keyed by allele, gene family and protein accession. */
export function parseAmrCatalog(text: string): Map<string, DrugClass> {
  const out = new Map<string, DrugClass>();
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return out;
  const head = lines[0].split('\t');
  const col = (name: string) => head.indexOf(name);
  const ia = col('allele'), ig = col('gene_family'), ic = col('class'), is = col('subclass');
  const ir = col('refseq_protein_accession'), igb = col('genbank_protein_accession');
  if (ic < 0) return out;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = lines[i].split('\t');
    const cls = (f[ic] ?? '').trim();
    const sub = (is < 0 ? '' : f[is] ?? '').trim();
    mergeClass(out, (ia < 0 ? '' : f[ia] ?? '').trim(), cls, sub);
    mergeClass(out, (ig < 0 ? '' : f[ig] ?? '').trim(), cls, sub);
    mergeClass(out, (ir < 0 ? '' : f[ir] ?? '').trim(), cls, sub);
    mergeClass(out, (igb < 0 ? '' : f[igb] ?? '').trim(), cls, sub);
  }
  return out;
}

/** Most specific key first: the record's own protein accession, then its allele, then its symbol. */
export function annotateAmrRefs(refs: AmrRef[], catalog: Map<string, DrugClass>): number {
  let annotated = 0;
  for (const r of refs) {
    const hit = catalog.get(r.accession) ?? catalog.get(r.allele) ?? catalog.get(r.symbol);
    if (!hit) continue;
    r.drugClass = hit.drugClass;
    r.subclass = hit.subclass;
    annotated++;
  }
  return annotated;
}

export interface AmrIndex {
  k: number;
  refs: AmrRef[];
  /** Forward k-mers as 2-bit codes, sorted ascending; parallel to refIds and positions. */
  keys: Float64Array;
  refIds: Int32Array;
  positions: Int32Array;
}

const CODE = new Int8Array(128).fill(-1);
for (const [ch, v] of [['A', 0], ['C', 1], ['G', 2], ['T', 3]] as const) {
  CODE[ch.charCodeAt(0)] = v;
  CODE[ch.charCodeAt(0) + 32] = v;
}

/** Rolling, forward-only (non-canonical) k-mer walk: fn(code, position) for every clean window. */
function forEachForwardKmer(seq: string, k: number, fn: (code: number, pos: number) => void) {
  const mask = (1 << (2 * k)) - 1;
  let v = 0, run = 0;
  for (let i = 0; i < seq.length; i++) {
    const c = seq.charCodeAt(i) < 128 ? CODE[seq.charCodeAt(i)] : -1;
    if (c < 0) { v = 0; run = 0; continue; }
    v = ((v << 2) | c) & mask;
    run++;
    if (run >= k) fn(v, i - k + 1);
  }
}

/** Stable LSD radix sort of `order` by keys (two 15-bit passes over a 30-bit code). */
function sortOrderByKey(keys: Float64Array, order: Int32Array) {
  const n = keys.length, B = 1 << 15;
  let src: Int32Array = order, dst: Int32Array = new Int32Array(n);
  const count = new Int32Array(B);
  for (let shift = 0; shift < 30; shift += 15) {
    count.fill(0);
    for (let i = 0; i < n; i++) count[(keys[src[i]] >>> shift) & (B - 1)]++;
    let sum = 0;
    for (let b = 0; b < B; b++) { const c = count[b]; count[b] = sum; sum += c; }
    for (let i = 0; i < n; i++) { const o = src[i]; dst[count[(keys[o] >>> shift) & (B - 1)]++] = o; }
    const t = src; src = dst; dst = t;
  }
  if (src !== order) order.set(src);
}

/** Apply the permutation `sorted[order[j]] = original[j]` … i.e. write position j = value at order[j], in place. */
function permuteInPlace(keys: Float64Array, refIds: Int32Array, positions: Int32Array, order: Int32Array) {
  const n = order.length;
  const done = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (done[i]) continue;
    let cur = i;
    const k0 = keys[i], r0 = refIds[i], p0 = positions[i];
    for (;;) {
      const from = order[cur];
      done[cur] = 1;
      if (from === i) { keys[cur] = k0; refIds[cur] = r0; positions[cur] = p0; break; }
      keys[cur] = keys[from]; refIds[cur] = refIds[from]; positions[cur] = positions[from];
      cur = from;
    }
  }
}

const MAX_REFS_PER_KMER = 50;

export function buildAmrIndex(refs: AmrRef[], k = 15): AmrIndex {
  if (k < 2 || k > 15) throw new Error('k must be between 2 and 15 (a 2-bit code has to fit in 32 bits).');
  if (!refs.length) throw new Error('No reference genes to index.');
  const windows = new Int32Array(refs.length);
  let total = 0;
  for (let r = 0; r < refs.length; r++) {
    let n = 0;
    forEachForwardKmer(refs[r].seq, k, () => n++);
    windows[r] = n;
    total += n;
  }
  const keys = new Float64Array(total), refIds = new Int32Array(total), positions = new Int32Array(total);
  let p = 0;
  for (let r = 0; r < refs.length; r++) forEachForwardKmer(refs[r].seq, k, (code, pos) => { keys[p] = code; refIds[p] = r; positions[p] = pos; p++; });

  const order = new Int32Array(total);
  for (let i = 0; i < total; i++) order[i] = i;
  sortOrderByKey(keys, order);
  permuteInPlace(keys, refIds, positions, order);

  // Drop conserved/repetitive k-mers: they vote for everything and only add noise.
  const seen = new Int32Array(refs.length);
  let stamp = 0, kept = total;
  for (let lo = 0; lo < total;) {
    let hi = lo + 1;
    while (hi < total && keys[hi] === keys[lo]) hi++;
    if (hi - lo > MAX_REFS_PER_KMER) {
      stamp++;
      let distinct = 0;
      for (let i = lo; i < hi; i++) { const r = refIds[i]; if (seen[r] !== stamp) { seen[r] = stamp; if (++distinct > MAX_REFS_PER_KMER) break; } }
      if (distinct > MAX_REFS_PER_KMER) {
        for (let i = lo; i < hi; i++) keys[i] = -1;
        kept -= hi - lo;
      }
    }
    lo = hi;
  }
  if (kept !== total) {
    let w = 0;
    for (let i = 0; i < total; i++) {
      if (keys[i] < 0) continue;
      keys[w] = keys[i]; refIds[w] = refIds[i]; positions[w] = positions[i]; w++;
    }
  }
  return { k, refs, keys: keys.subarray(0, kept), refIds: refIds.subarray(0, kept), positions: positions.subarray(0, kept) };
}

function lowerBound(keys: Float64Array, target: number): number {
  let lo = 0, hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export interface AmrContig { name: string; seq: string }

export interface AmrHit {
  gene: string;
  allele: string;
  product: string;
  accession: string;
  drugClass: string;
  subclass: string;
  contig: string;
  start: number;
  end: number;
  strand: '+' | '-';
  identity: number;
  coverage: number;
  score: number;
  refLength: number;
}

export interface AmrScreenOptions {
  minIdentity?: number;
  minCoverage?: number;
  minSeeds?: number;
  onProgress?: (fraction: number, note?: string) => void;
}

export const MAX_CONTIG_BP = 20_000_000;
export const MAX_INPUT_BP = 100_000_000;
const MAX_ALIGN_CELLS = 24_000_000;
const MAX_CANDIDATES_PER_CONTIG = 2_000;
const DIAGONAL_BUCKET = 32;
const WINDOW_PAD = 50;

interface Bucket { refId: number; bucket: number; strand: 1 | -1; votes: number; minQ: number; maxQ: number }

const countUngapped = (s: string) => { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] !== '-') n++; return n; };

/** Seed votes on (reference, diagonal) buckets, then Smith–Waterman confirmation of each candidate locus. */
export function screenContigs(index: AmrIndex, contigs: AmrContig[], opts: AmrScreenOptions = {}): AmrHit[] {
  const minIdentity = opts.minIdentity ?? 0.9;
  const minCoverage = opts.minCoverage ?? 0.6;
  const minSeeds = opts.minSeeds ?? 6;
  if (!(minIdentity > 0 && minIdentity <= 1)) throw new Error('minIdentity must be in (0, 1].');
  if (!(minCoverage > 0 && minCoverage <= 1)) throw new Error('minCoverage must be in (0, 1].');
  if (!(minSeeds >= 1)) throw new Error('minSeeds must be at least 1.');
  let total = 0;
  for (const c of contigs) {
    if (c.seq.length > MAX_CONTIG_BP) throw new Error(`Contig "${c.name}" is ${c.seq.length.toLocaleString()} bp; the limit is 20 Mb per contig.`);
    total += c.seq.length;
  }
  if (total > MAX_INPUT_BP) throw new Error(`Total input is ${total.toLocaleString()} bp; the limit is ${(MAX_INPUT_BP / 1e6).toFixed(0)} Mb.`);

  const { k, refs, keys, refIds, positions } = index;
  const hits: AmrHit[] = [];
  const work = Math.max(1, contigs.length * 2);
  const span = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  for (let ci = 0; ci < contigs.length; ci++) {
    const contig = contigs[ci];
    const plus = contig.seq, minus = revComp(plus);
    const votes = new Map<number, Bucket>();
    for (let s = 0; s < 2; s++) {
      const strand: 1 | -1 = s === 0 ? 1 : -1;
      const query = strand === 1 ? plus : minus;
      opts.onProgress?.((ci * 2 + s) / work, `seeding ${contig.name}`);
      forEachForwardKmer(query, k, (code, qPos) => {
        let j = lowerBound(keys, code);
        for (; j < keys.length && keys[j] === code; j++) {
          const refId = refIds[j];
          const bucket = Math.floor((positions[j] - qPos) / DIAGONAL_BUCKET);
          const key = refId * (1 << 22) + bucket + (1 << 21);
          const b = votes.get(key);
          if (!b) votes.set(key, { refId, bucket, strand, votes: 1, minQ: qPos, maxQ: qPos });
          else {
            b.votes++;
            if (qPos < b.minQ) b.minQ = qPos;
            if (qPos > b.maxQ) b.maxQ = qPos;
          }
        }
      });
    }

    const seeds: Bucket[] = [];
    for (const b of votes.values()) if (b.votes >= minSeeds) seeds.push(b);
    seeds.sort((a, b) => a.refId - b.refId || a.strand - b.strand || a.bucket - b.bucket);
    const cands: Bucket[] = [];
    for (const s of seeds) {
      const last = cands[cands.length - 1];
      if (last && last.refId === s.refId && last.strand === s.strand && s.bucket <= last.bucket + 1) {
        last.votes += s.votes;
        if (s.minQ < last.minQ) last.minQ = s.minQ;
        if (s.maxQ > last.maxQ) last.maxQ = s.maxQ;
      } else cands.push({ ...s });
    }
    if (cands.length > MAX_CANDIDATES_PER_CONTIG) {
      cands.sort((a, b) => b.votes - a.votes);
      cands.length = MAX_CANDIDATES_PER_CONTIG;
    }
    opts.onProgress?.((ci * 2 + 2) / work, `aligning ${cands.length} candidate loci in ${contig.name}`);

    for (const c of cands) {
      const ref = refs[c.refId];
      const query = c.strand === 1 ? plus : minus;
      const wStart = span(c.minQ - WINDOW_PAD, 0, query.length);
      // A locus can only be confirmed where it seeded: clipping the reference-length window to the seed span
      // (plus the same padding) keeps genuine hits intact and stops noise buckets costing a full-genome DP each.
      const wEnd = span(Math.min(c.minQ + ref.seq.length + WINDOW_PAD, c.maxQ + k + WINDOW_PAD), wStart, query.length);
      const window = query.slice(wStart, wEnd);
      if (window.length < k) continue;
      // align() caps its matrix; for the handful of multi-kb reference operons only the leading part can be confirmed.
      const refSeq = ref.seq.length * window.length > MAX_ALIGN_CELLS ? ref.seq.slice(0, Math.max(k, Math.floor(MAX_ALIGN_CELLS / window.length))) : ref.seq;
      const al = align(refSeq, window, { mode: 'local', kind: 'dna' });
      if (!al.length) continue;
      const refSpan = countUngapped(al.a);
      const querySpan = countUngapped(al.b);
      const identity = al.identity, coverage = refSpan / ref.seq.length;
      if (identity < minIdentity || coverage < minCoverage) continue;
      let start: number, end: number;
      if (c.strand === 1) { start = wStart + al.bStart; end = start + querySpan - 1; }
      else { end = plus.length - (wStart + al.bStart) + 1; start = end - querySpan + 1; }
      hits.push({
        gene: ref.symbol, allele: ref.allele, product: ref.product, accession: ref.accession,
        drugClass: ref.drugClass, subclass: ref.subclass, contig: contig.name,
        start, end, strand: c.strand === 1 ? '+' : '-', identity, coverage,
        score: identity * coverage, refLength: ref.seq.length,
      });
    }
  }
  opts.onProgress?.(1, 'resolving overlaps');
  return resolveOverlaps(hits, contigs.map((c) => c.name));
}

/** Overlapping loci on the same contig and strand keep the better identity·coverage hit. */
function resolveOverlaps(hits: AmrHit[], contigOrder: string[]): AmrHit[] {
  const rank = new Map(contigOrder.map((n, i) => [n, i]));
  const byQuality = [...hits].sort((a, b) => b.score - a.score || (b.end - b.start) - (a.end - a.start) || a.accession.localeCompare(b.accession));
  const kept: AmrHit[] = [];
  for (const h of byQuality) {
    const dominated = kept.some((o) => {
      if (o.contig !== h.contig || o.strand !== h.strand) return false;
      const ov = Math.min(o.end, h.end) - Math.max(o.start, h.start) + 1;
      return ov > 0.5 * Math.min(o.end - o.start + 1, h.end - h.start + 1);
    });
    if (!dominated) kept.push(h);
  }
  return kept.sort((a, b) => (rank.get(a.contig) ?? 0) - (rank.get(b.contig) ?? 0) || a.start - b.start || a.end - b.end);
}

export interface AmrDemoTruth {
  gene: string;
  allele: string;
  strand: '+' | '-';
  start: number;
  end: number;
  mutation: string;
}

/** Deterministic 20 kb random backbone (≈ 50 % GC) carrying the five genes: the first with 3 % substitutions,
 *  the second with a 3-nt deletion, alternating plus/minus strand from the first. */
export function syntheticAmrContig(refs: AmrRef[], opts: { seed?: number; length?: number } = {}): { contig: AmrContig; truth: AmrDemoTruth[] } {
  if (refs.length !== 5) throw new Error('The synthetic demo needs exactly five reference genes.');
  const length = opts.length ?? 20_000;
  let state = (opts.seed ?? 7) >>> 0 || 1;
  const rand = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const bases = 'ACGT';
  const backbone: string[] = new Array(length);
  for (let i = 0; i < length; i++) backbone[i] = bases[Math.floor(rand() * 4)];
  const starts = [600, 2800, 5200, 7600, 10500];
  const truth: AmrDemoTruth[] = [];
  refs.forEach((ref, i) => {
    let gene = ref.seq;
    let mutation = 'exact';
    if (i === 0) {
      const n = Math.floor(gene.length * 0.03);
      const picked = new Set<number>();
      while (picked.size < n) picked.add(Math.floor(rand() * gene.length));
      const arr = gene.split('');
      for (const pos of [...picked].sort((a, b) => a - b)) {
        const alts = bases.replace(arr[pos], '');
        arr[pos] = alts[Math.floor(rand() * 3)];
      }
      gene = arr.join('');
      mutation = '3 % substitutions';
    } else if (i === 1) {
      const mid = Math.floor(gene.length / 2);
      gene = gene.slice(0, mid) + gene.slice(mid + 3);
      mutation = '3-nt deletion';
    }
    const strand: '+' | '-' = i % 2 === 0 ? '+' : '-';
    const placed = strand === '+' ? gene : revComp(gene);
    const at = starts[i];
    if (at + placed.length > length) throw new Error(`Gene ${ref.symbol} does not fit in a ${length.toLocaleString()} bp demo contig.`);
    for (let j = 0; j < placed.length; j++) backbone[at + j] = placed[j];
    truth.push({ gene: ref.symbol, allele: ref.allele, strand, start: at + 1, end: at + placed.length, mutation });
  });
  return { contig: { name: 'synthetic_amr_contig', seq: backbone.join('') }, truth };
}

/** The five demo genes, by gene symbol with a prefix fallback so the demo still works if NCBI renames a family.
 *  `blaTEM-1` is deliberately not here: every one of its 15-mers occurs in more than 50 blaTEM alleles, so the
 *  mandated seed filter leaves it no k-mer to seed on. These five all survive it. */
export const DEMO_GENE_SYMBOLS = ['sul1', 'tet(A)', 'mecA', 'blaOXA-1', "aac(6')-Ib-cr"];

export function pickDemoRefs(refs: AmrRef[]): AmrRef[] {
  const out: AmrRef[] = [];
  const taken = (r: AmrRef) => out.some((o) => o.symbol === r.symbol);
  for (const symbol of DEMO_GENE_SYMBOLS) {
    const hit = refs.find((r) => r.symbol === symbol) ?? refs.find((r) => r.allele === symbol) ?? refs.find((r) => r.symbol.startsWith(symbol));
    if (hit && !taken(hit)) out.push(hit);
  }
  for (const r of refs) {
    if (out.length === 5) break;
    if (r.symbol && !taken(r)) out.push(r);
  }
  if (out.length < 5) throw new Error('The reference database does not contain five distinct genes for the demo.');
  return out.slice(0, 5);
}
