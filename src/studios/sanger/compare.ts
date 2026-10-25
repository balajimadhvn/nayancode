/** Compare a Sanger read with a reference by local alignment, in either orientation. */
import { align, revComp } from '@/studios/sequence/kernels';

export interface Difference {
  refPos: number;
  ref: string;
  read: string;
  type: 'sub' | 'ins' | 'del';
  quality?: number;
}
export interface CompareOptions {
  /** 0-based half-open kept range from the trim tab. */
  trimmed?: [number, number];
  quality?: number[];
}
export interface CompareResult {
  orientation: '+' | '-';
  /** Fraction of aligned columns that are identical (0-1). */
  identity: number;
  score: number;
  refStart: number;
  refEnd: number;
  differences: Difference[];
  alignedRead: string;
  alignedRef: string;
}

function differencesOf(aln: ReturnType<typeof align>, quality: number[]): Difference[] {
  const out: Difference[] = [];
  let refPos = aln.bStart, readIndex = aln.aStart - 1;
  for (let k = 0; k < aln.a.length; k++) {
    const r = aln.a[k], f = aln.b[k];
    const q = r !== '-' ? quality[readIndex] : undefined;
    if (r !== '-') readIndex++;
    if (f === '-') {
      out.push({ refPos, ref: '-', read: r, type: 'ins', ...(q !== undefined ? { quality: q } : {}) });
    } else {
      if (r === '-') out.push({ refPos, ref: f, read: '-', type: 'del', ...(q !== undefined ? { quality: q } : {}) });
      else if (r !== f) out.push({ refPos, ref: f, read: r, type: 'sub', ...(q !== undefined ? { quality: q } : {}) });
      refPos++;
    }
  }
  return out;
}

/** Forward and reverse-complement local alignments are both tried; the higher score wins. */
export function compareToReference(bases: string, reference: string, opts: CompareOptions = {}): CompareResult {
  const ref = reference.toUpperCase().replace(/[^ACGTN]/g, '');
  const [lo, hi] = opts.trimmed ?? [0, bases.length];
  const read = bases.slice(Math.max(0, lo), Math.min(bases.length, hi)).toUpperCase().replace(/[^ACGTN]/g, '');
  const q = opts.quality ? opts.quality.slice(Math.max(0, lo), Math.min(bases.length, hi)) : [];
  if (!read.length) throw new Error('The read is empty after trimming.');
  if (!ref.length) throw new Error('The reference sequence is empty.');
  const rc = revComp(read);
  const forward = align(read, ref, { mode: 'local', kind: 'dna' });
  const reverse = align(rc, ref, { mode: 'local', kind: 'dna' });
  const useReverse = reverse.score > forward.score;
  const aln = useReverse ? reverse : forward;
  const orientedQ = useReverse ? [...q].reverse() : q;
  const refBases = [...aln.b].filter((c) => c !== '-').length;
  return {
    orientation: useReverse ? '-' : '+',
    identity: aln.identity,
    score: aln.score,
    refStart: aln.bStart,
    refEnd: aln.bStart + refBases - 1,
    differences: differencesOf(aln, orientedQ),
    alignedRead: aln.a,
    alignedRef: aln.b,
  };
}
