/** Amplicon primer matching, filtering, dereplication and UNOISE-style denoising. */
import { expectedErrors } from '../reads/trim';
import type { FastqRecord } from '../reads/fastq';

const IUPAC: Record<string, string> = { A: 'A', C: 'C', G: 'G', T: 'T', R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT' };

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N' };

/** Reverse complement that keeps IUPAC ambiguity codes (e.g. 806R ends in W → R). */
export function revCompIupac(seq: string): string {
  let out = '';
  for (let i = seq.length - 1; i >= 0; i--) out += COMP[seq[i].toUpperCase()] ?? 'N';
  return out;
}

/** True when a called base is allowed by an IUPAC code (N matches everything). */
export function iupacMatch(base: string, code: string): boolean {
  const set = IUPAC[code.toUpperCase()];
  return !!set && set.includes(base.toUpperCase());
}

/** Find a primer in the first `window` bases (or anywhere), IUPAC-aware, up to maxMismatch substitutions. */
export function findPrimer(seq: string, primer: string, opts: { maxMismatch?: number; window?: number; anywhere?: boolean } = {}): number {
  const maxMismatch = opts.maxMismatch ?? 2, L = primer.length, limit = opts.anywhere ? seq.length - L : Math.min(seq.length - L, (opts.window ?? 30) - 1);
  for (let pos = 0; pos <= limit; pos++) {
    let mm = 0;
    for (let i = 0; i < L; i++) {
      if (!iupacMatch(seq[pos + i], primer[i])) { mm++; if (mm > maxMismatch) break; }
    }
    if (mm <= maxMismatch) return pos;
  }
  return -1;
}

/** Remove a primer at the 5' end (keeping the insert) or a reverse primer found downstream. */
export function trimPrimer(rec: FastqRecord, primer: string, opts: { maxMismatch?: number; anywhere?: boolean } = {}): FastqRecord | null {
  const pos = findPrimer(rec.seq, primer, opts);
  if (pos < 0) return null;
  const cut = pos + primer.length;
  return { ...rec, seq: rec.seq.slice(cut), qual: rec.qual.slice(cut) };
}

/** Keep the insert before a 3' reverse primer. */
export function cutAtPrimer(rec: FastqRecord, primer: string, maxMismatch = 2): FastqRecord {
  const pos = findPrimer(rec.seq, primer, { maxMismatch, anywhere: true });
  return pos < 0 ? rec : { ...rec, seq: rec.seq.slice(0, pos), qual: rec.qual.slice(0, pos) };
}

/** Amplicon filter: no N, expected errors <= maxEE, and length within ±20 % of the median. */
export function passesFilter(rec: FastqRecord, median: number, maxEE = 1): boolean {
  if (/N/i.test(rec.seq)) return false;
  if (expectedErrors(rec.qual) > maxEE) return false;
  return !median || Math.abs(rec.seq.length - median) <= 0.2 * median;
}

export function medianLength(lengths: number[]): number {
  if (!lengths.length) return 0;
  const s = [...lengths].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface UniqueSeq { seq: string; count: number; samples: Map<string, number> }

/** Collapse identical sequences, keeping per-sample counts. */
export function dereplicate(reads: { seq: string; sample: string }[]): UniqueSeq[] {
  const map = new Map<string, UniqueSeq>();
  for (const r of reads) {
    let u = map.get(r.seq);
    if (!u) { u = { seq: r.seq, count: 0, samples: new Map() }; map.set(r.seq, u); }
    u.count++; u.samples.set(r.sample, (u.samples.get(r.sample) ?? 0) + 1);
  }
  return [...map.values()];
}

/** Banded edit distance, or max+1 when the true distance exceeds max. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === b.length) {
    let mm = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) mm++; if (mm > max) return max + 1; }
    return mm;
  }
  const n = a.length, m = b.length;
  let prev = new Int32Array(m + 1).fill(max + 1);
  for (let j = 0; j <= Math.min(m, max); j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    const cur = new Int32Array(m + 1).fill(max + 1);
    if (i <= max) cur[0] = i;
    let rowMin = cur[0];
    for (let j = Math.max(1, i - max); j <= Math.min(m, i + max); j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[m] <= max ? prev[m] : max + 1;
}

export interface DenoiseOpts { minSize?: number; alpha?: number; maxEdits?: number }
export interface DenoiseResult { asvs: UniqueSeq[]; merged: number; dropped: number }

/**
 * UNOISE-style denoising: a sequence whose abundance is below the skew bound of
 * an accepted, more abundant sequence is merged into the closest such parent.
 * Otherwise it becomes an ASV only when its abundance reaches minSize.
 * Equal-length parents are found through an 8-mer block index (maxEdits + 1
 * blocks): by pigeonhole, a Hamming distance ≤ maxEdits leaves one block exact.
 */
export function denoise(unique: UniqueSeq[], opts: DenoiseOpts = {}): DenoiseResult {
  const minSize = opts.minSize ?? 8, alpha = opts.alpha ?? 2, maxEdits = opts.maxEdits ?? 4;
  const sorted = [...unique].sort((a, b) => b.count - a.count || a.seq.localeCompare(b.seq));
  const asvs: UniqueSeq[] = [], byLen = new Map<number, UniqueSeq[]>(), blocks = new Map<string, UniqueSeq[]>();
  const nBlocks = maxEdits + 1;
  const blockKeys = (seq: string) => {
    const out: string[] = [], L = seq.length;
    for (let i = 0; i < nBlocks; i++) {
      const s = Math.floor((i * L) / nBlocks), e = Math.floor(((i + 1) * L) / nBlocks);
      out.push(`${L}|${i}|${seq.slice(s, e)}`);
    }
    return out;
  };
  let merged = 0, dropped = 0;
  for (const cand of sorted) {
    let best: UniqueSeq | null = null, bestD = maxEdits + 1;
    const seen = new Set<UniqueSeq>();
    if (cand.seq.length >= nBlocks * 4) for (const k of blockKeys(cand.seq)) for (const p of blocks.get(k) ?? []) seen.add(p);
    else for (const p of byLen.get(cand.seq.length) ?? []) seen.add(p);
    for (let len = cand.seq.length - maxEdits; len <= cand.seq.length + maxEdits; len++) {
      if (len === cand.seq.length) continue;
      for (const parent of byLen.get(len) ?? []) seen.add(parent);
    }
    for (const parent of seen) {
      const d = editDistance(cand.seq, parent.seq, maxEdits);
      if (d > maxEdits || d >= bestD) continue;
      const bound = parent.count * 2 ** (-(alpha * d + 1));
      if (cand.count <= bound) { best = parent; bestD = d; }
    }
    if (best) {
      best.count += cand.count;
      for (const [s, n] of cand.samples) best.samples.set(s, (best.samples.get(s) ?? 0) + n);
      merged++;
    } else if (cand.count >= minSize) {
      const a: UniqueSeq = { seq: cand.seq, count: cand.count, samples: new Map(cand.samples) };
      asvs.push(a);
      const list = byLen.get(a.seq.length) ?? []; list.push(a); byLen.set(a.seq.length, list);
      for (const k of blockKeys(a.seq)) { const l = blocks.get(k) ?? []; l.push(a); blocks.set(k, l); }
    } else dropped++;
  }
  return { asvs, merged, dropped };
}
