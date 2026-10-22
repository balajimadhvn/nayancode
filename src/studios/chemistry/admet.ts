/**
 * Property and ADMET-style predictions for a compound library.
 *  - Equation/rule endpoints (no training): Lipinski, Veber, Egan and Ghose filters, and the BOILED-Egg regions
 *    (Daina & Zoete 2016) for gastrointestinal absorption and brain penetration.
 *  - Three small gradient-boosted models (public/data/admet/models.json) trained offline on open data with RDKit
 *    descriptors: aqueous solubility (ESOL set), lipophilicity (AstraZeneca logD 7.4) and BBB penetration (BBBP).
 *    benchmarks/admet/train.py reproduces them and records scaffold-split performance.
 * Models are descriptive screening aids, not a replacement for measurement; each prediction carries an applicability flag.
 */
export interface TreeJson { f: number[]; t: number[]; l: number[]; r: number[]; v: number[] }
export interface ModelJson { label: string; task: 'regression' | 'classification'; unit: string; source: string; lr: number; init: number; trees: TreeJson[]; lo: number[]; hi: number[]; names: string[]; metrics: Record<string, number | string> }
export type ModelSet = Record<string, ModelJson>;

const leaf = (t: TreeJson, x: ArrayLike<number>) => { let n = 0; while (t.l[n] !== -1) n = Math.fround(x[t.f[n]]) <= t.t[n] ? t.l[n] : t.r[n]; return t.v[n]; };
/** Raw boosted score (regression value, or log-odds for classification). */
export const rawScore = (m: ModelJson, x: ArrayLike<number>) => { let s = m.init; for (const t of m.trees) s += m.lr * leaf(t, x); return s; };
export const predict = (m: ModelJson, x: ArrayLike<number>) => { const s = rawScore(m, x); return m.task === 'classification' ? 1 / (1 + Math.exp(-s)) : s; };

/** Re-orders a descriptor vector (by name) into the model's feature order; null if a feature is missing. */
export function alignFeatures(m: ModelJson, names: string[], desc: ArrayLike<number>): Float32Array | null {
  const idx = new Map(names.map((n, i) => [n, i])); const out = new Float32Array(m.names.length);
  for (let j = 0; j < m.names.length; j++) { const i = idx.get(m.names[j]); if (i === undefined) return null; out[j] = desc[i]; }
  return out;
}
/** Fraction of the 15 most variable features lying outside the 1st–99th percentile range of the training set. */
export function outOfDomain(m: ModelJson, x: ArrayLike<number>): number {
  let out = 0, n = 0;
  for (let j = 0; j < m.names.length; j++) { if (m.hi[j] === m.lo[j]) continue; n++; if (x[j] < m.lo[j] - 1e-6 || x[j] > m.hi[j] + 1e-6) out++; }
  return n ? out / n : 0;
}

export interface Props { mw: number; logp: number; tpsa: number; hbd: number; hba: number; rotb: number; mr?: number; heavy?: number }
export interface Rule { id: string; name: string; pass: boolean; violations: string[] }
/** Drug-likeness filters; each lists the criteria that failed. */
export function rules(p: Props): Rule[] {
  const R = (id: string, name: string, checks: [boolean, string][]): Rule => ({ id, name, violations: checks.filter((c) => !c[0]).map((c) => c[1]), pass: checks.every((c) => c[0]) });
  const out = [
    R('lipinski', 'Lipinski (Ro5)', [[p.mw <= 500, 'MW > 500'], [p.logp <= 5, 'logP > 5'], [p.hbd <= 5, 'HBD > 5'], [p.hba <= 10, 'HBA > 10']]),
    R('veber', 'Veber', [[p.rotb <= 10, 'RotB > 10'], [p.tpsa <= 140, 'TPSA > 140']]),
    R('egan', 'Egan', [[p.tpsa <= 131.6, 'TPSA > 131.6'], [p.logp >= -1 && p.logp <= 5.88, 'logP outside −1 to 5.88']]),
  ];
  if (p.mr !== undefined && p.heavy !== undefined) out.push(R('ghose', 'Ghose', [[p.mw >= 160 && p.mw <= 480, 'MW outside 160–480'], [p.logp >= -0.4 && p.logp <= 5.6, 'logP outside −0.4 to 5.6'], [p.mr >= 40 && p.mr <= 130, 'MR outside 40–130'], [p.heavy >= 20 && p.heavy <= 70, 'atoms outside 20–70']]));
  return out;
}
/** BOILED-Egg (Daina & Zoete 2016) approximated by the published ellipse-like limits on TPSA and logP. */
export function boiledEgg(tpsa: number, logp: number): { gi: boolean; bbb: boolean } {
  const gi = tpsa <= 142 && logp >= -2.3 && logp <= 6.8 && ((tpsa - 71) / 71) ** 2 + ((logp - 2.25) / 4.55) ** 2 <= 1;
  const bbb = tpsa <= 79 && logp >= 0.4 && logp <= 6 && ((tpsa - 39.5) / 39.5) ** 2 + ((logp - 3.2) / 2.8) ** 2 <= 1;
  return { gi, bbb };
}
export const fmtSol = (logS: number) => { const mgL = 10 ** logS; return `${mgL >= 0.01 ? mgL.toPrecision(3) : mgL.toExponential(1)} mol/L`; };
