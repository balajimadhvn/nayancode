/**
 * Helical-wheel projection: residue n sits at angle n·δ (n from 0; δ = 100°
 * for an α-helix, 160° for a β-strand). The moment arrow has the magnitude of
 * ⟨μH⟩ and points along the vector sum in this projection.
 */
import { cleanSequence, EISENBERG_TABLE, hydrophobicMoment, residueClass, type ResidueClass } from './props';

export interface WheelResidue {
  position: number;
  residue: string;
  residueClass: ResidueClass;
  angle: number;
  x: number;
  y: number;
  hydrophobicity: number;
}

export interface HelicalWheel {
  seq: string;
  delta: number;
  residues: WheelResidue[];
  moment: number;
  momentAngle: number;
  momentEnd: { x: number; y: number };
}

export function helicalWheel(seqInput: string, delta = 100): HelicalWheel {
  const seq = cleanSequence(seqInput);
  const residues = [...seq].map((residue, i) => {
    const angle = (delta * i * Math.PI) / 180;
    return { position: i + 1, residue, residueClass: residueClass(residue), angle, x: Math.cos(angle), y: Math.sin(angle), hydrophobicity: EISENBERG_TABLE[residue] ?? 0 };
  });
  let re = 0, im = 0;
  for (const r of residues) {
    re += r.hydrophobicity * r.x;
    im += r.hydrophobicity * r.y;
  }
  const magnitude = hydrophobicMoment(seq, delta);
  const angle = Math.atan2(im, re);
  const scale = magnitude > 0 ? Math.hypot(re, im) : 0;
  return {
    seq,
    delta,
    residues,
    moment: magnitude,
    momentAngle: angle,
    momentEnd: scale > 0 ? { x: (re / scale) * magnitude, y: (im / scale) * magnitude } : { x: 0, y: 0 },
  };
}

export default helicalWheel;
