/**
 * Peptide properties for sequences up to 100 residues: mass, charge vs pH, pI,
 * GRAVY (Kyte–Doolittle), aliphatic index (Ikai 1980), hydrophobic moment
 * (Eisenberg et al. 1984) and residue composition.
 */
import { peptideMass } from '@/studios/sequence/proteomics';

export const MAX_RESIDUES = 100;
const STANDARD = 'ACDEFGHIKLMNPQRSTVWY';

/** Upper-cases and checks the sequence (20 standard letters, 1–100 residues). */
export function cleanSequence(input: string): string {
  const s = input.trim().toUpperCase().replace(/\s+/g, '');
  if (!s) throw new Error('Enter a peptide sequence.');
  const bad = [...new Set([...s].filter((c) => !STANDARD.includes(c)))];
  if (bad.length) throw new Error(`Unsupported residue(s): ${bad.join(', ')}. Use the 20 standard amino-acid letters (ACDEFGHIKLMNPQRSTVWY).`);
  if (s.length > MAX_RESIDUES) throw new Error(`Peptide is ${s.length} residues; the limit is ${MAX_RESIDUES}.`);
  return s;
}

/** Kyte–Doolittle hydropathy (Kyte & Doolittle 1982). */
export const GRAVY_TABLE: Record<string, number> = {
  A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, Q: -3.5, E: -3.5, G: -0.4,
  H: -3.2, I: 4.5, L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8,
  T: -0.7, W: -0.9, Y: -1.3, V: 4.2,
};

/** Eisenberg consensus hydrophobicity scale (Eisenberg et al. 1984). */
export const EISENBERG_TABLE: Record<string, number> = {
  A: 0.62, R: -2.53, N: -0.78, D: -0.90, C: 0.29, Q: -0.85, E: -0.74,
  G: 0.48, H: -0.40, I: 1.38, L: 1.06, K: -1.50, M: 0.64, F: 1.19,
  P: 0.12, S: -0.18, T: -0.05, W: 0.81, Y: 0.26, V: 1.08,
};

/** pKa set used for charge calculations (N-term, C-term, K, R, H, D, E, C, Y). */
export const PKA = { nTerm: 9.69, cTerm: 2.34, K: 10.5, R: 12.4, H: 6.0, D: 3.86, E: 4.25, C: 8.3, Y: 10.07 } as const;

const positive = (pKa: number, pH: number) => 1 / (1 + 10 ** (pH - pKa));
const negative = (pKa: number, pH: number) => 1 / (1 + 10 ** (pKa - pH));

export interface ChargeOptions {
  /** Include the free N- and C-termini (default true). */
  freeTermini?: boolean;
  /** C-terminal amidation removes the terminal carboxyl charge. */
  amidatedC?: boolean;
  /** N-terminal acetylation removes the terminal amino charge. */
  acetylatedN?: boolean;
}

/** Net charge from Henderson–Hasselbalch titration of the ionisable groups. */
export function netCharge(seq: string, pH = 7.4, o: ChargeOptions = {}): number {
  const s = cleanSequence(seq);
  const free = o.freeTermini ?? true;
  let q = 0;
  if (free && !o.acetylatedN) q += positive(PKA.nTerm, pH);
  if (free && !o.amidatedC) q -= negative(PKA.cTerm, pH);
  for (const c of s) {
    if (c === 'K') q += positive(PKA.K, pH);
    else if (c === 'R') q += positive(PKA.R, pH);
    else if (c === 'H') q += positive(PKA.H, pH);
    else if (c === 'D') q -= negative(PKA.D, pH);
    else if (c === 'E') q -= negative(PKA.E, pH);
    else if (c === 'C') q -= negative(PKA.C, pH);
    else if (c === 'Y') q -= negative(PKA.Y, pH);
  }
  return q;
}

/** Charge at 0, 0.1, …, 14 for plotting. */
export function chargeCurve(seq: string, o: ChargeOptions = {}): { pH: number; charge: number }[] {
  cleanSequence(seq);
  const out: { pH: number; charge: number }[] = [];
  for (let i = 0; i <= 140; i++) {
    const pH = i / 10;
    out.push({ pH, charge: netCharge(seq, pH, o) });
  }
  return out;
}

