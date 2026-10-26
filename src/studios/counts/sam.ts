/** SAM text parsing and alignment-block arithmetic (1-based, inclusive reference coordinates).
 *  N (splice) and D (deletion) split aligned blocks; I, S, H and P consume no reference. */

export const SAM_UNMAPPED = 4;
export const SAM_PAIRED = 1;
export const SAM_PROPER = 2;
export const SAM_REVERSE = 16;
export const SAM_READ1 = 64;
export const SAM_READ2 = 128;
export const SAM_SECONDARY = 256;
export const SAM_QCFAIL = 512;
export const SAM_DUPLICATE = 1024;
export const SAM_SUPPLEMENTARY = 2048;

export interface SamRecord {
  qname: string; flag: number; rname: string; pos: number; mapq: number; cigar: string;
  rnext: string; pnext: number; tlen: number; seq: string; qual: string; tags: string[];
}

export interface CigarOp { len: number; op: string }

export function parseCigar(cigar: string): CigarOp[] {
  if (!cigar || cigar === '*') return [];
  const out: CigarOp[] = [];
  for (const m of cigar.matchAll(/(\d+)([MIDNSHP=X])/g)) out.push({ len: Number(m[1]), op: m[2] });
  if (out.reduce((a, o) => a + String(o.len).length + 1, 0) !== cigar.length) throw new Error(`Invalid CIGAR "${cigar}"`);
  return out;
}

/** Aligned reference blocks for a 1-based POS and CIGAR, inclusive. */
export function refSpans(pos: number, cigar: string): [number, number][] {
  const blocks: [number, number][] = [];
  let p = pos;
  for (const { len, op } of parseCigar(cigar)) {
    if (op === 'M' || op === '=' || op === 'X') { blocks.push([p, p + len - 1]); p += len; }
    else if (op === 'D' || op === 'N') p += len;
  }
  return blocks;
}

/** Parse one non-header SAM line. Throws on a malformed line instead of silently dropping it. */
export function parseSamLine(line: string): SamRecord {
  const f = line.replace(/\r$/, '').split('\t');
  if (f.length < 11) throw new Error(`SAM line has ${f.length} fields (expected at least 11)`);
  const pos = Number(f[3]), mapq = Number(f[4]), flag = Number(f[1]), tlen = Number(f[8]);
  if (!Number.isFinite(pos) || !Number.isFinite(mapq) || !Number.isFinite(flag)) throw new Error('SAM line has a non-numeric POS, MAPQ or FLAG');
  return { qname: f[0], flag, rname: f[2], pos, mapq, cigar: f[5], rnext: f[6], pnext: Number(f[7]) || 0, tlen: Number.isFinite(tlen) ? tlen : 0, seq: f[9], qual: f[10], tags: f.slice(11) };
}

export const strandOf = (flag: number): '+' | '-' => (flag & SAM_REVERSE ? '-' : '+');
export const isUnmapped = (r: SamRecord) => (r.flag & SAM_UNMAPPED) !== 0 || r.rname === '*' || r.pos <= 0 || r.cigar === '*';

export interface SamFilter {
  /** Skip duplicate-marked records (flag 1024). Off by default, like featureCounts. */
  skipDuplicates?: boolean;
  /** For paired reads count read 1 only (the chosen fragment rule). */
  pairedRead1Only?: boolean;
}

/** Default filters: unmapped, secondary, supplementary and QC-fail records are never counted. */
export function passesFilter(r: SamRecord, o: SamFilter = {}): boolean {
  const bad = SAM_UNMAPPED | SAM_SECONDARY | SAM_SUPPLEMENTARY | SAM_QCFAIL;
  if (r.flag & bad) return false;
  if (o.skipDuplicates && (r.flag & SAM_DUPLICATE)) return false;
  if (o.pairedRead1Only !== false && (r.flag & SAM_PAIRED) && !(r.flag & SAM_READ1)) return false;
  return true;
}

/** Reference length covered by an alignment (sum of aligned blocks, excluding N/D). */
export const alignedLength = (r: SamRecord) => refSpans(r.pos, r.cigar).reduce((a, [s, e]) => a + e - s + 1, 0);

/** 5' reference base of a read (forward: leftmost mapped base; reverse: rightmost mapped base). */
export function fivePrime(r: SamRecord): number {
  const b = refSpans(r.pos, r.cigar);
  if (!b.length) return r.pos;
  return r.flag & SAM_REVERSE ? b[b.length - 1][1] : b[0][0];
}

/** Fragment midpoint for a paired record with a usable TLEN; null when it is not informative. */
export function templateMidpoint(r: SamRecord): number | null {
  if (!(r.flag & SAM_PAIRED) || !r.tlen) return null;
  const left = Math.min(r.pos, r.pos + r.tlen), right = Math.max(r.pos, r.pos + r.tlen) - 1;
  return Math.round((left + right) / 2);
}
