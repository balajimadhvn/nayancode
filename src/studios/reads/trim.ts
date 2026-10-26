/** Pure single-read trimming and filtering (cutadapt / fastp style). */
import { phred, type FastqRecord } from './fastq';

export const ADAPTERS = {
  truseq: 'AGATCGGAAGAGC',
  nextera: 'CTGTCTCTTATACACATCT',
  smallrna: 'TGGAATTCTCGGGTGCCAAGG',
} as const;
export type AdapterPreset = keyof typeof ADAPTERS | 'none' | 'custom';

export type FilterReason = 'too_short' | 'too_many_n' | 'low_mean_q' | 'too_many_errors';

export interface FilterOpts {
  minLen?: number;
  maxN?: number;
  minMeanQ?: number;
  maxExpectedErrors?: number;
}

/** Number of bases to keep after 3' quality trimming (BWA/cutadapt algorithm). */
export function qualityTrim3(qual: string, cutoff = 20): number {
  let sum = 0, best = 0, bestJ = qual.length;
  for (let j = qual.length - 1; j >= 0; j--) {
    sum += cutoff - phred(qual[j]);
    if (sum > best) { best = sum; bestJ = j; }
  }
  return best > 0 ? bestJ : qual.length;
}

/**
 * Leftmost 3' adapter match, allowing the adapter (or its prefix) to run off
 * the end of the read. Substitutions only; overlap >= minOverlap.
 */
export function trimAdapter3(seq: string, adapter: string, opts: { maxErrorRate?: number; minOverlap?: number } = {}): number {
  const maxErrorRate = opts.maxErrorRate ?? 0.1, minOverlap = opts.minOverlap ?? 3;
  if (!adapter) return seq.length;
  for (let pos = 0; pos < seq.length; pos++) {
    const overlap = Math.min(adapter.length, seq.length - pos);
    if (overlap < minOverlap) continue;
    let mm = 0;
    for (let i = 0; i < overlap; i++) if (seq[pos + i] !== adapter[i]) mm++;
    if (mm <= maxErrorRate * overlap) return pos;
  }
  return seq.length;
}

/** Remove a 3' poly-G run of at least minRun bases (NovaSeq two-colour artefact). */
export function trimPolyG(seq: string, minRun = 10): number {
  let n = 0;
  while (n < seq.length && seq[seq.length - 1 - n] === 'G') n++;
  return n >= minRun ? seq.length - n : seq.length;
}

export function expectedErrors(qual: string): number {
  let ee = 0;
  for (let i = 0; i < qual.length; i++) ee += 10 ** (-phred(qual[i]) / 10);
  return ee;
}

export function meanQuality(qual: string): number {
  if (!qual.length) return 0;
  let s = 0;
  for (let i = 0; i < qual.length; i++) s += phred(qual[i]);
  return s / qual.length;
}

/** Return the first failed filter reason, or null when the record passes. */
export function filterRecord(rec: FastqRecord, opts: FilterOpts = {}): FilterReason | null {
  const minLen = opts.minLen ?? 30, maxN = opts.maxN ?? 5, minMeanQ = opts.minMeanQ ?? 0, maxEE = opts.maxExpectedErrors ?? Infinity;
  if (rec.seq.length < minLen) return 'too_short';
  let n = 0;
  for (let i = 0; i < rec.seq.length; i++) if (rec.seq[i] === 'N' || rec.seq[i] === 'n') n++;
  if (n > maxN) return 'too_many_n';
  if (meanQuality(rec.qual) < minMeanQ) return 'low_mean_q';
  if (expectedErrors(rec.qual) > maxEE) return 'too_many_errors';
  return null;
}

export interface TrimOpts extends FilterOpts {
  adapterPreset?: AdapterPreset;
  adapter?: string;
  polyG?: boolean;
  qualityCutoff?: number;
}

export interface ProcessResult {
  rec: FastqRecord | null;
  reason: FilterReason | null;
  adapterTrimmed: number;
  polyGTrimmed: number;
  qualityTrimmed: number;
}

export interface TrimCounters {
  in: number; kept: number; adapter: number; polyG: number; quality: number;
  too_short: number; too_many_n: number; low_mean_q: number; too_many_errors: number;
}
export const newCounters = (): TrimCounters => ({ in: 0, kept: 0, adapter: 0, polyG: 0, quality: 0, too_short: 0, too_many_n: 0, low_mean_q: 0, too_many_errors: 0 });
export function tally(c: TrimCounters, r: ProcessResult): void {
  c.in++;
  if (r.rec) { c.kept++; return; }
  if (r.reason) c[r.reason]++;
}

const kept = (r: FastqRecord, cut: number): FastqRecord => ({ ...r, seq: r.seq.slice(0, cut), qual: r.qual.slice(0, cut) });

/** Apply adapter, poly-G and quality trimming, then the filters. */
export function processRecord(rec: FastqRecord, opts: TrimOpts = {}): ProcessResult {
  let cur = rec, adapterTrimmed = 0, polyGTrimmed = 0, qualityTrimmed = 0;
  const adapter = opts.adapterPreset && opts.adapterPreset !== 'none' ? (opts.adapterPreset === 'custom' ? (opts.adapter ?? '') : ADAPTERS[opts.adapterPreset]) : '';
  if (adapter) {
    const cut = trimAdapter3(cur.seq, adapter);
    if (cut < cur.seq.length) { adapterTrimmed = cur.seq.length - cut; cur = kept(cur, cut); }
  }
  if (opts.polyG) {
    const cut = trimPolyG(cur.seq);
    if (cut < cur.seq.length) { polyGTrimmed = cur.seq.length - cut; cur = kept(cur, cut); }
  }
  if (opts.qualityCutoff !== undefined && opts.qualityCutoff > 0) {
    const cut = qualityTrim3(cur.qual, opts.qualityCutoff);
    if (cut < cur.seq.length) { qualityTrimmed = cur.seq.length - cut; cur = kept(cur, cut); }
  }
  const reason = filterRecord(cur, opts);
  return { rec: reason ? null : cur, reason, adapterTrimmed, polyGTrimmed, qualityTrimmed };
}
