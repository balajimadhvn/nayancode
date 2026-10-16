/** Receptor preparation, clean-room: residue templates give the AutoDock atom type, hybridisation and protonation state at pH 7.4 of every
 *  protein atom; polar hydrogens are placed from local geometry; Gasteiger charges come from molgraph.ts. Heteroatoms other than metal
 *  ions and all waters are removed. Hydrogen positions are approximate (Vina's scoring ignores hydrogens; only their presence marks a donor). */
import { gasteiger, type GasteigerNode, type Hyb } from './molgraph';
import { atomLine, type V3 } from './pdbqt';
import { parseStructure, type Atom, type Structure } from '../structure/geometry';

type Code = 'C3' | 'C2' | 'CA' | 'N3' | 'N2' | 'NA' | 'O3' | 'O2' | 'S3';
interface T { code: Code; nH: number; polar: number; fc: number }
const t = (code: Code, nH = 0, polar = 0, fc = 0): T => ({ code, nH, polar, fc });
const BB: Record<string, T> = { N: t('N2', 1, 1), CA: t('C3', 1), C: t('C2'), O: t('O2'), OXT: t('O2', 0, 0, -0.5) };
const SC: Record<string, Record<string, T>> = {
  ALA: { CB: t('C3', 3) },
  ARG: { CB: t('C3', 2), CG: t('C3', 2), CD: t('C3', 2), NE: t('N2', 1, 1), CZ: t('C2'), NH1: t('N2', 2, 2, 0.5), NH2: t('N2', 2, 2, 0.5) },
  ASN: { CB: t('C3', 2), CG: t('C2'), OD1: t('O2'), ND2: t('N2', 2, 2) },
  ASP: { CB: t('C3', 2), CG: t('C2'), OD1: t('O2', 0, 0, -0.5), OD2: t('O2', 0, 0, -0.5) },
  CYS: { CB: t('C3', 2), SG: t('S3', 1, 1) },
  GLN: { CB: t('C3', 2), CG: t('C3', 2), CD: t('C2'), OE1: t('O2'), NE2: t('N2', 2, 2) },
  GLU: { CB: t('C3', 2), CG: t('C3', 2), CD: t('C2'), OE1: t('O2', 0, 0, -0.5), OE2: t('O2', 0, 0, -0.5) },
  GLY: {},
  HIS: { CB: t('C3', 2), CG: t('CA'), ND1: t('NA'), CD2: t('CA', 1), CE1: t('CA', 1), NE2: t('N2', 1, 1) }, // HIE tautomer
  ILE: { CB: t('C3', 1), CG1: t('C3', 2), CG2: t('C3', 3), CD1: t('C3', 3) },
  LEU: { CB: t('C3', 2), CG: t('C3', 1), CD1: t('C3', 3), CD2: t('C3', 3) },
  LYS: { CB: t('C3', 2), CG: t('C3', 2), CD: t('C3', 2), CE: t('C3', 2), NZ: t('N3', 3, 3, 1) },
  MET: { CB: t('C3', 2), CG: t('C3', 2), SD: t('S3'), CE: t('C3', 3) },
  PHE: { CB: t('C3', 2), CG: t('CA'), CD1: t('CA', 1), CD2: t('CA', 1), CE1: t('CA', 1), CE2: t('CA', 1), CZ: t('CA', 1) },
  PRO: { CB: t('C3', 2), CG: t('C3', 2), CD: t('C3', 2) },
  SER: { CB: t('C3', 2), OG: t('O3', 1, 1) },
  THR: { CB: t('C3', 1), OG1: t('O3', 1, 1), CG2: t('C3', 3) },
  TRP: { CB: t('C3', 2), CG: t('CA'), CD1: t('CA', 1), CD2: t('CA'), NE1: t('N2', 1, 1), CE2: t('CA'), CE3: t('CA', 1), CZ2: t('CA', 1), CZ3: t('CA', 1), CH2: t('CA', 1) },
  TYR: { CB: t('C3', 2), CG: t('CA'), CD1: t('CA', 1), CD2: t('CA', 1), CE1: t('CA', 1), CE2: t('CA', 1), CZ: t('CA'), OH: t('O3', 1, 1) },
  VAL: { CB: t('C3', 1), CG1: t('C3', 3), CG2: t('C3', 3) },
};
const ALIAS: Record<string, string> = { MSE: 'MET', HID: 'HIS', HIE: 'HIS', HIP: 'HIS', HSD: 'HIS', HSE: 'HIS', HSP: 'HIS', CYX: 'CYS', CYM: 'CYS', ASH: 'ASP', GLH: 'GLU', LYN: 'LYS' };
const METAL_TYPE: Record<string, [string, number]> = { ZN: ['Zn', 2], MG: ['Mg', 2], CA: ['Ca', 2], MN: ['Mn', 2], FE: ['Fe', 2], FE2: ['Fe', 2] };
const HYB: Record<Code, Hyb> = { C3: 'sp3', C2: 'sp2', CA: 'sp2', N3: 'sp3', N2: 'sp2', NA: 'sp2', O3: 'sp3', O2: 'sp2', S3: 'sp3' };
const TYPE: Record<Code, string> = { C3: 'C', C2: 'C', CA: 'A', N3: 'N', N2: 'N', NA: 'NA', O3: 'OA', O2: 'OA', S3: 'SA' };
const EL: Record<Code, string> = { C3: 'C', C2: 'C', CA: 'C', N3: 'N', N2: 'N', NA: 'N', O3: 'O', O2: 'O', S3: 'S' };
const COV: Record<string, number> = { C: 0.76, N: 0.71, O: 0.66, S: 1.05 };

