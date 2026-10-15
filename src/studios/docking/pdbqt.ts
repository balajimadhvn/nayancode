/** PDBQT writing (ligand torsion tree, rigid receptor), PDBQT pose parsing and symmetry-corrected RMSD. Clean-room, from the
 *  PDBQT format as read by AutoDock Vina (fixed columns; ROOT / BRANCH / ENDBRANCH / TORSDOF). */
import { ad4Types, hybridisation, ligandCharges, neighbours, rotatableBonds, type MolG } from './molgraph';

export type V3 = [number, number, number];
export interface PdbqtAtom { serial: number; name: string; res: string; chain: string; seq: number; x: number; y: number; z: number; q: number; type: string }

const f = (v: number, w: number, d: number) => v.toFixed(d).padStart(w);
export function atomLine(serial: number, name: string, res: string, chain: string, seq: number, p: V3, q: number, type: string, het = false): string {
  const nm = name.length >= 4 ? name.slice(0, 4) : ` ${name}`.padEnd(4);
  const qs = (q >= 0 ? '+' : '-') + Math.abs(q).toFixed(3);
  return `${het ? 'HETATM' : 'ATOM  '}${String(serial).padStart(5)} ${nm.padEnd(4)} ${res.padStart(3)} ${chain.slice(0, 1) || 'A'}${String(seq).padStart(4)}    ${f(p[0], 8, 3)}${f(p[1], 8, 3)}${f(p[2], 8, 3)}${f(1, 6, 2)}${f(0, 6, 2)}    ${qs.padStart(6)} ${type.padEnd(2)}`;
}

export interface LigandPdbqt {
  text: string;
  /** index in the PDBQT (0-based, in file order) → atom index in the source molecule */
  atomMap: number[];
  rotatable: number;
  heavyAtoms: number;
  charges: Float64Array;
  types: string[];
}

/** Ligand → PDBQT: Gasteiger charges, merged non-polar hydrogens, AutoDock types and a torsion tree rooted at the most central rigid fragment. */
export function ligandToPdbqt(m: MolG, coords?: number[][]): LigandPdbqt {
  const nb = neighbours(m), hyb = hybridisation(m, nb);
  let q = ligandCharges(m, hyb);
  const types = ad4Types(m, hyb, nb);
  // merge non-polar hydrogens into their heavy atom
  const keep = m.atoms.map((_, i) => types[i] !== 'H');
  q = Float64Array.from(q);
  m.atoms.forEach((_, i) => { if (types[i] === 'H' && nb[i].length) q[nb[i][0]] += q[i]; });
  const pos = (i: number): V3 => (coords ? [coords[i][0], coords[i][1], coords[i][2]] : [m.atoms[i].x, m.atoms[i].y, m.atoms[i].z]);

  // rigid groups: union-find over non-rotatable bonds
  const rot = new Set(rotatableBonds(m, nb));
  const parent = m.atoms.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  m.bonds.forEach((b, k) => { if (!rot.has(k)) parent[find(b.a)] = find(b.b); });
  const groupOf = m.atoms.map((_, i) => find(i));
  const groupAtoms = new Map<number, number[]>();
  m.atoms.forEach((_, i) => { if (keep[i]) (groupAtoms.get(groupOf[i]) ?? groupAtoms.set(groupOf[i], []).get(groupOf[i])!).push(i); });
  const gids = [...groupAtoms.keys()];
  // group tree (edges = rotatable bonds)
  const edges = new Map<number, { to: number; from: number; atomFrom: number; atomTo: number }[]>();
  gids.forEach((g) => edges.set(g, []));
  for (const k of rot) { const b = m.bonds[k]; const ga = groupOf[b.a], gb = groupOf[b.b]; edges.get(ga)!.push({ to: gb, from: ga, atomFrom: b.a, atomTo: b.b }); edges.get(gb)!.push({ to: ga, from: gb, atomFrom: b.b, atomTo: b.a }); }
  // root = group minimising the largest remaining component (tree centroid, weighted by atom count)
  const sizeBelow = (g: number, from: number): number => (groupAtoms.get(g)!.length + edges.get(g)!.filter((e) => e.to !== from).reduce((s, e) => s + sizeBelow(e.to, g), 0));
  let root = gids[0], best = Infinity;
  for (const g of gids) { const worst = Math.max(0, ...edges.get(g)!.map((e) => sizeBelow(e.to, g))); if (worst < best) { best = worst; root = g; } }

  const lines: string[] = [], atomMap: number[] = [], serial = new Map<number, number>();
  let n = 0, torsions = 0;
  const emit = (i: number) => { n++; serial.set(i, n); atomMap.push(i); const el = m.atoms[i].el; lines.push(atomLine(n, `${el}${n}`, 'LIG', 'A', 1, pos(i), q[i], types[i], true)); };
  const walk = (g: number, from: number, entry: number | null) => {
    const atoms = groupAtoms.get(g)!.slice();
    if (entry != null) atoms.sort((a, b) => (a === entry ? -1 : b === entry ? 1 : 0) || a - b);
    for (const a of atoms) emit(a);
    for (const e of edges.get(g)!) {
      if (e.to === from) continue;
      torsions++;
      const pa = serial.get(e.atomFrom)!, nextSerial = n + 1;
      lines.push(`BRANCH ${String(pa).padStart(3)} ${String(nextSerial).padStart(3)}`);
      walk(e.to, g, e.atomTo);
      lines.push(`ENDBRANCH ${String(pa).padStart(3)} ${String(nextSerial).padStart(3)}`);
    }
  };
  // root group atoms are written inside ROOT … ENDROOT, then branches
  lines.push('ROOT');
  for (const a of groupAtoms.get(root)!) emit(a);
  lines.push('ENDROOT');
  for (const e of edges.get(root)!) {
    torsions++;
    const pa = serial.get(e.atomFrom)!, nextSerial = n + 1;
    lines.push(`BRANCH ${String(pa).padStart(3)} ${String(nextSerial).padStart(3)}`);
    walk(e.to, root, e.atomTo);
    lines.push(`ENDBRANCH ${String(pa).padStart(3)} ${String(nextSerial).padStart(3)}`);
  }
  lines.push(`TORSDOF ${torsions}`);
  const header = [`REMARK  Name = ${m.name || 'ligand'}`, `REMARK  ${torsions} active torsions; ${m.atoms.filter((a) => a.el !== 'H').length} heavy atoms`];
  return { text: [...header, ...lines].join('\n') + '\n', atomMap, rotatable: torsions, heavyAtoms: m.atoms.filter((a) => a.el !== 'H').length, charges: q, types };
}

