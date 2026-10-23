/**
 * Peptide fragment ions (Roepstorff & Fohlman 1984 nomenclature) and
 * cyclisation / disulfide mass shifts. Neutral fragment masses use the NIST
 * monoisotopic residue table shared with the proteomics kernels.
 */
import { MONO, PROTON, WATER } from '@/studios/sequence/proteomics';
import { cleanSequence } from './props';

export const H2O = WATER;
export const NH3 = 17.02654910;
/** Loss of CO (a ion relative to b). */
export const CO = 27.99491463;
/** One disulfide bond: −2 H. */
export const DISULFIDE = 2 * 1.00782503;

export type IonType = 'b' | 'y' | 'a';

/** A fixed modification at a 1-based residue position. */
export interface Mod { position: number; delta: number; name?: string }

export interface FragOptions {
  ionTypes?: IonType[];
  charges?: number[];
  mods?: Mod[];
}

export interface FragmentIon {
  type: IonType;
  /** Number of residues in the fragment (1-based, 1 … n−1). */
  index: number;
  z: number;
  /** Neutral fragment mass (before adding z protons). */
  neutralMass: number;
  mz: number;
  /** m/z after loss of water (b/y) or ammonia. */
  mzH2O: number;
  mzNH3: number;
  label: string;
}

export const residueMass = (seq: string): number => {
  let m = 0;
  for (const c of seq) {
    const v = MONO[c];
    if (v === undefined) throw new Error(`Unknown residue "${c}".`);
    m += v;
  }
  return m;
};

const modsIn = (mods: Mod[], from: number, to: number): number => {
  let d = 0;
  for (const m of mods) if (m.position >= from && m.position <= to) d += m.delta;
  return d;
};

/** b, y and a fragment ions with optional neutral losses and modifications. */
export function fragmentIons(seqInput: string, o: FragOptions = {}): FragmentIon[] {
  const seq = cleanSequence(seqInput);
  const n = seq.length;
  const types = o.ionTypes ?? ['b', 'y', 'a'];
  const charges = o.charges ?? [1];
  const mods = o.mods ?? [];
  for (const m of mods) if (!Number.isInteger(m.position) || m.position < 1 || m.position > n) throw new Error(`Modification position ${m.position} is outside the peptide (1–${n}).`);
  const mono = [...seq].map((c) => MONO[c]);
  const prefix = [0];
  for (let i = 0; i < n; i++) prefix.push(prefix[i] + mono[i]);
  const suffix = [0];
  for (let i = 0; i < n; i++) suffix.push(suffix[i] + mono[n - 1 - i]);

  const out: FragmentIon[] = [];
  for (const type of types) {
    for (let i = 1; i <= n - 1; i++) {
      let neutral: number;
      if (type === 'b' || type === 'a') neutral = prefix[i] + modsIn(mods, 1, i);
      else neutral = suffix[i] + WATER + modsIn(mods, n - i + 1, n);
      if (type === 'a') neutral -= CO;
      for (const z of charges) {
        const mz = (neutral + z * PROTON) / z;
        const mzLoss = (loss: number) => (neutral - loss + z * PROTON) / z;
        out.push({ type, index: i, z, neutralMass: neutral, mz, mzH2O: mzLoss(H2O), mzNH3: mzLoss(NH3), label: `${type}${i}${z > 1 ? ` (${z}+)` : ''}` });
      }
    }
  }
  return out;
}

export interface Match {
  ion: FragmentIon;
  peak: number;
  errorPpm: number;
}

export interface MatchResult {
  matched: Match[];
  unmatchedIons: FragmentIon[];
  unmatchedPeaks: number[];
  /** Fraction of residues covered by at least one matched fragment. */
  coverage: number;
  coveredPositions: number[];
}

/**
 * Greedy peak matching: each ion takes the nearest unused peak within
 * `tolPpm`. `coverage` is the fraction of residues in a matched b/a (prefix)
 * or y (suffix) fragment, so with all b and y ions matched it is 1.
 */
