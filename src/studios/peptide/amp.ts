/**
 * Rule-based antimicrobial-peptide screen. This is a heuristic, not a trained
 * model: it scores simple physicochemical properties associated with membrane
 * activity and says nothing about measured antimicrobial potency.
 */
import { cleanSequence, hydrophobicMoment, netCharge, residueComposition } from './props';

export interface AmpCriterion {
  label: string;
  points: number;
  max: number;
  passed: boolean;
  detail: string;
}

export interface AmpResult {
  seq: string;
  score: number;
  length: number;
  charge: number;
  hydrophobicFraction: number;
  moment: number;
  cysteines: number;
  criteria: AmpCriterion[];
  reasons: string[];
}

export const AMP_MAX_POINTS = 6.5;

/**
 * Score = (points for length 10–50, charge ≥ +2 with a +1 bonus at ≥ +4,
 * hydrophobic fraction 30–60 %, mean hydrophobic moment ≥ 0.35 and no more
 * than two cysteines) / 6.5, clipped to [0, 1]. The cysteine point applies to
 * peptides that actually contain one or two cysteines; a cysteine-free peptide
 * has no disulfide constraint to satisfy and scores 0 there.
 */
export function ampScreen(seqInput: string): AmpResult {
  const seq = cleanSequence(seqInput);
  const length = seq.length;
  const charge = netCharge(seq, 7.4);
  const composition = residueComposition(seq);
  const hydrophobicFraction = composition.hydrophobic.fraction;
  const moment = hydrophobicMoment(seq, 100);
  const cysteines = seq.split('').filter((c) => c === 'C').length;

  const lengthOk = length >= 10 && length <= 50;
  const chargeOk = charge >= 2;
  const bonusOk = charge >= 4;
  const hydroOk = hydrophobicFraction >= 0.3 && hydrophobicFraction <= 0.6;
  const momentOk = moment >= 0.35;
  const cysOk = cysteines >= 1 && cysteines <= 2;

  const criteria: AmpCriterion[] = [
    { label: 'Length 10–50', points: lengthOk ? 1 : 0, max: 1, passed: lengthOk, detail: `${length} residues` },
    { label: 'Net charge at pH 7.4 ≥ +2', points: chargeOk ? 2 + (bonusOk ? 1 : 0) : 0, max: 3, passed: chargeOk, detail: `charge ${charge >= 0 ? '+' : ''}${charge.toFixed(2)}${bonusOk ? ' (≥ +4 bonus)' : ''}` },
    { label: 'Hydrophobic fraction 30–60 %', points: hydroOk ? 1 : 0, max: 1, passed: hydroOk, detail: `${(hydrophobicFraction * 100).toFixed(0)} %` },
    { label: 'Mean hydrophobic moment ≥ 0.35 (α-helix)', points: momentOk ? 2 : 0, max: 2, passed: momentOk, detail: `⟨μH⟩ ${moment.toFixed(3)}` },
    { label: 'Cysteine constraint (1–2 Cys)', points: cysOk ? 0.5 : 0, max: 0.5, passed: cysOk, detail: cysteines === 0 ? 'no cysteines (not applicable)' : `${cysteines} Cys` },
  ];
  const total = criteria.reduce((s, c) => s + c.points, 0);
  const score = Math.min(1, Math.max(0, total / AMP_MAX_POINTS));
  const reasons = criteria.map((c) => `${c.passed ? 'pass' : 'fail'} — ${c.label}: ${c.detail} (${c.points}/${c.max})`);
  return { seq, score, length, charge, hydrophobicFraction, moment, cysteines, criteria, reasons };
}

export default ampScreen;
