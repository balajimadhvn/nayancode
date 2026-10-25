/** Primer-pair design: enumerate candidates around a target, filter on Tm/GC/length/checks, score pairs. */
import { oligoTm, revComp } from '@/studios/sequence/kernels';
import { checkPrimer, type Risk } from './dimer';

export interface PrimerCandidate { seq: string; start: number; end: number; tm: number; gc: number }
export interface PrimerPair { f: PrimerCandidate; r: PrimerCandidate; amplicon: number; score: number }
export interface DesignOptions {
  /** Target start, 0-based inclusive. */
  start: number;
  /** Target end, 0-based exclusive. */
  end: number;
  ampMin: number;
  ampMax: number;
  tmMin?: number;
  tmMax?: number;
  lenMin?: number;
  lenMax?: number;
  gcMin?: number;
  gcMax?: number;
  maxTmDiff?: number;
}

const gcOf = (s: string) => [...s].filter((b) => b === 'G' || b === 'C').length / s.length;

/**
 * Forward candidates start in [start-150, start]; reverse candidates end in [end, end+150] on the
 * template (the reverse primer is the reverse complement of that window). Returns the best ten pairs.
 */
export function designPairs(template: string, opts: DesignOptions): PrimerPair[] {
  const T = template.toUpperCase();
  if (!/^[ACGT]+$/.test(T)) throw new Error('The template must contain only A, C, G and T (no N or ambiguity codes).');
  const { start, end, ampMin, ampMax, tmMin = 57, tmMax = 63, lenMin = 18, lenMax = 25, gcMin = 40, gcMax = 60, maxTmDiff = 2 } = opts;
  if (!(start >= 0) || !(end <= T.length) || end <= start) throw new Error('Target start and end must lie inside the template and end > start.');
  if (lenMin < 1 || lenMax < lenMin || ampMin > ampMax) throw new Error('Check the length and amplicon limits.');
  const gcLo = gcMin / 100, gcHi = gcMax / 100;

  const risks = new Map<string, Risk>();
  const candidate = (seq: string, s: number, e: number): PrimerCandidate | null => {
    const tm = oligoTm(seq).tm;
    const gc = gcOf(seq);
    if (!Number.isFinite(tm) || tm < tmMin || tm > tmMax || gc < gcLo || gc > gcHi) return null;
    const c = checkPrimer(seq);
    if (c.risk === 'high' || c.homopolymer >= 5 || c.gcClamp > 3) return null;
    risks.set(seq, c.risk);
    return { seq, start: s, end: e, tm, gc };
  };

  const fwd: PrimerCandidate[] = [], rev: PrimerCandidate[] = [];
  for (let s = Math.max(0, start - 150); s <= Math.min(start, T.length - lenMin); s++) {
    for (let len = lenMin; len <= lenMax && s + len <= T.length; len++) {
      const c = candidate(T.slice(s, s + len), s, s + len);
      if (c) fwd.push(c);
    }
  }
  for (let e = Math.max(end, lenMin); e <= Math.min(T.length, end + 150); e++) {
    for (let len = lenMin; len <= lenMax && e - len >= 0; len++) {
      const seq = revComp(T.slice(e - len, e));
      const c = candidate(seq, e - len, e);
      if (c) rev.push(c);
    }
  }

  const pairs: PrimerPair[] = [];
  for (const f of fwd) for (const r of rev) {
    const amplicon = r.end - f.start;
    if (amplicon < ampMin || amplicon > ampMax || Math.abs(f.tm - r.tm) > maxTmDiff) continue;
    const fRisk = risks.get(f.seq) ?? 'low', rRisk = risks.get(r.seq) ?? 'low';
    const score = Math.abs(f.tm - r.tm) + 0.1 * (Math.abs(f.gc * 100 - 50) + Math.abs(r.gc * 100 - 50)) + 5 * ((fRisk === 'moderate' ? 1 : 0) + (rRisk === 'moderate' ? 1 : 0));
    pairs.push({ f, r, amplicon, score });
  }
  pairs.sort((a, b) => a.score - b.score || a.f.start - b.f.start || a.r.end - b.r.end);
  return pairs.slice(0, 10);
}
