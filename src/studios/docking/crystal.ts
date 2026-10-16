/** Matching a crystallographic ligand (coordinates only) to a ligand built from SMILES, for redocking RMSD. */
import { isProteinRes, listLigands, residues, type Atom, type Structure } from '../structure/geometry';
import { neighbours, type MolG } from './molgraph';
import { automorphisms, symmetryRmsd, type V3 } from './pdbqt';

const COV: Record<string, number> = { C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07, F: 0.57, CL: 1.02, BR: 1.2, I: 1.39, H: 0.31, B: 0.84 };

/** Graph isomorphism A→B (element + connectivity, bond orders ignored). Returns for each atom of A the index in B, or null. */
export function isoMap(elA: string[], adjA: number[][], elB: string[], adjB: number[][], limit = 2_000_000): number[] | null {
  const n = elA.length; if (n !== elB.length) return null;
  const order = [0], seen = new Set([0]);
  for (let h = 0; h < order.length; h++) for (const j of adjA[order[h]]) if (!seen.has(j)) { seen.add(j); order.push(j); }
  for (let i = 0; i < n; i++) if (!seen.has(i)) order.push(i);
  const map = new Array<number>(n).fill(-1), used = new Uint8Array(n); let steps = 0;
  const rec = (k: number): boolean => {
    if (k === n) return true;
    if (++steps > limit) return false;
    const i = order[k];
    for (let t = 0; t < n; t++) {
      if (used[t] || elA[i].toUpperCase() !== elB[t].toUpperCase() || adjA[i].length !== adjB[t].length) continue;
      let ok = true;
      for (const j of adjA[i]) if (map[j] >= 0 && !adjB[t].includes(map[j])) { ok = false; break; }
      if (!ok) continue;
      map[i] = t; used[t] = 1; if (rec(k + 1)) return true; map[i] = -1; used[t] = 0;
    }
    return false;
  };
  return rec(0) ? map : null;
}

export interface CrystalLigand { key: string; name: string; chain: string; seq: number; atoms: Atom[] }

/** Heavy atoms of the ligand with the given residue name (first instance, or the one with most atoms). */
export function crystalLigand(s: Structure, resName: string, chain?: string): CrystalLigand {
  const cands = residues(s.atoms.filter((a) => a.het && a.el !== 'H' && !isProteinRes(a.res))).filter((r) => r.res === resName && (!chain || r.chain === chain));
  if (!cands.length) throw new Error(`Ligand ${resName} not found in the structure.`);
  cands.sort((a, b) => b.atoms.length - a.atoms.length);
  const r = cands[0];
  // keep first altloc per atom name
  const m = new Map<string, Atom>(); for (const a of r.atoms) if (!m.has(a.name)) m.set(a.name, a);
  return { key: r.key, name: r.res, chain: r.chain, seq: r.seq, atoms: [...m.values()] };
}
export { listLigands };

/** Maps the crystal ligand's heavy atoms onto the heavy atoms of `mol` (hydrogens ignored). Returns for each mol heavy-atom index its crystal coordinates. */
export function mapCrystalToMol(c: CrystalLigand, mol: MolG): { molAtom: number; pos: V3 }[] | null {
  const heavy = mol.atoms.map((a, i) => (a.el !== 'H' ? i : -1)).filter((i) => i >= 0), idx = new Map(heavy.map((a, k) => [a, k]));
  const nb = neighbours(mol), adjB = heavy.map((a) => nb[a].filter((j) => idx.has(j)).map((j) => idx.get(j)!)), elB = heavy.map((a) => mol.atoms[a].el);
  const n = c.atoms.length, adjA: number[][] = c.atoms.map(() => []);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = Math.hypot(c.atoms[i].x - c.atoms[j].x, c.atoms[i].y - c.atoms[j].y, c.atoms[i].z - c.atoms[j].z);
    const lim = (COV[c.atoms[i].el.toUpperCase()] ?? 0.8) + (COV[c.atoms[j].el.toUpperCase()] ?? 0.8) + 0.45;
    if (d < lim && d > 0.8) { adjA[i].push(j); adjA[j].push(i); }
  }
  const map = isoMap(c.atoms.map((a) => a.el), adjA, elB, adjB);
  if (!map) return null;
  return c.atoms.map((a, i) => ({ molAtom: heavy[map[i]], pos: [a.x, a.y, a.z] as V3 }));
}

/** Symmetry-corrected heavy-atom RMSD (Å) of every pose against the crystal ligand, or null when the crystal ligand is not the docked compound. */
export function redockRmsd(c: CrystalLigand, mol: MolG, atomMap: number[], poses: { atoms: { x: number; y: number; z: number }[] }[]): number[] | null {
  const map = mapCrystalToMol(c, mol); if (!map) return null;
  const heavy = atomMap.map((a, k) => ({ a, k })).filter(({ a }) => mol.atoms[a].el !== 'H'), hi = new Map(heavy.map(({ a }, h) => [a, h]));
  const ref: V3[] = new Array(heavy.length); for (const m of map) ref[hi.get(m.molAtom)!] = m.pos;
  const el = heavy.map(({ a }) => mol.atoms[a].el);
  const bonds: [number, number, number][] = mol.bonds.filter((b) => hi.has(b.a) && hi.has(b.b)).map((b) => [hi.get(b.a)!, hi.get(b.b)!, b.order]);
  const autos = automorphisms(el, bonds);
  return poses.map((p) => symmetryRmsd(el, bonds, ref, heavy.map(({ k }) => [p.atoms[k].x, p.atoms[k].y, p.atoms[k].z] as V3), autos));
}
