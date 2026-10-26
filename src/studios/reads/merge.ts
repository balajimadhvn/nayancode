/** Paired-end overlap merging with quality-aware mismatch resolution. */
import { phred, type FastqRecord } from './fastq';
import { ADAPTERS, trimAdapter3 } from './trim';

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
export function revComp(s: string): string {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += COMP[s[i].toUpperCase()] ?? 'N';
  return out;
}

/** Remove a known 3' adapter from a read (>= 8 bp, so random 3-mers are not clipped). */
function stripAdapter(r: FastqRecord): FastqRecord {
  let best = r;
  for (const adapter of Object.values(ADAPTERS)) {
    const cut = trimAdapter3(r.seq, adapter, { minOverlap: 8 });
    if (cut < best.seq.length) best = { ...r, seq: r.seq.slice(0, cut), qual: r.qual.slice(0, cut) };
  }
  return best;
}

const qChar = (q: number) => String.fromCharCode(33 + Math.max(0, Math.min(41, Math.round(q))));

/**
 * Merge a pair by finding the longest valid suffix/prefix overlap. Ties favour
 * the longer overlap, then the fewer mismatches. Read-through adapters are
 * removed first, so a merged read may be shorter than either input read.
 */
export function mergePair(r1: FastqRecord, r2: FastqRecord, opts: { minOverlap?: number; maxMismatchRate?: number } = {}): FastqRecord | null {
  const minOverlap = opts.minOverlap ?? 10, maxRate = opts.maxMismatchRate ?? 0.1;
  const a = stripAdapter(r1), b = stripAdapter(r2);
  const rc2 = revComp(b.seq), q2 = b.qual.split('').reverse().join('');
  const maxO = Math.min(a.seq.length, rc2.length);
  let chosen = -1, chosenMM = Infinity;
  for (let o = maxO; o >= minOverlap; o--) {
    const off = a.seq.length - o;
    let mm = 0;
    for (let i = 0; i < o; i++) if (a.seq[off + i] !== rc2[i]) mm++;
    if (mm <= maxRate * o && (o > chosen || (o === chosen && mm < chosenMM))) { chosen = o; chosenMM = mm; }
  }
  if (chosen < 0) return null;
  const off = a.seq.length - chosen;
  let midSeq = '', midQual = '';
  for (let i = 0; i < chosen; i++) {
    const b1 = a.seq[off + i], b2 = rc2[i], q1 = phred(a.qual[off + i]), q2v = phred(q2[i]);
    if (b1 === b2) { midSeq += b1; midQual += qChar(Math.min(41, q1 + q2v)); }
    else if (q1 >= q2v) { midSeq += b1; midQual += a.qual[off + i]; }
    else { midSeq += b2; midQual += q2[i]; }
  }
  return {
    id: r1.id.replace(/\/1$/, ''),
    desc: `merged from ${r1.id} and ${r2.id} (overlap ${chosen}, ${chosenMM} mismatch${chosenMM === 1 ? '' : 'es'})`,
    seq: a.seq.slice(0, off) + midSeq + rc2.slice(chosen),
    qual: a.qual.slice(0, off) + midQual + q2.slice(chosen),
  };
}
