/** Genome kernels: streaming FASTQ QC, assembly metrics, interval algebra, MinHash (Mash-style) comparison. */

// ---------------- FASTQ QC ----------------
const MAXPOS = 400, QMAX = 42;
const ADAPTERS: [string, string][] = [['Illumina TruSeq', 'AGATCGGAAGAGC'], ['Nextera / Tn5', 'CTGTCTCTTATACACATCT'], ['Illumina small RNA', 'TGGAATTCTCGG']];

export class FastqQC {
  reads = 0; bases = 0; q20 = 0; q30 = 0; gcBases = 0; nBases = 0; minLen = Infinity; maxLen = 0;
  lenHist = new Map<number, number>();
  posQ = new Uint32Array(MAXPOS * QMAX); posN = new Uint32Array(MAXPOS);
  posBase = new Uint32Array(MAXPOS * 5); // A C G T N
  readQHist = new Uint32Array(QMAX); gcHist = new Uint32Array(101);
  adapterHits = ADAPTERS.map(() => 0);
  private dupSeen = new Set<string>(); private dupN = 0; private dupUnique = 0;
  trimKept = { 15: 0, 20: 0, 25: 0 } as Record<15 | 20 | 25, number>;
  addRecord(seq: string, qual: string) {
    const L = Math.min(seq.length, qual.length);
    if (!L) return;
    this.reads++; this.bases += L; this.minLen = Math.min(this.minLen, L); this.maxLen = Math.max(this.maxLen, L);
    this.lenHist.set(L, (this.lenHist.get(L) ?? 0) + 1);
    let qsum = 0, gc = 0, acgt = 0;
    for (let i = 0; i < L; i++) {
      const q = Math.min(QMAX - 1, Math.max(0, qual.charCodeAt(i) - 33)), c = seq.charCodeAt(i);
      qsum += q; if (q >= 20) this.q20++; if (q >= 30) this.q30++;
      let b = 4; if (c === 65 || c === 97) b = 0; else if (c === 67 || c === 99) { b = 1; gc++; } else if (c === 71 || c === 103) { b = 2; gc++; } else if (c === 84 || c === 116) b = 3; else this.nBases++;
      if (b < 4) acgt++;
      if (i < MAXPOS) { this.posQ[i * QMAX + q]++; this.posN[i]++; this.posBase[i * 5 + b]++; }
    }
    this.gcBases += gc;
    this.readQHist[Math.min(QMAX - 1, Math.round(qsum / L))]++;
    this.gcHist[acgt ? Math.round((gc / acgt) * 100) : 0]++;
    for (let a = 0; a < ADAPTERS.length; a++) if (seq.includes(ADAPTERS[a][1])) this.adapterHits[a]++;
    if (this.dupN < 200000) { this.dupN++; const key = seq.slice(0, 50); if (this.dupSeen.has(key)) { /* duplicate */ } else { this.dupSeen.add(key); this.dupUnique++; } }
    for (const thr of [15, 20, 25] as const) { let e = L; while (e > 0 && qual.charCodeAt(e - 1) - 33 < thr) e--; this.trimKept[thr] += e; }
  }
  result() {
    const n = Math.min(MAXPOS, this.maxLen), pos: { pos: number; mean: number; q10: number; q25: number; q50: number; q75: number; q90: number }[] = [];
    for (let i = 0; i < n; i++) {
      const total = this.posN[i]; if (!total) continue;
      let sum = 0; const qs: Record<number, number> = {}; const targets = [0.1, 0.25, 0.5, 0.75, 0.9]; let acc = 0, ti = 0;
      for (let q = 0; q < QMAX; q++) { const c = this.posQ[i * QMAX + q]; sum += q * c; acc += c; while (ti < targets.length && acc / total >= targets[ti]) qs[ti++] = q; }
      pos.push({ pos: i + 1, mean: sum / total, q10: qs[0] ?? 0, q25: qs[1] ?? 0, q50: qs[2] ?? 0, q75: qs[3] ?? 0, q90: qs[4] ?? 0 });
    }
    const comp = Array.from({ length: n }, (_, i) => { const t = this.posN[i] || 1; return { pos: i + 1, A: this.posBase[i * 5] / t, C: this.posBase[i * 5 + 1] / t, G: this.posBase[i * 5 + 2] / t, T: this.posBase[i * 5 + 3] / t, N: this.posBase[i * 5 + 4] / t }; });
    const lens = [...this.lenHist.entries()].sort((a, b) => a[0] - b[0]);
    return {
      reads: this.reads, bases: this.bases, meanLen: this.reads ? this.bases / this.reads : 0, minLen: this.reads ? this.minLen : 0, maxLen: this.maxLen,
      gc: this.bases ? this.gcBases / (this.bases - this.nBases || 1) : 0, nFrac: this.bases ? this.nBases / this.bases : 0,
      q20: this.bases ? this.q20 / this.bases : 0, q30: this.bases ? this.q30 / this.bases : 0,
      dupRate: this.dupN ? 1 - this.dupUnique / this.dupN : 0, dupSampled: this.dupN,
      pos, comp, lens, readQ: Array.from(this.readQHist), gcHist: Array.from(this.gcHist),
      adapters: ADAPTERS.map(([name], i) => ({ name, frac: this.reads ? this.adapterHits[i] / this.reads : 0 })),
      trim: ([15, 20, 25] as const).map((t) => ({ q: t, kept: this.bases ? this.trimKept[t] / this.bases : 0 })),
    };
  }
}
export type FastqResult = ReturnType<FastqQC['result']>;

