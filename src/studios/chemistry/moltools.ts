/**
 * Molecule tools on top of RDKit (WebAssembly, BSD-3): Bemis–Murcko scaffolds, maximum common substructure, R-group
 * decomposition, reaction enumeration, a 2-D pharmacophore pair fingerprint and USR 3-D shape similarity.
 * The pharmacophore and USR code is written from the published descriptions (Gobbi & Poppinger 1998; Ballester & Richards 2007).
 */
import { neighbours, parseMolBlock, toMolBlock, type MolG } from '../docking/molgraph';
import { ligandFromSmiles, type RDKitModule } from '../docking/rdkitBridge';

interface RdMolX { is_valid(): boolean; delete(): void; get_smiles(): string; get_molblock(): string; set_new_coords(): boolean; get_substruct_matches(q: RdMolX): string; get_svg_with_highlights(d: string): string; get_svg(w?: number, h?: number): string }
interface MolListX { append(m: RdMolX): number; at(i: number): RdMolX | null; size(): number; delete(): void }
interface RxnX { run_reactants(l: MolListX, max: number): { get(i: number): MolListX | undefined; size(): number; delete(): void }; delete(): void }
interface RgdX { add(m: RdMolX): number; process(): boolean; get_rgroups_as_rows(): Record<string, RdMolX>[]; delete(): void }
export interface RDFull {
  version(): string; get_mol(s: string, d?: string): RdMolX | null; get_qmol(s: string): RdMolX | null;
  MolList: new () => MolListX;
  get_rxn(s: string): RxnX | null;
  get_rgd(core: RdMolX, details?: string): RgdX | null;
  get_mcs_as_json(l: MolListX, details?: string): string;
}
const full = (RD: RDKitModule) => RD as unknown as RDFull;
const parse = (RD: RDFull, smi: string) => { const m = RD.get_mol(smi); if (!m || !m.is_valid()) { m?.delete(); return null; } return m; };

// ---------------------------------------------------------------- Bemis–Murcko scaffolds
export interface Scaffold { scaffold: string; generic: string; rings: number }
/** Ring systems plus the linkers between them; exocyclic double-bonded atoms (for example C=O) are kept, as RDKit does. */
export function murcko(RDm: RDKitModule, smiles: string): Scaffold | null {
  const RD = full(RDm), m = parse(RD, smiles); if (!m) return null;
  let g: MolG;
  try { m.set_new_coords(); g = parseMolBlock(m.get_molblock()); } finally { m.delete(); }
  const nb = neighbours(g), n = g.atoms.length, inRing = new Array<boolean>(n).fill(false);
  // ring atoms: members of a cycle, found by repeatedly removing degree-1 atoms (what remains has cycles or links between them)
  const deg = nb.map((x) => x.length), alive = new Array<boolean>(n).fill(true), q: number[] = [];
  deg.forEach((d, i) => { if (d <= 1) q.push(i); });
  while (q.length) { const i = q.pop()!; if (!alive[i]) continue; alive[i] = false; for (const j of nb[i]) if (alive[j] && --deg[j] <= 1) q.push(j); }
  if (!alive.some(Boolean)) return { scaffold: '', generic: '', rings: 0 };
  for (let i = 0; i < n; i++) inRing[i] = alive[i];
  const keep = [...alive];
  for (const b of g.bonds) { // exocyclic double bonds
    if (b.order === 2 && !b.aromatic) { if (keep[b.a] && !keep[b.b]) keep[b.b] = true; else if (keep[b.b] && !keep[b.a]) keep[b.a] = true; }
  }
  const idx = new Map<number, number>(); const atoms = g.atoms.filter((_, i) => keep[i]); g.atoms.forEach((_, i) => { if (keep[i]) idx.set(i, idx.size); });
  const bonds = g.bonds.filter((b) => keep[b.a] && keep[b.b]).map((b) => ({ ...b, a: idx.get(b.a)!, b: idx.get(b.b)! }));
  const sub: MolG = { ...g, atoms, bonds, aromaticAtom: [], rings: [] };
  const toSmiles = (mg: MolG) => { const r = RD.get_mol(toMolBlock(mg)); if (!r || !r.is_valid()) { r?.delete(); return ''; } try { return r.get_smiles(); } finally { r.delete(); } };
  const scaffold = toSmiles(sub);
  const generic = toSmiles({ ...sub, atoms: atoms.map((a) => ({ ...a, el: 'C', fc: 0 })), bonds: bonds.map((b) => ({ ...b, order: 1, aromatic: false })) });
  const ringCount = Math.round(g.bonds.filter((b) => inRing[b.a] && inRing[b.b]).length - inRing.filter(Boolean).length + 1);
  return { scaffold, generic, rings: Math.max(0, ringCount) };
}