// ---------------------------------------------------------------- reading poses

export interface Pose { model: number; affinity: number; rmsdLb: number; rmsdUb: number; atoms: PdbqtAtom[] }

/** Parses Vina output (MODEL blocks with `REMARK VINA RESULT:`). Also accepts a single ligand block without remarks. */
export function parsePoses(text: string): Pose[] {
  const poses: Pose[] = [];
  let cur: Pose | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('MODEL')) cur = { model: parseInt(line.slice(5), 10) || poses.length + 1, affinity: NaN, rmsdLb: 0, rmsdUb: 0, atoms: [] };
    else if (line.startsWith('REMARK VINA RESULT:')) { if (!cur) cur = { model: poses.length + 1, affinity: NaN, rmsdLb: 0, rmsdUb: 0, atoms: [] }; const t = line.slice(19).trim().split(/\s+/).map(Number); cur.affinity = t[0]; cur.rmsdLb = t[1]; cur.rmsdUb = t[2]; }
    else if (line.startsWith('ATOM') || line.startsWith('HETATM')) {
      if (!cur) cur = { model: poses.length + 1, affinity: NaN, rmsdLb: 0, rmsdUb: 0, atoms: [] };
      cur.atoms.push({ serial: parseInt(line.slice(6, 11), 10), name: line.slice(12, 16).trim(), res: line.slice(17, 20).trim(), chain: line.slice(21, 22), seq: parseInt(line.slice(22, 26), 10), x: parseFloat(line.slice(30, 38)), y: parseFloat(line.slice(38, 46)), z: parseFloat(line.slice(46, 54)), q: parseFloat(line.slice(70, 76)), type: line.slice(77, 79).trim() });
    } else if (line.startsWith('ENDMDL') && cur) { poses.push(cur); cur = null; }
  }
  if (cur && cur.atoms.length) poses.push(cur);
  return poses;
}

/** One model per pose, with the Vina REMARK line, as a multi-model PDBQT. */
export function posesToPdbqt(poses: Pose[]): string {
  return poses.map((p, i) => [`MODEL ${i + 1}`, `REMARK VINA RESULT: ${p.affinity.toFixed(3).padStart(9)} ${p.rmsdLb.toFixed(3).padStart(9)} ${p.rmsdUb.toFixed(3).padStart(9)}`,
    ...p.atoms.map((a) => atomLine(a.serial, a.name, a.res, a.chain || 'A', a.seq, [a.x, a.y, a.z], a.q, a.type, true)), 'ENDMDL'].join('\n')).join('\n') + '\n';
}

