/** Sequence-liability and simple developability properties for antibodies.
 *
 * Rule-based screen only: motif liabilities, charge, pI and CDR composition. It
 * does not predict aggregation, expression or immunogenicity.
 */
import { proteinProps } from '@/studios/sequence/kernels';
import { analyseChains, type Cdrs } from './cdr';

/** pKa set used for charge calculations (as in `proteinProps`; N-term, C-term, K, R, H, D, E, C, Y). */
export const PKA = { nTerm: 9.69, cTerm: 2.34, K: 10.5, R: 12.4, H: 6.0, D: 3.86, E: 4.25, C: 8.3, Y: 10.07 } as const;

const positive = (pKa: number, pH: number) => 1 / (1 + 10 ** (pH - pKa));
const negative = (pKa: number, pH: number) => 1 / (1 + 10 ** (pKa - pH));

/** Net charge of a peptide at a given pH (free termini included). */
export function netCharge(seq: string, pH = 7.4): number {
  let q = positive(PKA.nTerm, pH) - negative(PKA.cTerm, pH);
  for (const c of seq.toUpperCase()) {
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

/** Isoelectric point by bisection on the net charge. */
export function isoelectricPoint(seq: string): number {
  if (!seq.length) return NaN;
  let lo = 0, hi = 14;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (netCharge(seq, mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export type LiabilityKind = 'N-glycosylation' | 'deamidation' | 'isomerisation' | 'oxidation' | 'free cysteine' | 'acid-labile' | 'fragmentation' | 'integrin-binding';

export interface Liability {
  kind: LiabilityKind;
  motif: string;
  /** 1-based position of the first residue of the motif. */
  position: number;
  risk: 'high' | 'medium' | 'low';
  region: 'CDR' | 'framework';
  note?: string;
}

const HYDROPHOBIC = /[AVILMFWY]/;

/** Motif liabilities in `seq`; `cdrRanges` are 1-based inclusive [start, end] pairs. */
export function findLiabilities(seq: string, cdrRanges: [number, number][] = []): Liability[] {
  const s = seq.toUpperCase();
  const regionOf = (pos: number): 'CDR' | 'framework' => (cdrRanges.some(([a, b]) => pos >= a && pos <= b) ? 'CDR' : 'framework');
  const out: Liability[] = [];
  const each = (re: RegExp, fn: (m: RegExpExecArray) => Liability | null) => {
    const g = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(s))) { const l = fn(m); if (l) out.push(l); if (m[0] === '') g.lastIndex++; }
  };
  // N-glycosylation sequon N-X-S/T with X ≠ P
  each(/N[^P][ST]/g, (m) => ({ kind: 'N-glycosylation', motif: m[0], position: m.index + 1, risk: 'high', region: regionOf(m.index + 1), note: 'NXS/T sequon; may be glycosylated in mammalian expression' }));
  // deamidation N-G/S/T/N (NG highest risk)
  each(/N[GSTN]/g, (m) => ({ kind: 'deamidation', motif: m[0], position: m.index + 1, risk: m[0] === 'NG' ? 'high' : 'medium', region: regionOf(m.index + 1) }));
  // isomerisation D-G/S/T/H/D (DG/DS highest risk)
  each(/D[GSTHD]/g, (m) => ({ kind: 'isomerisation', motif: m[0], position: m.index + 1, risk: m[0] === 'DG' || m[0] === 'DS' ? 'high' : 'medium', region: regionOf(m.index + 1) }));
  // acid-labile DP and fragmentation DP (same motif; reported once as acid-labile)
  each(/DP/g, (m) => ({ kind: 'acid-labile', motif: m[0], position: m.index + 1, risk: 'high', region: regionOf(m.index + 1), note: 'acid-labile Asp-Pro bond' }));
  // oxidation-prone residues
  each(/[MW]/g, (m) => ({ kind: 'oxidation', motif: m[0], position: m.index + 1, risk: regionOf(m.index + 1) === 'CDR' ? 'medium' : 'low', region: regionOf(m.index + 1) }));
  // integrin-binding RGD
  each(/RGD/g, (m) => ({ kind: 'integrin-binding', motif: m[0], position: m.index + 1, risk: 'low', region: regionOf(m.index + 1) }));
  // free cysteines: any Cys in a CDR, and an odd total Cys count
  const cysPositions = [...s].map((c, i) => (c === 'C' ? i + 1 : 0)).filter(Boolean);
  if (s.length && cysPositions.length % 2 === 1) out.push({ kind: 'free cysteine', motif: 'C', position: cysPositions[cysPositions.length - 1], risk: 'high', region: 'framework', note: 'odd number of cysteines: one is unpaired' });
  for (const p of cysPositions) if (regionOf(p) === 'CDR') out.push({ kind: 'free cysteine', motif: 'C', position: p, risk: 'high', region: 'CDR', note: 'cysteine in a CDR' });
  return out.sort((a, b) => a.position - b.position);
}

export interface FvProperties {
  length: number;
  mw: number;
  pI: number;
  charge7: number;
  gravy: number;
  cdrLength: number;
  cdrH3Length: number | null;
  hydrophobicCdrFraction: number;
  cdrCharge: number;
  hydrophobicClusters: number;
  cysteines: number;
}

/** Developability properties of an Fv (one or both chains concatenated as supplied). */
export function fvProperties(seq: string, cdrRanges: [number, number][], cdrH3: string | null): FvProperties {
  const p = proteinProps(seq);
  const cdrSeq = cdrRanges.map(([a, b]) => seq.slice(a - 1, b)).join('');
  const hydro = [...cdrSeq].filter((c) => HYDROPHOBIC.test(c)).length;
  const clusters = [...seq.toUpperCase().matchAll(/[AVILMFWY]{4,}/g)].filter((m) => cdrRanges.some(([a, b]) => m.index! + 1 <= b && m.index! + m[0].length >= a)).length;
  return {
    length: seq.length, mw: p.mw, pI: isoelectricPoint(seq), charge7: netCharge(seq, 7.4), gravy: p.gravy,
    cdrLength: cdrSeq.length, cdrH3Length: cdrH3 ? cdrH3.length : null,
    hydrophobicCdrFraction: cdrSeq.length ? hydro / cdrSeq.length : NaN,
    cdrCharge: cdrSeq.length ? netCharge(cdrSeq, 7.4) : NaN,
    hydrophobicClusters: clusters,
    cysteines: [...seq].filter((c) => c.toUpperCase() === 'C').length,
  };
}

export interface Flag { text: string; level: 'warn' | 'info' }

/** Rules-of-thumb flags; these are not validated cut-offs. */
export function developabilityFlags(p: FvProperties): Flag[] {
  const out: Flag[] = [];
  if (p.pI > 9.5) out.push({ text: `pI ${p.pI.toFixed(2)} is above 9.5 (viscosity/clearance risk)`, level: 'warn' });
  if (p.pI < 6) out.push({ text: `pI ${p.pI.toFixed(2)} is below 6 (clearance risk)`, level: 'warn' });
  if (p.cdrH3Length !== null && p.cdrH3Length > 20) out.push({ text: `CDR-H3 is ${p.cdrH3Length} residues (> 20)`, level: 'warn' });
  if (p.hydrophobicClusters > 2) out.push({ text: `${p.hydrophobicClusters} hydrophobic clusters of four or more residues in the CDRs (> 2)`, level: 'warn' });
  if (p.cdrCharge > 2) out.push({ text: `net CDR charge at pH 7.4 is +${p.cdrCharge.toFixed(2)} (> +2)`, level: 'warn' });
  if (p.cdrCharge < -2) out.push({ text: `net CDR charge at pH 7.4 is ${p.cdrCharge.toFixed(2)} (< −2)`, level: 'warn' });
  if (p.hydrophobicCdrFraction > 0.4) out.push({ text: `hydrophobic fraction of the CDRs is ${(p.hydrophobicCdrFraction * 100).toFixed(0)} %`, level: 'info' });
  return out;
}

/** Convenience wrapper for one chain with its CDRs. */
export function chainRanges(cdr: Cdrs): [number, number][] {
  return cdr.chain ? [cdr.cdr1Pos, cdr.cdr2Pos, cdr.cdr3Pos] : [];
}

export interface ChainAnalysis {
  label: string;
  seq: string;
  cdr: Cdrs;
  ranges: [number, number][];
  liabilities: Liability[];
  props: FvProperties;
  flags: Flag[];
}

/** Full analysis of one antibody input: one chain, VH + VL pasted together, or an scFv. */
export function analyseAntibody(input: string): ChainAnalysis[] {
  return analyseChains(input).map((c) => {
    const ranges = chainRanges(c.cdr);
    const props = fvProperties(c.seq, ranges, c.cdr.chain === 'H' ? c.cdr.cdr3 : null);
    return { ...c, ranges, liabilities: findLiabilities(c.seq, ranges), props, flags: developabilityFlags(props) };
  });
}