// ---------------------------------------------------------------- maximum common substructure
export interface McsResult { smarts: string; atoms: number; bonds: number; canceled: boolean }
export function mcs(RDm: RDKitModule, smiles: string[], opt: { timeout?: number; ringsOnly?: boolean; anyElement?: boolean } = {}): McsResult {
  const RD = full(RDm); const list = new RD.MolList(); const held: RdMolX[] = [];
  try {
    for (const s of smiles) { const m = parse(RD, s); if (m) { list.append(m); held.push(m); } }
    if (held.length < 2) throw new Error('Need at least two valid molecules.');
    const r = JSON.parse(RD.get_mcs_as_json(list, JSON.stringify({ Timeout: opt.timeout ?? 10, RingMatchesRingOnly: !!opt.ringsOnly, CompleteRingsOnly: !!opt.ringsOnly, AtomCompare: opt.anyElement ? 'Any' : 'Elements', BondCompare: opt.anyElement ? 'Any' : 'Order' })));
    return { smarts: r.smarts ?? '', atoms: r.numAtoms ?? 0, bonds: r.numBonds ?? 0, canceled: !!r.canceled };
  } finally { held.forEach((m) => m.delete()); list.delete(); }
}
/** SVG of a molecule with the atoms matching a SMARTS pattern highlighted (empty string when it does not match). */
export function highlight(RDm: RDKitModule, smiles: string, smarts: string, w = 220, h = 160): string {
  const RD = full(RDm), m = parse(RD, smiles), q = RD.get_qmol(smarts);
  try {
    if (!m || !q || !q.is_valid()) return '';
    const r = JSON.parse(m.get_substruct_matches(q) || '[]'); const hit = Array.isArray(r) ? r[0] : r;
    if (!hit?.atoms?.length) return m.get_svg(w, h);
    return m.get_svg_with_highlights(JSON.stringify({ atoms: hit.atoms, bonds: hit.bonds, width: w, height: h }));
  } finally { m?.delete(); q?.delete(); }
}

// ---------------------------------------------------------------- R-group decomposition
export interface RGroupRow { smiles: string; matched: boolean; groups: Record<string, string> }
export function rgroups(RDm: RDKitModule, coreSmiles: string, smiles: string[]): { rows: RGroupRow[]; columns: string[]; unmatched: number } {
  const RD = full(RDm), core = RD.get_qmol(coreSmiles) ?? parse(RD, coreSmiles);
  if (!core || !core.is_valid()) throw new Error('The core is not a valid SMILES or SMARTS pattern.');
  const rgd = RD.get_rgd(core, JSON.stringify({ allowMultipleRGroupsOnUnlabelled: true, onlyMatchAtRGroups: false }));
  if (!rgd) { core.delete(); throw new Error('R-group decomposition could not be set up for this core.'); }
  const idxFor: number[] = [], matchedIdx: number[] = [];
  try {
    smiles.forEach((s, i) => { const m = parse(RD, s); idxFor[i] = -1; if (m) { try { idxFor[i] = rgd.add(m); } finally { m.delete(); } } });
    rgd.process();
    const rows = rgd.get_rgroups_as_rows(); const columns: string[] = [];
    const out: RGroupRow[] = smiles.map((s, i) => {
      const k = idxFor[i]; if (k < 0 || !rows[k]) return { smiles: s, matched: false, groups: {} };
      matchedIdx.push(i); const groups: Record<string, string> = {};
      for (const [name, mol] of Object.entries(rows[k])) { if (name === 'Core') continue; groups[name] = mol.get_smiles(); if (!columns.includes(name)) columns.push(name); }
      return { smiles: s, matched: true, groups };
    });
    columns.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    return { rows: out, columns, unmatched: out.filter((r) => !r.matched).length };
  } finally { core.delete(); rgd.delete(); }
}