/** Feed lines into a FastqQC. Returns leftover partial text. */
export class FastqLineParser {
  private buf: string[] = []; private rest = '';
  constructor(private qc: FastqQC, private onError: (m: string) => void) {}
  push(text: string) {
    const parts = (this.rest + text).split('\n'); this.rest = parts.pop() ?? '';
    for (const l of parts) this.line(l.endsWith('\r') ? l.slice(0, -1) : l);
  }
  end() { if (this.rest) this.line(this.rest); }
  private line(l: string) {
    this.buf.push(l);
    if (this.buf.length === 4) {
      const [h, s, p, q] = this.buf; this.buf = [];
      if (!h.startsWith('@') || !p.startsWith('+')) { this.onError('Not valid FASTQ near read ' + (this.qc.reads + 1)); return; }
      this.qc.addRecord(s, q);
    }
  }
}
export function fastqQcText(text: string, maxReads = Infinity): FastqResult {
  const qc = new FastqQC(); let err = ''; const p = new FastqLineParser(qc, (m) => { err = err || m; });
  p.push(text); p.end(); if (err) throw new Error(err); void maxReads; return qc.result();
}

// ---------------- Assembly ----------------
export interface AsmStats { contigs: number; total: number; longest: number; shortest: number; n50: number; n90: number; l50: number; l90: number; gc: number; nFrac: number; over1k: number; over10k: number; lengths: number[]; nx: { x: number; len: number }[]; contigTable: { id: string; length: number; gc: number; ns: number }[] }
export function assemblyStats(contigs: { id: string; seq: string }[]): AsmStats {
  if (!contigs.length) throw new Error('No sequences found.');
  const rows = contigs.map((c) => { let gc = 0, n = 0; for (const ch of c.seq) { if (ch === 'G' || ch === 'C') gc++; else if (ch === 'N') n++; } return { id: c.id, length: c.seq.length, gc: c.seq.length - n ? gc / (c.seq.length - n) : 0, ns: n }; });
  const lens = rows.map((r) => r.length).sort((a, b) => b - a), total = lens.reduce((a, b) => a + b, 0);
  const nxAt = (x: number) => { let acc = 0; for (let i = 0; i < lens.length; i++) { acc += lens[i]; if (acc >= total * x) return { len: lens[i], l: i + 1 }; } return { len: 0, l: 0 }; };
  const n50 = nxAt(0.5), n90 = nxAt(0.9);
  const gcTot = rows.reduce((a, r) => a + r.gc * (r.length - r.ns), 0), nTot = rows.reduce((a, r) => a + r.ns, 0);
  return { contigs: rows.length, total, longest: lens[0], shortest: lens[lens.length - 1], n50: n50.len, n90: n90.len, l50: n50.l, l90: n90.l, gc: gcTot / (total - nTot || 1), nFrac: nTot / total, over1k: lens.filter((l) => l >= 1000).length, over10k: lens.filter((l) => l >= 10000).length, lengths: lens, nx: Array.from({ length: 100 }, (_, i) => ({ x: i + 1, len: nxAt((i + 1) / 100).len })), contigTable: rows.sort((a, b) => b.length - a.length) };
}