export function matchSpectrum(peaks: number[], ions: FragmentIon[], tolPpm: number): MatchResult {
  const used = new Set<number>();
  const matched: Match[] = [];
  const unmatchedIons: FragmentIon[] = [];
  const ordered = [...ions].sort((a, b) => Math.abs(a.mz - nearest(peaks, a.mz)) - Math.abs(b.mz - nearest(peaks, b.mz)));
  for (const ion of ordered) {
    let best = -1, bestErr = Infinity;
    for (let j = 0; j < peaks.length; j++) {
      if (used.has(j)) continue;
      const err = Math.abs(peaks[j] - ion.mz) / ion.mz * 1e6;
      if (err < bestErr) { bestErr = err; best = j; }
    }
    if (best >= 0 && bestErr <= tolPpm) {
      used.add(best);
      matched.push({ ion, peak: peaks[best], errorPpm: bestErr });
    } else unmatchedIons.push(ion);
  }
  const n = Math.max(0, ...ions.map((i) => i.index)) + (ions.length ? 1 : 0);
  const covered = new Set<number>();
  for (const m of matched) {
    if (m.ion.type === 'y') for (let p = n - m.ion.index + 1; p <= n; p++) covered.add(p);
    else for (let p = 1; p <= m.ion.index; p++) covered.add(p);
  }
  const unmatchedPeaks = peaks.filter((_, i) => !used.has(i));
  return { matched: matched.sort((a, b) => a.ion.mz - b.ion.mz), unmatchedIons, unmatchedPeaks, coverage: n ? covered.size / n : 0, coveredPositions: [...covered].sort((a, b) => a - b) };
}

const nearest = (peaks: number[], mz: number): number => (peaks.length ? peaks.reduce((best, p) => (Math.abs(p - mz) < Math.abs(best - mz) ? p : best), peaks[0]) : Infinity);

/** Neutral monoisotopic mass of the linear peptide. */
export function linearMass(seq: string): number {
  return residueMass(cleanSequence(seq)) + WATER;
}

/** Head-to-tail cyclic peptide: the terminal condensation loses one water. */
export function cyclicMass(seq: string): number {
  return linearMass(seq) - WATER;
}

/** Neutral mass with `bonds` disulfide bonds (each loses two hydrogens). */
export function disulfideMass(seq: string, bonds: number): number {
  return linearMass(seq) - bonds * DISULFIDE;
}

export interface DisulfidePairing {
  /** 1-based cysteine residue indices, each pair sorted ascending. */
  bonds: [number, number][];
  unpaired: number[];
  bondsCount: number;
  neutralMass: number;
  label: string;
}

/** All cysteine pairings; (n−1)!! connectivities, with one unpaired cysteine when n is odd. */
export function disulfidePairings(seqInput: string, maxCys = 8): DisulfidePairing[] {
  const seq = cleanSequence(seqInput);
  const cys = [...seq].map((c, i) => (c === 'C' ? i + 1 : 0)).filter((i) => i > 0);
  if (cys.length > maxCys) throw new Error(`${cys.length} cysteines give too many pairings; the limit is ${maxCys}.`);
  const linear = linearMass(seq);
  const out: DisulfidePairing[] = [];

  const pairRest = (rest: number[], bonds: [number, number][], unpaired: number[]) => {
    if (rest.length === 0) {
      const sorted = [...bonds].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const label = sorted.map(([a, b]) => `C${a}–C${b}`).join(', ') + (unpaired.length ? `${sorted.length ? '; ' : ''}${unpaired.map((p) => `C${p} unpaired`).join(', ')}` : '');
      out.push({ bonds: sorted, unpaired: [...unpaired].sort((a, b) => a - b), bondsCount: sorted.length, neutralMass: linear - sorted.length * DISULFIDE, label });
      return;
    }
    for (let j = 1; j < rest.length; j++) pairRest(rest.filter((_, k) => k !== 0 && k !== j), [...bonds, [rest[0], rest[j]]], unpaired);
  };

  if (cys.length % 2 === 1) {
    for (const u of cys) pairRest(cys.filter((p) => p !== u), [], [u]);
  } else pairRest(cys, [], []);
  return out;
}

export default { fragmentIons, matchSpectrum, linearMass, cyclicMass, disulfideMass, disulfidePairings };