// ---------------------------------------------------------------- reaction enumeration
export const REACTIONS: { id: string; name: string; smarts: string; hint: string[] }[] = [
  { id: 'amide', name: 'Amide coupling', smarts: '[C:1](=[O:2])[OH].[N;H2,H1;!$(N-C=O):3]>>[C:1](=[O:2])[N:3]', hint: ['carboxylic acids', 'amines'] },
  { id: 'reductive', name: 'Reductive amination', smarts: '[C;H1:1]=[O:2].[N;H2,H1;!$(N-C=O):3]>>[C:1][N:3]', hint: ['aldehydes', 'amines'] },
  { id: 'suzuki', name: 'Suzuki coupling', smarts: '[c:1][Br,I].[c:2][B]([OH])[OH]>>[c:1][c:2]', hint: ['aryl bromides / iodides', 'aryl boronic acids'] },
  { id: 'sulfonamide', name: 'Sulfonamide formation', smarts: '[S:1](=[O:2])(=[O:3])Cl.[N;H2,H1;!$(N-C=O):4]>>[S:1](=[O:2])(=[O:3])[N:4]', hint: ['sulfonyl chlorides', 'amines'] },
  { id: 'ester', name: 'Esterification', smarts: '[C:1](=[O:2])[OH].[OH;$(O[CX4]):3]>>[C:1](=[O:2])[O:3]', hint: ['carboxylic acids', 'alcohols'] },
];
export interface Enumerated { products: string[]; combos: number; truncated: boolean; invalid: number }
export function enumerate(RDm: RDKitModule, rxnSmarts: string, lists: string[][], maxProducts = 2000): Enumerated {
  const RD = full(RDm), rxn = RD.get_rxn(rxnSmarts);
  if (!rxn) throw new Error('RDKit could not read the reaction SMARTS.');
  const seen = new Set<string>(); let combos = 0, invalid = 0, truncated = false;
  const mols = lists.map((l) => l.map((s) => ({ s, m: parse(RD, s) })));
  try {
    mols.forEach((l) => l.forEach((x) => { if (!x.m) invalid++; }));
    const valid = mols.map((l) => l.filter((x) => x.m));
    const rec = (k: number, pick: RdMolX[]) => {
      if (truncated) return;
      if (k === valid.length) {
        combos++; const ml = new RD.MolList(); pick.forEach((m) => ml.append(m));
        try {
          const res = rxn.run_reactants(ml, 50);
          try { for (let i = 0; i < res.size(); i++) { const set = res.get(i)!; for (let j = 0; j < set.size(); j++) { const p = set.at(j)!; const smi = p.get_smiles(); p.delete(); if (smi) seen.add(smi); if (seen.size >= maxProducts) { truncated = true; return; } } set.delete(); } } finally { res.delete(); }
        } catch { /* reactants that do not match the template produce nothing */ } finally { ml.delete(); }
        return;
      }
      for (const x of valid[k]) rec(k + 1, [...pick, x.m!]);
    };
    rec(0, []);
  } finally { mols.forEach((l) => l.forEach((x) => x.m?.delete())); rxn.delete(); }
  return { products: [...seen], combos, truncated, invalid };
}

// ---------------------------------------------------------------- 2-D pharmacophore pair fingerprint
export const FEATURES: { id: string; name: string; smarts: string }[] = [
  { id: 'D', name: 'H-bond donor', smarts: '[#7,#8;!H0]' },
  { id: 'A', name: 'H-bond acceptor', smarts: '[$([#8;!$([#8]-C=O)]),$([#7;X2;!$([#7]-[#6]=[#8])]),$([nX2])]' },
  { id: 'R', name: 'Aromatic ring', smarts: 'a1aaaaa1' },
  { id: 'H', name: 'Hydrophobe', smarts: '[$([#6;!$([#6]~[#7,#8,#16,F]);!$([#6]=*)]),Cl,Br,I]' },
  { id: '+', name: 'Positive', smarts: '[$([NX3;H2,H1,H0;!$(N-[#6]=[#6,#7,#8,#16]);!$(N-a);!$(N-S);!$(N-O)]),$([#7+;!$([#7+]-[O-]);!$([#7+]=O)])]' },
  { id: '-', name: 'Negative', smarts: '[$([CX3](=O)[OH,O-]),$([SX4](=O)(=O)[OH,O-]),$([PX4](=O)[OH,O-]),$([#8-;!$([#8-]-[#7+])])]' },
];
const BINS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 13, 17, 100];
const bin = (d: number) => BINS.findIndex((b, i) => d >= b && d < BINS[i + 1]);