export interface ReceptorOptions {
  chains?: string[];            // default: all chains with protein residues
  keepMetals?: boolean;         // default true
  cropCenter?: V3; cropRadius?: number; // drop residues entirely farther than this from the centre (Vina only sees 8 Å beyond the box)
}
export interface ReceptorAtom { name: string; res: string; chain: string; seq: number; pos: V3; q: number; type: string }
export interface Receptor { atoms: ReceptorAtom[]; pdbqt: string; residues: number; warnings: string[]; dropped: { waters: number; hetero: number; incompleteResidues: number } }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const perp = (a: V3): V3 => unit(cross(a, Math.abs(a[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));

/** Positions of `k` hydrogens (1.01 Å) on atom `pos` given its bonded heavy neighbours (`nbr`) and, for a planar group, a reference atom `ref` defining the plane. */
export function placeHydrogens(pos: V3, nbr: V3[], k: number, planar: boolean, ref?: V3): V3[] {
  const bond = 1.01;
  if (nbr.length >= 2) {
    // away from the neighbours' mean direction (1 H on an sp2 N or sp3 O/N with two heavy neighbours)
    let d: V3 = [0, 0, 0]; for (const n of nbr) d = add(d, unit(sub(pos, n)));
    if (len(d) < 0.2) d = perp(sub(pos, nbr[0]));
    const u = unit(d), out: V3[] = [add(pos, u, bond)];
    if (k > 1) { const e = perp(u); for (let i = 1; i < k; i++) out.push(add(pos, unit(add(u, e, i % 2 ? 1 : -1)), bond)); }
    return out;
  }
  const b = nbr[0]; if (!b) return Array.from({ length: k }, (_, i) => add(pos, [bond * (i + 1) / k, 0, 0]));
  const u = unit(sub(pos, b));
  const phi = (planar ? 60 : 70.5) * Math.PI / 180;
  let e1 = perp(u);
  if (planar && ref) { const nrm = unit(cross(sub(b, pos), sub(ref, b))); if (len(nrm) > 0.1) e1 = unit(cross(nrm, u)); }
  const e2 = unit(cross(u, e1)), out: V3[] = [];
  for (let i = 0; i < k; i++) {
    const alpha = planar ? (i === 0 ? 0 : Math.PI) : (2 * Math.PI * i) / Math.max(k, 1);
    const dir: V3 = [0, 1, 2].map((c) => Math.cos(phi) * u[c] + Math.sin(phi) * (Math.cos(alpha) * e1[c] + Math.sin(alpha) * e2[c])) as V3;
    out.push(add(pos, dir, bond));
  }
  return out;
}

export function prepareReceptor(input: string | Structure, opt: ReceptorOptions = {}): Receptor {
  const s = typeof input === 'string' ? parseStructure(input) : input;
  const warnings: string[] = [];
  const dropped = { waters: 0, hetero: 0, incompleteResidues: 0 };
  // group atoms by residue, first altloc only, no hydrogens
  interface R { key: string; res: string; chain: string; seq: number; icode: string; atoms: Map<string, Atom> }
  const rmap = new Map<string, R>(), order: R[] = [];
  const WAT = new Set(['HOH', 'WAT', 'H2O', 'DOD']);
  for (const a of s.atoms) {
    if (a.el === 'H' || a.el === 'D') continue;
    if (opt.chains && !opt.chains.includes(a.chain)) continue;
    const key = `${a.chain}:${a.seq}${a.icode}:${a.res}`;
    let r = rmap.get(key);
    if (!r) { r = { key, res: a.res, chain: a.chain, seq: a.seq, icode: a.icode, atoms: new Map() }; rmap.set(key, r); order.push(r); }
    if (!r.atoms.has(a.name)) r.atoms.set(a.name, a);
  }
  const out: ReceptorAtom[] = [];
  interface N { ra: ReceptorAtom; t: T | null; res: R; heavyIdx: number }
  const nodes: N[] = [];
  let residues = 0;
  const centre = opt.cropCenter, rad = opt.cropRadius;
  const near = (r: R) => !centre || rad == null || [...r.atoms.values()].some((a) => Math.hypot(a.x - centre[0], a.y - centre[1], a.z - centre[2]) <= rad);
  for (const r of order) {
    const rn = ALIAS[r.res] ?? r.res;
    if (WAT.has(r.res)) { dropped.waters++; continue; }
    if (SC[rn]) {
      if (!near(r)) continue;
      const tmpl = { ...BB, ...SC[rn] }; if (rn === 'PRO') tmpl.N = t('N2', 0, 0);
      if (!r.atoms.has('N') || !r.atoms.has('CA') || !r.atoms.has('C')) { dropped.incompleteResidues++; warnings.push(`Residue ${r.res} ${r.chain}${r.seq} lacks backbone atoms and was removed.`); continue; }
      const missing = Object.keys(SC[rn]).filter((n) => !r.atoms.has(n) && !(n === 'SD' && r.atoms.has('SE')));
      if (missing.length) { dropped.incompleteResidues++; warnings.push(`Residue ${r.res} ${r.chain}${r.seq} is missing side-chain atoms (${missing.join(', ')}) and was removed to keep the receptor chemically consistent.`); continue; }
      residues++;
      for (const [name, a] of r.atoms) {
        let tt = tmpl[name]; if (!tt) { if (name === 'SE') tt = tmpl['SD']; else { continue; } }
        nodes.push({ ra: { name, res: rn, chain: r.chain, seq: r.seq, pos: [a.x, a.y, a.z], q: 0, type: TYPE[tt.code] }, t: tt, res: r, heavyIdx: nodes.length });
      }
    } else if (METAL_TYPE[r.res] && opt.keepMetals !== false) {
      if (!near(r)) continue;
      const a = [...r.atoms.values()][0], [type] = METAL_TYPE[r.res];
      nodes.push({ ra: { name: a.name, res: r.res, chain: r.chain, seq: r.seq, pos: [a.x, a.y, a.z], q: METAL_TYPE[r.res][1], type }, t: null, res: r, heavyIdx: nodes.length });
    } else dropped.hetero++;
  }
  if (!residues) throw new Error('No standard protein residues found in the structure.');

  // covalent bonds among prepared atoms from distances (within residue + peptide link)
  const n = nodes.length, bonds: [number, number][] = [];
  const grid = new Map<string, number[]>(); const cell = (p: V3) => p.map((v) => Math.floor(v / 2)).join(',');
  nodes.forEach((x, i) => { const c = cell(x.ra.pos); (grid.get(c) ?? grid.set(c, []).get(c)!).push(i); });
  for (let i = 0; i < n; i++) {
    if (!nodes[i].t) continue;
    const [cx, cy, cz] = nodes[i].ra.pos.map((v) => Math.floor(v / 2));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
      if (j <= i || !nodes[j].t) continue;
      const a = nodes[i], b = nodes[j], d = len(sub(a.ra.pos, b.ra.pos));
      const lim = (COV[EL[a.t!.code]] ?? 0.8) + (COV[EL[b.t!.code]] ?? 0.8) + 0.4;
      const same = a.res.key === b.res.key;
      const peptide = !same && ((a.ra.name === 'C' && b.ra.name === 'N') || (a.ra.name === 'N' && b.ra.name === 'C')) && a.res.chain === b.res.chain && d < 1.8;
      if (d < lim && (same || peptide)) bonds.push([i, j]);
    }
  }
  // virtual hydrogens for Gasteiger, then polar hydrogens placed explicitly
  const gn: GasteigerNode[] = nodes.map((x) => ({ el: x.t ? EL[x.t.code] : 'Zn', hyb: x.t ? HYB[x.t.code] : 'sp3', q0: x.t ? x.t.fc : x.ra.q }));
  const gb = bonds.slice(), hOf: number[][] = nodes.map(() => []);
  nodes.forEach((x, i) => { if (!x.t) return; for (let k = 0; k < x.t.nH; k++) { gn.push({ el: 'H', hyb: 'sp3', q0: 0 }); gb.push([i, gn.length - 1]); hOf[i].push(gn.length - 1); } });
  const q = gasteiger(gn, gb);
  const nbrs = nodes.map(() => [] as number[]); for (const [a, b] of bonds) { nbrs[a].push(b); nbrs[b].push(a); }
  const atoms: ReceptorAtom[] = [];
  nodes.forEach((x, i) => {
    let qi = x.t ? q[i] : x.ra.q;
    if (x.t) for (let k = x.t.polar; k < x.t.nH; k++) qi += q[hOf[i][k]]; // merge non-polar hydrogens
    atoms.push({ ...x.ra, q: qi });
    if (x.t && x.t.polar > 0) {
      const nb = nbrs[i].map((j) => nodes[j].ra.pos);
      // planar groups (sp2 N–H, amide NH2) use the neighbour's other substituent as the plane reference
      let ref: V3 | undefined; if (nbrs[i].length === 1) { const other = nbrs[nbrs[i][0]].find((j) => j !== i && nodes[j].t && EL[nodes[j].t!.code] !== 'H'); if (other != null) ref = nodes[other].ra.pos; }
      placeHydrogens(x.ra.pos, nb, x.t.polar, x.t.code === 'N2', ref).forEach((p, k) => atoms.push({ name: `H${x.ra.name.slice(1) || 'N'}${x.t!.polar > 1 ? k + 1 : ''}`.slice(0, 4), res: x.ra.res, chain: x.ra.chain, seq: x.ra.seq, pos: p, q: q[hOf[i][k]], type: 'HD' }));
    }
  });
  out.push(...atoms);
  const pdbqt = out.map((a, i) => atomLine(i + 1, a.name, a.res, a.chain, a.seq, a.pos, a.q, a.type)).join('\n') + '\nEND\n';
  return { atoms: out, pdbqt, residues, warnings, dropped };
}
