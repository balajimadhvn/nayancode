/** Heuristic primer checks: hairpin, self-dimer, pair-dimer, GC clamp and homopolymers. No free energies. */
import { revComp } from '@/studios/sequence/kernels';

export type Risk = 'low' | 'moderate' | 'high';
export interface Hairpin { stem: number; positions: [number, number] }
export interface PrimerCheck {
  seq: string;
  length: number;
  gc: number;
  gcClamp: number;
  gcClampFlag: boolean;
  homopolymer: number;
  homopolymerFlag: boolean;
  hairpin: Hairpin | null;
  selfDimer: number;
  end3Run: number;
  risk: Risk;
}
export interface PairCheck {
  f: PrimerCheck;
  r: PrimerCheck;
  pairDimer: number;
  end3Run: number;
  risk: Risk;
}

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const isComp = (a: string, b: string) => COMP[a] === b;
const clean = (s: string) => s.toUpperCase().replace(/[^ACGT]/g, '');

/** Longest run of one base. */
export function homopolymer(seq: string): number {
  let best = 0, run = 1;
  for (let i = 1; i < seq.length; i++) { run = seq[i] === seq[i - 1] ? run + 1 : 1; if (run > best) best = run; }
  return seq.length ? Math.max(1, best) : 0;
}

/** Longest stem (>= 4 nt) whose downstream reverse complement is separated by a loop of >= 3 nt. */
export function hairpin(seq: string): Hairpin | null {
  for (let stem = Math.floor(seq.length / 2); stem >= 4; stem--) {
    for (let i = 0; i + stem + 3 + stem <= seq.length; i++) {
      const rc = revComp(seq.slice(i, i + stem));
      const j = seq.indexOf(rc, i + stem + 3);
      if (j >= 0 && j + stem <= seq.length) return { stem, positions: [i + 1, j + 1] };
    }
  }
  return null;
}

/** Best antiparallel overlap of a against b, plus the longest run that contains either 3′ end. */
export function dimerRuns(a: string, b: string): { run: number; end3Run: number } {
  const rb = [...b].reverse().join('');
  let best = 0, end3 = 0;
  for (let d = -(a.length - 1); d <= b.length - 1; d++) {
    const i0 = Math.max(0, -d), i1 = Math.min(a.length, b.length - d);
    let run = 0, hasA = false, hasB = false;
    for (let i = i0; i < i1; i++) {
      const j = i + d;
      if (isComp(a[i], rb[j])) {
        run++;
        if (i === a.length - 1) hasA = true;
        if (j === 0) hasB = true;
        if (run > best) best = run;
        if ((hasA || hasB) && run > end3) end3 = run;
      } else { run = 0; hasA = false; hasB = false; }
    }
  }
  return { run: best, end3Run: end3 };
}

const riskOf = (run: number, end3Run: number): Risk =>
  end3Run >= 4 || run >= 8 ? 'high' : end3Run === 3 || run >= 6 ? 'moderate' : 'low';

export function checkPrimer(input: string): PrimerCheck {
  const seq = clean(input);
  if (seq.length !== input.trim().length || !seq.length) throw new Error('Primer must contain only A, C, G and T.');
  const gc = [...seq].filter((b) => b === 'G' || b === 'C').length / seq.length;
  const gcClamp = [...seq.slice(-5)].filter((b) => b === 'G' || b === 'C').length;
  const hp = homopolymer(seq);
  const hair = hairpin(seq);
  const { run, end3Run } = dimerRuns(seq, seq);
  return {
    seq, length: seq.length, gc, gcClamp, gcClampFlag: gcClamp > 3,
    homopolymer: hp, homopolymerFlag: hp >= 5, hairpin: hair,
    selfDimer: run, end3Run, risk: riskOf(run, end3Run),
  };
}

export function checkPair(f: string, r: string): PairCheck {
  const F = checkPrimer(f), R = checkPrimer(r);
  const { run, end3Run } = dimerRuns(F.seq, R.seq);
  return { f: F, r: R, pairDimer: run, end3Run, risk: riskOf(run, end3Run) };
}