/** Isoelectric point: bisection on the net charge in [0, 14]. */
export function pI(seq: string, o: ChargeOptions = {}): number {
  cleanSequence(seq);
  let lo = 0, hi = 14;
  if (netCharge(seq, lo, o) <= 0) return 0;
  if (netCharge(seq, hi, o) >= 0) return 14;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (netCharge(seq, mid, o) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Grand average of hydropathy (Kyte & Doolittle). */
export function GRAVY(seq: string): number {
  const s = cleanSequence(seq);
  let sum = 0;
  for (const c of s) sum += GRAVY_TABLE[c] ?? 0;
  return sum / s.length;
}

/** Aliphatic index (Ikai 1980): X(A) + 2.9·X(V) + 3.9·(X(I)+X(L)), X in mole percent. */
export function aliphaticIndex(seq: string): number {
  const s = cleanSequence(seq);
  let a = 0, v = 0, il = 0;
  for (const c of s) {
    if (c === 'A') a++;
    else if (c === 'V') v++;
    else if (c === 'I' || c === 'L') il++;
  }
  const pct = (n: number) => (n / s.length) * 100;
  return pct(a) + 2.9 * pct(v) + 3.9 * pct(il);
}

/** Mean hydrophobic moment ⟨μH⟩ = |Σ H_n e^{i n δ}| / N; δ = 100° for an α-helix, 160° for a β-strand. */
export function hydrophobicMoment(seq: string, delta = 100): number {
  const s = cleanSequence(seq);
  let re = 0, im = 0;
  for (let i = 0; i < s.length; i++) {
    const h = EISENBERG_TABLE[s[i]] ?? 0;
    const angle = (delta * (i + 1) * Math.PI) / 180;
    re += h * Math.cos(angle);
    im += h * Math.sin(angle);
  }
  return Math.hypot(re, im) / s.length;
}

/** Angle (radians) of the hydrophobic moment vector, measured from +x. */
export function hydrophobicMomentAngle(seq: string, delta = 100): number {
  const s = cleanSequence(seq);
  let re = 0, im = 0;
  for (let i = 0; i < s.length; i++) {
    const h = EISENBERG_TABLE[s[i]] ?? 0;
    const angle = (delta * (i + 1) * Math.PI) / 180;
    re += h * Math.cos(angle);
    im += h * Math.sin(angle);
  }
  return Math.atan2(im, re);
}

export type ResidueClass = 'hydrophobic' | 'polar' | 'positive' | 'negative';

/** Class of a residue for the wheel and the composition table. */
export function residueClass(c: string): ResidueClass {
  if ('AVILMFWC'.includes(c)) return 'hydrophobic';
  if ('KR'.includes(c)) return 'positive';
  if ('DE'.includes(c)) return 'negative';
  return 'polar';
}

export interface ClassCount { count: number; fraction: number }
export interface Composition {
  length: number;
  hydrophobic: ClassCount;
  polarUncharged: ClassCount;
  positive: ClassCount;
  negative: ClassCount;
  histidine: ClassCount;
  counts: Record<string, number>;
}

export function residueComposition(seq: string): Composition {
  const s = cleanSequence(seq);
  const n = s.length;
  const counts: Record<string, number> = {};
  for (const c of s) counts[c] = (counts[c] ?? 0) + 1;
  const countOf = (set: string) => [...s].filter((c) => set.includes(c)).length;
  const frac = (k: number): ClassCount => ({ count: k, fraction: n ? k / n : 0 });
  const positive = countOf('KR');
  const negative = countOf('DE');
  const histidine = countOf('H');
  const hydrophobic = countOf('AVILMFWC');
  const polar = countOf('STNQYGHP') - histidine;
  return {
    length: n,
    hydrophobic: frac(hydrophobic),
    polarUncharged: frac(polar),
    positive: frac(positive),
    negative: frac(negative),
    histidine: frac(histidine),
    counts,
  };
}

export interface PeptideProperties {
  seq: string;
  length: number;
  massMono: number;
  massAvg: number;
  charge: number;
  pI: number;
  gravy: number;
  aliphaticIndex: number;
  momentAlpha: number;
  momentBeta: number;
  composition: Composition;
}

/** All property values for one peptide at a given pH. */
export function peptideProperties(seq: string, pH = 7.4, o: ChargeOptions = {}): PeptideProperties {
  const s = cleanSequence(seq);
  return {
    seq: s,
    length: s.length,
    massMono: peptideMass(s, 'mono'),
    massAvg: peptideMass(s, 'avg'),
    charge: netCharge(s, pH, o),
    pI: pI(s, o),
    gravy: GRAVY(s),
    aliphaticIndex: aliphaticIndex(s),
    momentAlpha: hydrophobicMoment(s, 100),
    momentBeta: hydrophobicMoment(s, 160),
    composition: residueComposition(s),
  };
}

export default { MAX_RESIDUES, cleanSequence, netCharge, chargeCurve, pI, GRAVY, aliphaticIndex, hydrophobicMoment, residueComposition, peptideProperties };
