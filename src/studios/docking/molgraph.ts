/** Small-molecule graph used by Docking Studio: parsing of MOL/SDF and MOL2, hybridisation, Gasteiger–Marsili partial charges
 *  (Gasteiger & Marsili 1980, clean-room from the paper's equations and published a/b/c parameters) and AutoDock atom typing.
 *  Pure TypeScript; RDKit (BSD) supplies the chemistry perception (aromaticity, rings, hydrogens) in rdkitBridge.ts. */

export interface MAtom { el: string; x: number; y: number; z: number; fc: number }
export interface MBond { a: number; b: number; order: number; aromatic: boolean; wedge: number }
export interface MolG {
  name: string;
  atoms: MAtom[];
  bonds: MBond[];
  aromaticAtom: boolean[];
  rings: number[][];
  is3d: boolean;
}

export const neighbours = (m: MolG): number[][] => {
  const nb = m.atoms.map(() => [] as number[]);
  for (const b of m.bonds) { nb[b.a].push(b.b); nb[b.b].push(b.a); }
  return nb;
};

const CHG_CODE: Record<number, number> = { 0: 0, 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 };
const cap = (s: string) => (s.length > 1 ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s.toUpperCase());

/** V2000 molfile (first record of an SDF). Aromatic bond type 4 is kept as aromatic. */
export function parseMolBlock(text: string): MolG {
  const L = text.split(/\r?\n/);
  const counts = L[3] ?? '';
  if (/V3000/.test(counts)) throw new Error('V3000 molfiles are not supported: save the ligand as V2000 SDF, MOL2 or SMILES.');
  const na = parseInt(counts.slice(0, 3), 10), nb = parseInt(counts.slice(3, 6), 10);
  if (!Number.isFinite(na) || !Number.isFinite(nb) || na <= 0) throw new Error('Could not read the atom and bond counts of the MOL block.');
  const atoms: MAtom[] = [], bonds: MBond[] = [];
  for (let i = 0; i < na; i++) {
    const l = L[4 + i] ?? '';
    atoms.push({ x: parseFloat(l.slice(0, 10)), y: parseFloat(l.slice(10, 20)), z: parseFloat(l.slice(20, 30)), el: cap(l.slice(31, 34).trim()), fc: CHG_CODE[parseInt(l.slice(36, 39), 10) || 0] ?? 0 });
  }
  const arom = atoms.map(() => false);
  for (let i = 0; i < nb; i++) {
    const l = L[4 + na + i] ?? '';
    const a = parseInt(l.slice(0, 3), 10) - 1, b = parseInt(l.slice(3, 6), 10) - 1, t = parseInt(l.slice(6, 9), 10), w = parseInt(l.slice(9, 12), 10) || 0;
    if (!(a >= 0 && b >= 0 && a < na && b < na)) throw new Error('A bond refers to a missing atom.');
    const aromatic = t === 4;
    if (aromatic) { arom[a] = true; arom[b] = true; }
    bonds.push({ a, b, order: aromatic ? 1.5 : t, aromatic, wedge: w });
  }
  for (const l of L.slice(4 + na + nb)) {
    if (l.startsWith('M  CHG')) { const n = parseInt(l.slice(6, 9), 10); for (let k = 0; k < n; k++) { const i = parseInt(l.slice(10 + 8 * k, 13 + 8 * k), 10) - 1, c = parseInt(l.slice(14 + 8 * k, 17 + 8 * k), 10); if (atoms[i]) atoms[i].fc = c; } }
    if (l.startsWith('M  END')) break;
  }
  const is3d = atoms.some((a) => Math.abs(a.z) > 1e-4);
  return { name: (L[0] ?? '').trim(), atoms, bonds, aromaticAtom: arom, rings: [], is3d };
}