// ---------------- Intervals ----------------
export interface Interval { chrom: string; start: number; end: number; name: string; strand: string }
export function parseBed(text: string): Interval[] {
  const out: Interval[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim(); if (!l || /^(track|browser|#)/.test(l)) continue;
    const f = l.split(/\t| +/); const s = +f[1], e = +f[2];
    if (f.length < 3 || !Number.isInteger(s) || !Number.isInteger(e)) throw new Error(`BED line "${l.slice(0, 40)}": need chrom, integer start, integer end.`);
    if (e < s) throw new Error(`BED line "${l.slice(0, 40)}": end < start.`);
    out.push({ chrom: f[0], start: s, end: e, name: f[3] ?? '.', strand: f[5] ?? '.' });
  }
  return out;
}
const byChrom = (a: Interval[]) => { const m = new Map<string, Interval[]>(); for (const i of a) (m.get(i.chrom) ?? m.set(i.chrom, []).get(i.chrom)!).push(i); for (const v of m.values()) v.sort((x, y) => x.start - y.start || x.end - y.end); return m; };
export function mergeIntervals(a: Interval[], gap = 0): Interval[] {
  const out: Interval[] = [];
  for (const [chrom, v] of byChrom(a)) { let cur: Interval | null = null; for (const i of v) { if (cur && i.start <= cur.end + gap) cur.end = Math.max(cur.end, i.end); else { if (cur) out.push(cur); cur = { chrom, start: i.start, end: i.end, name: '.', strand: '.' }; } } if (cur) out.push(cur); }
  return out;
}
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const bm = byChrom(mergeIntervals(b)), out: Interval[] = [];
  for (const [chrom, v] of byChrom(a)) { const bs = bm.get(chrom) ?? []; let j = 0; for (const i of v) { while (j < bs.length && bs[j].end <= i.start) j++; for (let k = j; k < bs.length && bs[k].start < i.end; k++) { const s = Math.max(i.start, bs[k].start), e = Math.min(i.end, bs[k].end); if (e > s) out.push({ chrom, start: s, end: e, name: i.name, strand: i.strand }); } } }
  return out;
}
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  const bm = byChrom(mergeIntervals(b)), out: Interval[] = [];
  for (const [chrom, v] of byChrom(mergeIntervals(a))) { const bs = bm.get(chrom) ?? []; for (const i of v) { let s = i.start; for (const x of bs) { if (x.end <= s) continue; if (x.start >= i.end) break; if (x.start > s) out.push({ chrom, start: s, end: x.start, name: '.', strand: '.' }); s = Math.max(s, x.end); } if (s < i.end) out.push({ chrom, start: s, end: i.end, name: '.', strand: '.' }); } }
  return out;
}
export const totalBp = (a: Interval[]) => mergeIntervals(a).reduce((s, i) => s + (i.end - i.start), 0);
export const jaccard = (a: Interval[], b: Interval[]) => { const i = totalBp(intersect(a, b)), u = totalBp(a) + totalBp(b) - i; return u ? i / u : 0; };
export function closest(a: Interval[], b: Interval[]): { a: Interval; b: Interval | null; dist: number }[] {
  const bm = byChrom(b);
  return a.map((x) => { const v = bm.get(x.chrom); if (!v?.length) return { a: x, b: null, dist: Infinity }; let best: Interval | null = null, bd = Infinity; for (const y of v) { const d = y.end <= x.start ? x.start - y.end : y.start >= x.end ? y.start - x.end : 0; if (d < bd) { bd = d; best = y; } if (y.start > x.end && d > bd) break; } return { a: x, b: best, dist: bd }; });
}
export function summariseGff(text: string) {
  const types = new Map<string, { n: number; bp: number }>(), chroms = new Set<string>();
  for (const l of text.split(/\r?\n/)) { if (!l || l[0] === '#') continue; const f = l.split('\t'); if (f.length < 8) continue; const t = types.get(f[2]) ?? types.set(f[2], { n: 0, bp: 0 }).get(f[2])!; t.n++; t.bp += +f[4] - +f[3] + 1; chroms.add(f[0]); }
  if (!types.size) throw new Error('No GFF/GTF feature lines found (need 9 tab-separated columns).');
  return { chroms: chroms.size, types: [...types.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.n - a.n) };
}

