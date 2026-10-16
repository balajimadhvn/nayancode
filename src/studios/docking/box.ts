/** Search-box definitions for docking. All sizes in Å. */
import type { Atom } from '../structure/geometry';
import { LIMITS } from './vina';

export type V3 = [number, number, number];
export interface Box { center: V3; size: V3 }

const bounds = (pts: V3[]) => {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return { lo, hi };
};

/** Box around a set of points: bounding box expanded by `padding` on every side, at least `minSide`, at most the Vina limit. */
export function boxAround(pts: V3[], padding = 6, minSide = 18): Box {
  if (!pts.length) throw new Error('No atoms to place a box on.');
  const { lo, hi } = bounds(pts);
  const center = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2) as V3;
  const size = [0, 1, 2].map((k) => Math.min(LIMITS.maxBox, Math.max(minSide, hi[k] - lo[k] + 2 * padding))) as V3;
  return { center, size };
}
export const boxFromAtoms = (atoms: Pick<Atom, 'x' | 'y' | 'z' | 'el'>[], padding?: number, minSide?: number) => boxAround(atoms.filter((a) => a.el !== 'H').map((a) => [a.x, a.y, a.z] as V3), padding, minSide);
export function boxFromResidues(atoms: Atom[], residues: { chain: string; seq: number }[], padding = 4, minSide = 18): Box {
  const keep = new Set(residues.map((r) => `${r.chain}:${r.seq}`));
  const sel = atoms.filter((a) => keep.has(`${a.chain}:${a.seq}`) && a.el !== 'H');
  if (!sel.length) throw new Error('None of the selected residues were found in the structure.');
  return boxFromAtoms(sel, padding, minSide);
}
export function manualBox(center: V3, size: V3): Box {
  if (![...center, ...size].every(Number.isFinite)) throw new Error('Box centre and size must be numbers.');
  return { center, size: size.map((s) => Math.min(LIMITS.maxBox, Math.max(LIMITS.minBox, s))) as V3 };
}
export const boxVolume = (b: Box) => b.size[0] * b.size[1] * b.size[2];
/** Does the box contain every point (with the given margin)? */
export const boxContains = (b: Box, pts: V3[], margin = 0) => pts.every((p) => [0, 1, 2].every((k) => Math.abs(p[k] - b.center[k]) <= b.size[k] / 2 - margin));