export interface Pharmacophore { counts: Map<string, number>; features: Record<string, number> }
function distances(nb: number[][], from: number): number[] { const d = new Array(nb.length).fill(Infinity); d[from] = 0; const q = [from]; for (let h = 0; h < q.length; h++) for (const j of nb[q[h]]) if (d[j] === Infinity) { d[j] = d[q[h]] + 1; q.push(j); } return d; }
export function pharmacophore(RDm: RDKitModule, smiles: string): Pharmacophore | null {
  const RD = full(RDm), m = parse(RD, smiles); if (!m) return null;
  let g: MolG; try { m.set_new_coords(); g = parseMolBlock(m.get_molblock()); } finally { /* keep m for matching */ }
  const nb = neighbours(g), sets: { f: string; atoms: number[] }[] = [];
  try {
    for (const f of FEATURES) {
      const q = RD.get_qmol(f.smarts); if (!q || !q.is_valid()) { q?.delete(); continue; }
      try { const r = JSON.parse(m.get_substruct_matches(q) || '[]'); const hits = Array.isArray(r) ? r : r.atoms ? [r] : []; const seen = new Set<string>();
        for (const h of hits) { const a = [...h.atoms].sort((x: number, y: number) => x - y); const key = f.id === 'R' ? a.join(',') : String(a[0]); if (seen.has(key)) continue; seen.add(key); sets.push({ f: f.id, atoms: f.id === 'R' ? a : [a[0]] }); } } finally { q.delete(); }
    }
  } finally { m.delete(); }
  const all = nb.map((_, i) => distances(nb, i));
  const counts = new Map<string, number>(), features: Record<string, number> = {};
  sets.forEach((s) => { features[s.f] = (features[s.f] ?? 0) + 1; });
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const d = Math.min(...sets[j].atoms.map((a) => Math.min(...sets[i].atoms.map((b) => all[b][a]))));
    const [x, y] = [sets[i].f, sets[j].f].sort(); const key = `${x}${y}${bin(d)}`; counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { counts, features };
}
/** Min/max (Ruzicka) similarity of two pair-count fingerprints; equals Tanimoto when counts are 0/1. */
export function pharmSimilarity(a: Pharmacophore, b: Pharmacophore): number {
  let mn = 0, mx = 0; const keys = new Set([...a.counts.keys(), ...b.counts.keys()]);
  for (const k of keys) { const x = a.counts.get(k) ?? 0, y = b.counts.get(k) ?? 0; mn += Math.min(x, y); mx += Math.max(x, y); }
  return mx ? mn / mx : 0;
}

// ---------------------------------------------------------------- USR shape similarity
export type Usr = number[];
const stats = (d: number[]): number[] => { const n = d.length, mu = d.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / n); const sk = d.reduce((a, b) => a + (b - mu) ** 3, 0) / n; return [mu, sd, Math.cbrt(sk)]; };
/** 12 Ultrafast Shape Recognition moments from heavy-atom coordinates (Ballester & Richards 2007). */
export function usrDescriptor(xyz: number[][]): Usr {
  if (xyz.length < 4) throw new Error('USR needs at least four heavy atoms.');
  const n = xyz.length, ctd = [0, 1, 2].map((k) => xyz.reduce((a, p) => a + p[k], 0) / n);
  const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const argExt = (ref: number[], far: boolean) => { let bi = 0, bd = far ? -1 : Infinity; xyz.forEach((p, i) => { const d = dist(p, ref); if (far ? d > bd : d < bd) { bd = d; bi = i; } }); return xyz[bi]; };
  const cst = argExt(ctd, false), fct = argExt(ctd, true), ftf = argExt(fct, true);
  return [ctd, cst, fct, ftf].flatMap((r) => stats(xyz.map((p) => dist(p, r))));
}
export const usrSimilarity = (a: Usr, b: Usr) => 1 / (1 + a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / 12);
/** USR descriptor from a SMILES using the in-house 3-D embedder (single conformer, seed fixed for reproducibility). */
export function usrFromSmiles(RDm: RDKitModule, smiles: string): Usr | null {
  let L; try { L = ligandFromSmiles(RDm, smiles, { protonate: false, seed: 7 }); } catch { return null; }
  const xyz = L.mol.atoms.filter((a) => a.el !== 'H').map((a) => [a.x, a.y, a.z]);
  return xyz.length >= 4 ? usrDescriptor(xyz) : null;
}

/** Plain 2-D depiction as SVG ('' for invalid input). */
export function svgOf(RDm: RDKitModule, smiles: string, w = 180, h = 130): string {
  const RD = full(RDm), m = parse(RD, smiles); if (!m) return '';
  try { return m.get_svg(w, h); } finally { m.delete(); }
}