// ---------------- MinHash (Mash-style bottom-s sketch) ----------------
function mix(h: number): number { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
export function sketch(seq: string, k = 16, size = 2000): Uint32Array {
  if (k > 16) throw new Error('k ≤ 16 supported (32-bit exact k-mers).');
  const mask = k === 16 ? 0xffffffff : (1 << (2 * k)) - 1;
  let fwd = 0, rev = 0, valid = 0; const hashes: number[] = [];
  const shift = 2 * (k - 1);
  for (let i = 0; i < seq.length; i++) {
    const c = seq.charCodeAt(i) & 0xdf; const v = c === 65 ? 0 : c === 67 ? 1 : c === 71 ? 2 : c === 84 ? 3 : -1;
    if (v < 0) { valid = 0; fwd = rev = 0; continue; }
    fwd = ((fwd << 2) | v) & mask; rev = ((rev >>> 2) | ((3 - v) << shift)) >>> 0; valid++;
    if (valid >= k) hashes.push(mix(Math.min(fwd >>> 0, rev >>> 0)));
  }
  const arr = Uint32Array.from(hashes).sort(); const out: number[] = [];
  for (let i = 0; i < arr.length && out.length < size; i++) if (i === 0 || arr[i] !== arr[i - 1]) out.push(arr[i]);
  return Uint32Array.from(out);
}
export function mashDistance(a: Uint32Array, b: Uint32Array, k = 16, size = 2000): { jaccard: number; distance: number; ani: number } {
  let i = 0, j = 0, shared = 0, seen = 0;
  while (seen < size && i < a.length && j < b.length) { if (a[i] === b[j]) { shared++; i++; j++; } else if (a[i] < b[j]) i++; else j++; seen++; }
  const jac = seen ? shared / seen : 0;
  const d = jac === 0 ? 1 : Math.min(1, Math.max(0, -Math.log((2 * jac) / (1 + jac)) / k));
  return { jaccard: jac, distance: d, ani: 1 - d };
}

// ---------------- demo data (synthetic) ----------------
const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
export function syntheticFastq(n = 20000, len = 150, seed = 11): string {
  const r = rng(seed), out: string[] = [], B = 'ACGT', ad = 'AGATCGGAAGAGC';
  for (let i = 0; i < n; i++) {
    let s = ''; for (let k = 0; k < len; k++) s += B[Math.floor(r() * 4)];
    if (r() < 0.08) { const cut = 60 + Math.floor(r() * 70); s = s.slice(0, cut) + ad.repeat(2).slice(0, len - cut); }
    let q = ''; for (let k = 0; k < len; k++) { const base = 38 - (k / len) * 14 - (k > len * 0.85 ? (k - len * 0.85) * 0.4 : 0); const v = Math.max(2, Math.min(41, Math.round(base + (r() - 0.5) * 8))); q += String.fromCharCode(33 + v); }
    out.push(`@read${i + 1}/1\n${s}\n+\n${q}`);
  }
  return out.join('\n') + '\n';
}
export function syntheticGenomes(seed = 5, len = 120000): { id: string; seq: string }[] {
  const r = rng(seed), B = 'ACGT'; let base = ''; for (let i = 0; i < len; i++) base += B[Math.floor(r() * 4)];
  const mut = (s: string, rate: number) => { const a = s.split(''); for (let i = 0; i < a.length; i++) if (r() < rate) a[i] = B[(B.indexOf(a[i]) + 1 + Math.floor(r() * 3)) % 4]; return a.join(''); };
  const alt = (() => { let s = ''; for (let i = 0; i < len; i++) s += B[Math.floor(r() * 4)]; return s; })();
  return [{ id: 'strain_A', seq: base }, { id: 'strain_B_1pct', seq: mut(base, 0.01) }, { id: 'strain_C_5pct', seq: mut(base, 0.05) }, { id: 'strain_D_10pct', seq: mut(base, 0.10) }, { id: 'unrelated', seq: alt }];
}
export function syntheticAssembly(seed = 9): string {
  const r = rng(seed), B = 'ACGT'; const out: string[] = [];
  for (let i = 0; i < 60; i++) { const len = Math.round(Math.exp(7 + r() * 5.2)); let s = ''; for (let k = 0; k < len; k++) s += r() < 0.0004 ? 'N' : B[Math.floor(r() * 4)]; out.push(`>contig_${i + 1} len=${len}\n${s.replace(/(.{80})/g, '$1\n')}`); }
  return out.join('\n') + '\n';
}
export function syntheticBed(seed = 21, n = 400, shift = 0): string {
  const r = rng(seed), out: string[] = [];
  for (let i = 0; i < n; i++) { const c = 'chr' + (1 + Math.floor(r() * 3)); const s = Math.floor(r() * 2_000_000) + shift; out.push(`${c}\t${s}\t${s + 200 + Math.floor(r() * 800)}\tpeak${i + 1}\t0\t${r() < 0.5 ? '+' : '-'}`); }
  return out.join('\n') + '\n';
}