/** Docked poses as a multi-record SDF: heavy atoms and polar hydrogens (the only atoms in the PDBQT) with the source bonds and charges. */
export function posesToSdf(m: MolG, atomMap: number[], poses: Pose[], name: string): string {
  const idx = new Map(atomMap.map((a, k) => [a, k]));
  const keepAtoms = atomMap.slice().sort((a, b) => a - b), newIndex = new Map(keepAtoms.map((a, k) => [a, k]));
  const bonds = m.bonds.filter((b) => idx.has(b.a) && idx.has(b.b));
  return poses.map((p, pi) => {
    const pad = (n: number) => String(n).padStart(3);
    const L = [`${name}_pose${pi + 1}`, '  Nayancode docking', `> Vina affinity ${p.affinity}`, `${pad(keepAtoms.length)}${pad(bonds.length)}  0  0  0  0  0  0  0  0999 V2000`];
    for (const a of keepAtoms) { const at = p.atoms[idx.get(a)!]; L.push(`${f(at.x, 10, 4)}${f(at.y, 10, 4)}${f(at.z, 10, 4)} ${m.atoms[a].el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`); }
    for (const b of bonds) L.push(`${pad(newIndex.get(b.a)! + 1)}${pad(newIndex.get(b.b)! + 1)}${pad(b.aromatic ? 4 : b.order)}  0`);
    const ch = keepAtoms.map((a, k) => [k, m.atoms[a].fc] as const).filter(([, c]) => c);
    for (let k = 0; k < ch.length; k += 8) { const part = ch.slice(k, k + 8); L.push(`M  CHG${pad(part.length)}${part.map(([i, c]) => ` ${pad(i + 1)} ${pad(c)}`).join('')}`); }
    L.push('M  END', '> <VINA_AFFINITY_KCAL_MOL>', p.affinity.toFixed(3), '', '> <RMSD_LB>', p.rmsdLb.toFixed(3), '', '> <RMSD_UB>', p.rmsdUb.toFixed(3), '', '$$$$');
    return L.join('\n');
  }).join('\n') + '\n';
}

// ---------------------------------------------------------------- RMSD

const d2 = (a: V3, b: V3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Plain RMSD for two coordinate lists with the same atom order (no superposition: docking RMSD is in the receptor frame). */
export function rmsdOrdered(a: V3[], b: V3[]): number {
  if (a.length !== b.length || !a.length) throw new Error('RMSD needs two equally long, non-empty coordinate lists.');
  let s = 0; for (let i = 0; i < a.length; i++) s += d2(a[i], b[i]);
  return Math.sqrt(s / a.length);
}

/** Heavy-atom graph automorphisms (same element, same bond order), enumerated by backtracking up to `cap` mappings. */
export function automorphisms(el: string[], bonds: [number, number, number][], cap = 20000): number[][] {
  const n = el.length, nb = el.map(() => new Map<number, number>());
  for (const [a, b, o] of bonds) { nb[a].set(b, o); nb[b].set(a, o); }
  const deg = nb.map((x) => x.size), order = [0], seen = new Set([0]);
  for (let h = 0; h < order.length; h++) for (const j of nb[order[h]].keys()) if (!seen.has(j)) { seen.add(j); order.push(j); }
  for (let i = 0; i < n; i++) if (!seen.has(i)) order.push(i);
  const out: number[][] = [], map = new Array<number>(n).fill(-1), used = new Uint8Array(n);
  const rec = (k: number) => {
    if (out.length >= cap) return;
    if (k === n) { out.push(map.slice()); return; }
    const i = order[k];
    for (let t = 0; t < n; t++) {
      if (used[t] || el[t] !== el[i] || deg[t] !== deg[i]) continue;
      let ok = true;
      for (const [j, o] of nb[i]) if (map[j] >= 0 && nb[t].get(map[j]) !== o) { ok = false; break; }
      if (!ok) continue;
      map[i] = t; used[t] = 1; rec(k + 1); map[i] = -1; used[t] = 0;
    }
  };
  rec(0);
  return out;
}

/** Symmetry-corrected heavy-atom RMSD: the minimum over graph automorphisms of the ligand (equivalent atoms, e.g. carboxylate oxygens). */
export function symmetryRmsd(el: string[], bonds: [number, number, number][], ref: V3[], pose: V3[], autos?: number[][]): number {
  const A = autos ?? automorphisms(el, bonds);
  let best = Infinity;
  for (const p of A) { let s = 0; for (let i = 0; i < ref.length; i++) s += d2(ref[i], pose[p[i]]); if (s < best) best = s; }
  return Math.sqrt(best / ref.length);
}