/** Writes a V2000 molfile. Formal charges are written in M  CHG lines; coordinates are used as given. */
export function toMolBlock(m: MolG, coords?: Float64Array | number[][]): string {
  const pad = (n: number, w = 3) => String(n).padStart(w);
  const lines = [m.name || 'ligand', '  Nayancode', '', `${pad(m.atoms.length)}${pad(m.bonds.length)}  0  0  0  0  0  0  0  0999 V2000`];
  m.atoms.forEach((a, i) => {
    const c = coords ? (Array.isArray(coords) ? coords[i] : [coords[3 * i], coords[3 * i + 1], coords[3 * i + 2]]) : [a.x, a.y, a.z];
    lines.push(`${c[0].toFixed(4).padStart(10)}${c[1].toFixed(4).padStart(10)}${c[2].toFixed(4).padStart(10)} ${a.el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  });
  for (const b of m.bonds) lines.push(`${pad(b.a + 1)}${pad(b.b + 1)}${pad(b.aromatic ? 4 : b.order)}${pad(b.wedge)}`);
  const ch = m.atoms.map((a, i) => [i, a.fc] as const).filter(([, c]) => c !== 0);
  for (let k = 0; k < ch.length; k += 8) { const part = ch.slice(k, k + 8); lines.push(`M  CHG${pad(part.length)}${part.map(([i, c]) => ` ${pad(i + 1)} ${pad(c)}`).join('')}`); }
  lines.push('M  END');
  return lines.join('\n') + '\n';
}

/** Tripos MOL2 (first molecule) converted to a V2000 molfile string, so RDKit can perceive aromaticity. */
export function mol2ToMolBlock(text: string): string {
  const sec = (name: string) => { const m = text.match(new RegExp(`@<TRIPOS>${name}\\s*\\n([\\s\\S]*?)(?=\\n@<TRIPOS>|$)`)); return m ? m[1].split(/\r?\n/).filter((l) => l.trim()) : []; };
  const mol = sec('MOLECULE'), at = sec('ATOM'), bd = sec('BOND');
  if (!at.length) throw new Error('No @<TRIPOS>ATOM section found in the MOL2 file.');
  const atoms = at.map((l) => { const t = l.trim().split(/\s+/); const type = t[5] ?? ''; const el = type.includes('.') ? type.split('.')[0] : type; return { x: +t[2], y: +t[3], z: +t[4], el: cap(el.replace(/[^A-Za-z]/g, '') || t[1].replace(/[^A-Za-z]/g, '').slice(0, 2)), fc: 0 }; });
  const bonds: MBond[] = bd.map((l) => { const t = l.trim().split(/\s+/); const ty = t[3]; const ar = ty === 'ar'; return { a: +t[1] - 1, b: +t[2] - 1, order: ty === '2' ? 2 : ty === '3' ? 3 : ar ? 1.5 : 1, aromatic: ar, wedge: 0 }; });
  return toMolBlock({ name: (mol[0] ?? 'ligand').trim(), atoms, bonds, aromaticAtom: atoms.map(() => false), rings: [], is3d: true });
}

/** Splits an SDF into its first record's MOL block (everything before $$$$). */
export const firstSdfRecord = (text: string) => text.split(/^\$\$\$\$/m)[0].replace(/^\s*\n/, '');

// ---------------------------------------------------------------- hybridisation, rotors

export type Hyb = 'sp' | 'sp2' | 'sp3';
export function hybridisation(m: MolG, nb = neighbours(m)): Hyb[] {
  const bo = m.atoms.map(() => [] as number[]);
  for (const b of m.bonds) { bo[b.a].push(b.aromatic ? 1.5 : b.order); bo[b.b].push(b.aromatic ? 1.5 : b.order); }
  const hyb: Hyb[] = m.atoms.map((_a, i) => {
    if (m.aromaticAtom[i] || bo[i].some((o) => o === 2 || o === 1.5)) return bo[i].filter((o) => o === 2).length >= 2 || bo[i].includes(3) ? 'sp' : 'sp2';
    if (bo[i].includes(3)) return 'sp';
    return 'sp3';
  });
  // Lone-pair donors conjugated to an sp2/sp neighbour (amide N, aniline N, ester/phenol O, thioether S in rings) are planar.
  m.atoms.forEach((a, i) => {
    if (hyb[i] !== 'sp3' || !['N', 'O', 'S'].includes(a.el) || a.fc > 0) return;
    if (nb[i].some((j) => hyb[j] !== 'sp3' && m.atoms[j].el !== 'H')) hyb[i] = 'sp2';
  });
  return hyb;
}

// ---------------------------------------------------------------- Gasteiger–Marsili

/** Orbital electronegativity χ = a + b q + c q² (Gasteiger & Marsili 1980; Tetrahedron 36:3219). */
const GM: Record<string, [number, number, number]> = {
  H: [7.17, 6.24, -0.56], 'C:sp3': [7.98, 9.18, 1.88], 'C:sp2': [8.79, 9.32, 1.51], 'C:sp': [10.39, 9.45, 0.73],
  'N:sp3': [11.54, 10.82, 1.36], 'N:sp2': [12.87, 11.15, 0.85], 'N:sp': [15.68, 11.7, -0.27],
  'O:sp3': [14.18, 12.92, 1.39], 'O:sp2': [17.07, 13.79, 0.47], F: [14.66, 13.85, 2.31], Cl: [11.0, 9.69, 1.35], Br: [10.08, 8.47, 1.16], I: [9.9, 7.96, 0.96],
  S: [10.14, 9.13, 1.38], P: [8.9, 8.24, 0.96],
};
const gmParams = (el: string, h: Hyb): [number, number, number] => GM[`${el}:${h}`] ?? GM[el] ?? (GM[`${el}:sp3`] ?? GM['C:sp3']);

export interface GasteigerNode { el: string; hyb: Hyb; q0: number }
/** Iterative partial equalisation of orbital electronegativity over the bond graph. Returns one charge per node. */
export function gasteiger(nodes: GasteigerNode[], bonds: [number, number][], iterations = 12): Float64Array {
  const n = nodes.length, q = Float64Array.from(nodes.map((x) => x.q0));
  const P = nodes.map((x) => gmParams(x.el, x.hyb)), nb: number[][] = nodes.map(() => []);
  for (const [a, b] of bonds) { nb[a].push(b); nb[b].push(a); }
  const chi = (i: number, qi: number) => P[i][0] + P[i][1] * qi + P[i][2] * qi * qi;
  const plus = P.map((p, i) => (nodes[i].el === 'H' ? 20.02 : p[0] + p[1] + p[2])); // χ of the cation
  let damp = 1;
  for (let it = 0; it < iterations; it++) {
    damp *= 0.5;
    const x = Float64Array.from({ length: n }, (_, i) => chi(i, q[i])), dq = new Float64Array(n);
    for (let i = 0; i < n; i++) for (const j of nb[i]) { const dx = x[j] - x[i]; dq[i] += dx / (dx < 0 ? plus[j] : plus[i]); }
    for (let i = 0; i < n; i++) q[i] += damp * dq[i];
  }
  return q;
}

export function ligandCharges(m: MolG, hyb = hybridisation(m)): Float64Array {
  return gasteiger(m.atoms.map((a, i) => ({ el: a.el, hyb: hyb[i], q0: a.fc })), m.bonds.map((b) => [b.a, b.b] as [number, number]));
}

// ---------------------------------------------------------------- AutoDock atom types

/** AutoDock4 / Vina atom type of every atom. Hydrogens on N, O, S are HD (kept as polar hydrogens); other hydrogens are 'H' (merged). */
export function ad4Types(m: MolG, hyb = hybridisation(m), nb = neighbours(m)): string[] {
  const hasDouble = (i: number) => m.bonds.some((b) => (b.a === i || b.b === i) && b.order === 2);
  const carbonyl = (c: number) => nb[c].some((j) => (m.atoms[j].el === 'O' || m.atoms[j].el === 'S') && m.bonds.some((b) => b.order === 2 && ((b.a === c && b.b === j) || (b.b === c && b.a === j))));
  return m.atoms.map((a, i) => {
    const heavyNb = nb[i].filter((j) => m.atoms[j].el !== 'H'), nH = nb[i].length - heavyNb.length;
    switch (a.el) {
      case 'H': return nb[i].length && ['N', 'O', 'S'].includes(m.atoms[nb[i][0]].el) ? 'HD' : 'H';
      case 'C': return m.aromaticAtom[i] ? 'A' : 'C';
      case 'N': {
        if (nH > 0 || a.fc > 0) return 'N';
        if (m.aromaticAtom[i]) return nb[i].length === 2 ? 'NA' : 'N';
        if (hyb[i] === 'sp' || hasDouble(i)) return 'NA';
        // neutral tertiary amine is an acceptor unless conjugated to a carbonyl, aryl or sulfonyl group
        if (nb[i].some((j) => m.aromaticAtom[j] || carbonyl(j) || m.atoms[j].el === 'S' || hyb[j] !== 'sp3')) return 'N';
        return 'NA';
      }
      case 'O': return 'OA';
      case 'S': return m.aromaticAtom[i] || nb[i].length <= 2 ? 'SA' : 'S';
      case 'F': case 'P': case 'Cl': case 'Br': case 'I': return a.el;
      case 'Zn': return 'Zn'; case 'Mg': return 'Mg'; case 'Mn': return 'Mn'; case 'Ca': return 'Ca'; case 'Fe': return 'Fe';
      case 'B': return 'B'; case 'Si': return 'Si';
      default: throw new Error(`Element ${a.el} is not supported by AutoDock Vina.`);
    }
  });
}

/** Rotatable bonds (single, acyclic, between two non-terminal heavy atoms; amide, thioamide, amidine/guanidine and sulfonamide-free
 *  conjugated C–N bonds are kept rigid, as in AutoDockTools). Returns bond indices. */
export function rotatableBonds(m: MolG, nb = neighbours(m)): number[] {
  const inRing = ringBonds(m), hyb = hybridisation(m, nb);
  const heavy = (i: number) => nb[i].filter((j) => m.atoms[j].el !== 'H').length;
  const dbl = (i: number, el: string) => nb[i].some((j) => m.atoms[j].el === el && m.bonds.some((b) => b.order === 2 && ((b.a === i && b.b === j) || (b.b === i && b.a === j))));
  const out: number[] = [];
  m.bonds.forEach((b, k) => {
    if (b.order !== 1 || b.aromatic || inRing.has(k)) return;
    const A = m.atoms[b.a], B = m.atoms[b.b];
    if (A.el === 'H' || B.el === 'H' || heavy(b.a) < 2 || heavy(b.b) < 2) return;
    if (hyb[b.a] === 'sp' || hyb[b.b] === 'sp') return; // collinear: not a real torsion
    const amideLike = (c: number, n: number) => m.atoms[c].el === 'C' && m.atoms[n].el === 'N' && (dbl(c, 'O') || dbl(c, 'S') || dbl(c, 'N'));
    if (amideLike(b.a, b.b) || amideLike(b.b, b.a)) return;
    out.push(k);
  });
  return out;
}
export function ringBonds(m: MolG): Set<number> {
  // a bond is in a ring iff its removal leaves its endpoints connected
  const nb = m.atoms.map(() => [] as [number, number][]);
  m.bonds.forEach((b, k) => { nb[b.a].push([b.b, k]); nb[b.b].push([b.a, k]); });
  const res = new Set<number>();
  m.bonds.forEach((b, k) => {
    const seen = new Uint8Array(m.atoms.length); const st = [b.a]; seen[b.a] = 1; let found = false;
    while (st.length && !found) { const u = st.pop()!; for (const [v, kk] of nb[u]) { if (kk === k || seen[v]) continue; if (v === b.b) { found = true; break; } seen[v] = 1; st.push(v); } }
    if (found) res.add(k);
  });
  return res;
}

// ---------------------------------------------------------------- protonation at pH 7.4 (rules applied via RDKit SMARTS in rdkitBridge.ts)

/** Dominant ionisation states near pH 7.4, as [name, SMARTS, atom index inside the match to change, new formal charge].
 *  Typical pKa values: carboxylic acid 4–5, sulfonic/phosphate 1–2, tetrazole 4.9, aliphatic amines 9–11, amidine/guanidine 11–13. */
export const PROTONATION_RULES: { name: string; smarts: string; atom: number; charge: number }[] = [
  { name: 'carboxylic acid', smarts: '[CX3](=O)[OX2H1]', atom: 2, charge: -1 },
  { name: 'sulfonic acid', smarts: '[SX4](=O)(=O)[OX2H1]', atom: 3, charge: -1 },
  { name: 'phosphate/phosphonate', smarts: '[PX4](=O)[OX2H1]', atom: 2, charge: -1 },
  { name: 'tetrazole', smarts: 'c1nn[nH]n1', atom: 3, charge: -1 },
  { name: 'acyl sulfonamide', smarts: '[CX3](=O)[NX3H1][SX4](=O)=O', atom: 2, charge: -1 },
  { name: 'guanidine', smarts: '[NX3;!$(N-C=O);!$(N-S=O)][CX3](=[NX2;!$(N-C=O);!$(N-S=O);!$(N-a);!$(N=C-a)])[NX3;!$(N-C=O)]', atom: 3, charge: 1 },
  { name: 'amidine', smarts: '[CX3;!$(C(-[N,O,S])(-[N,O,S])=*)]([#6,#1])(=[NX2;!$(N-[O,N,S]);!$(N-C=O);!$(N-a)])[NX3;H2,H1;!$(N-C=O);!$(N-a)]', atom: 2, charge: 1 },
  { name: 'aliphatic amine', smarts: '[NX3;H2,H1,H0;+0;!$(N-[!#6;!#1]);!$(N-C=[O,S,N]);!$(N-C#N);!$(N-a);!$(N-C=C);!$(N-[SX4]);!$(N-C-[F,Cl]);!$([NX3;H0,H1]-C-C=O);!$([NX3;H0,H1;R]1CC[N,O,S]CC1)]', atom: 0, charge: 1 },
];
