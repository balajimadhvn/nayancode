/** Structural bioinformatics kernels, clean-room from the published methods (no PLIP / fpocket / GPL code):
 *  PDB + mmCIF parsing · protein–ligand interaction profiling (geometric criteria) · LIGSITE-style pocket detection (Hendlich 1997)
 *  · Shrake–Rupley solvent accessibility · Horn/Kabsch superposition, RMSD, TM-score. */
export interface Atom { serial: number; name: string; alt: string; res: string; chain: string; seq: number; icode: string; x: number; y: number; z: number; el: string; het: boolean; occ: number; b: number }
export interface Structure { atoms: Atom[]; title: string; format: 'pdb' | 'mmcif'; models: number }

const AA3 = new Set(['ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE', 'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL', 'MSE']);
export const ONE: Record<string, string> = { ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', MSE: 'M' };
const WATER = new Set(['HOH', 'WAT', 'H2O', 'DOD']);
const METALS = new Set(['ZN', 'MG', 'CA', 'FE', 'FE2', 'MN', 'CU', 'CU1', 'NI', 'CO', 'CD', 'K', 'NA', 'HG']);
const ADDITIVES = new Set(['SO4', 'PO4', 'GOL', 'EDO', 'PEG', 'ACT', 'DMS', 'MPD', 'BME', 'CL', 'NA', 'K', 'FMT', 'TRS', 'IMD', 'NO3', 'ACY', 'PGE', 'PG4', 'EPE', 'MES', 'CIT', 'TLA', 'SCN', 'BR', 'IOD', 'MG', 'ZN', 'CA']);
export const isProteinRes = (r: string) => AA3.has(r);
const elOf = (name: string, el: string) => (el ? el.toUpperCase() : name.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase());

export function parsePdb(text: string): Structure {
  const atoms: Atom[] = []; let title = '', models = 0, inFirst = true;
  for (const line of text.split(/\r?\n/)) {
    const rec = line.slice(0, 6);
    if (rec === 'TITLE ') title += line.slice(10).trim() + ' ';
    else if (rec === 'MODEL ') { models++; if (models > 1) inFirst = false; }
    else if (inFirst && (rec === 'ATOM  ' || rec === 'HETATM')) {
      const x = parseFloat(line.slice(30, 38)), y = parseFloat(line.slice(38, 46)), z = parseFloat(line.slice(46, 54)); if (!Number.isFinite(x + y + z)) continue;
      const name = line.slice(12, 16).trim(), el = elOf(name, line.slice(76, 78).trim()); if (el === 'H' || el === 'D') continue;
      atoms.push({ serial: +line.slice(6, 11), name, alt: line[16] === ' ' ? '' : line[16], res: line.slice(17, 20).trim(), chain: line[21] || 'A', seq: parseInt(line.slice(22, 26), 10), icode: line[26] === ' ' ? '' : line[26], x, y, z, el, het: rec === 'HETATM', occ: parseFloat(line.slice(54, 60)) || 1, b: parseFloat(line.slice(60, 66)) || 0 });
    }
  }
  if (!atoms.length) throw new Error('No ATOM/HETATM records found. Is this a PDB file?');
  return { atoms: dedupAlt(atoms), title: title.trim(), format: 'pdb', models: Math.max(1, models) };
}
const dedupAlt = (atoms: Atom[]) => atoms.filter((a) => !a.alt || a.alt === 'A' || a.alt === '1');
function tokenize(line: string): string[] { const out: string[] = []; const re = /'([^']*)'(?=\s|$)|"([^"]*)"(?=\s|$)|(\S+)/g; let m: RegExpExecArray | null; while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]); return out; }
export function parseMmcif(text: string): Structure {
  const lines = text.split(/\r?\n/), cols: string[] = []; let i = 0, title = '';
  for (; i < lines.length; i++) { const l = lines[i]; if (l.startsWith('_struct.title')) title = l.slice(13).trim().replace(/^'|'$/g, '') || (lines[i + 1]?.startsWith(';') ? lines[i + 1].slice(1).trim() : ''); if (l.startsWith('loop_') && lines[i + 1]?.startsWith('_atom_site.')) { i++; break; } }
  if (i >= lines.length) throw new Error('No _atom_site loop found. Is this an mmCIF file?');
  while (lines[i]?.startsWith('_atom_site.')) { cols.push(lines[i].trim().slice(11)); i++; }
  const c = (n: string) => cols.indexOf(n), ix = { grp: c('group_PDB'), id: c('id'), el: c('type_symbol'), name: c('label_atom_id'), alt: c('label_alt_id'), res: c('auth_comp_id') >= 0 ? c('auth_comp_id') : c('label_comp_id'), chain: c('auth_asym_id') >= 0 ? c('auth_asym_id') : c('label_asym_id'), seq: c('auth_seq_id') >= 0 ? c('auth_seq_id') : c('label_seq_id'), icode: c('pdbx_PDB_ins_code'), x: c('Cartn_x'), y: c('Cartn_y'), z: c('Cartn_z'), occ: c('occupancy'), b: c('B_iso_or_equiv'), model: c('pdbx_PDB_model_num') };
  if ([ix.x, ix.y, ix.z, ix.name, ix.res].some((v) => v < 0)) throw new Error('mmCIF atom_site loop lacks coordinates or names.');
  const atoms: Atom[] = []; let firstModel = '', models = new Set<string>();
  for (; i < lines.length; i++) {
    const l = lines[i]; if (!l || l.startsWith('#') || l.startsWith('loop_') || l.startsWith('_')) break;
    const t = tokenize(l); if (t.length < cols.length) continue; const model = ix.model >= 0 ? t[ix.model] : '1'; models.add(model); if (!firstModel) firstModel = model; if (model !== firstModel) continue;
    const name = t[ix.name], el = elOf(name, ix.el >= 0 ? t[ix.el] : ''); if (el === 'H' || el === 'D') continue;
    const alt = ix.alt >= 0 && t[ix.alt] !== '.' ? t[ix.alt] : '';
    atoms.push({ serial: +t[ix.id] || atoms.length + 1, name, alt, res: t[ix.res], chain: t[ix.chain], seq: parseInt(t[ix.seq], 10), icode: ix.icode >= 0 && t[ix.icode] !== '?' && t[ix.icode] !== '.' ? t[ix.icode] : '', x: +t[ix.x], y: +t[ix.y], z: +t[ix.z], el, het: ix.grp >= 0 && t[ix.grp] === 'HETATM', occ: ix.occ >= 0 ? +t[ix.occ] || 1 : 1, b: ix.b >= 0 ? +t[ix.b] || 0 : 0 });
  }
  if (!atoms.length) throw new Error('mmCIF contained no atoms.');
  return { atoms: dedupAlt(atoms), title, format: 'mmcif', models: models.size || 1 };
}
export function parseStructure(text: string): Structure { return /^data_|^_atom_site|loop_/m.test(text.slice(0, 5000)) && !/^ATOM  |^HETATM/m.test(text.slice(0, 5000)) ? parseMmcif(text) : /^ATOM  |^HETATM/m.test(text) ? parsePdb(text) : parseMmcif(text); }

// ---------------- groups ----------------
export interface Residue { key: string; res: string; chain: string; seq: number; icode: string; atoms: Atom[] }
export function residues(atoms: Atom[]): Residue[] { const m = new Map<string, Residue>(); for (const a of atoms) { const k = `${a.chain}:${a.seq}${a.icode}:${a.res}`; let r = m.get(k); if (!r) { r = { key: k, res: a.res, chain: a.chain, seq: a.seq, icode: a.icode, atoms: [] }; m.set(k, r); } r.atoms.push(a); } return [...m.values()]; }
export interface LigandInfo { key: string; res: string; chain: string; seq: number; heavy: number }
export function listLigands(s: Structure): LigandInfo[] { return residues(s.atoms.filter((a) => a.het && !WATER.has(a.res) && !isProteinRes(a.res))).filter((r) => r.atoms.length >= 6 && !ADDITIVES.has(r.res)).map((r) => ({ key: r.key, res: r.res, chain: r.chain, seq: r.seq, heavy: r.atoms.length })).sort((a, b) => b.heavy - a.heavy); }
export const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

class Grid {
  cell: number; map = new Map<string, Atom[]>();
  constructor(atoms: Atom[], cell = 5) { this.cell = cell; for (const a of atoms) { const k = this.key(a.x, a.y, a.z); (this.map.get(k) ?? this.map.set(k, []).get(k)!).push(a); } }
  key(x: number, y: number, z: number) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`; }
  near(p: { x: number; y: number; z: number }, r: number): Atom[] { const out: Atom[] = [], c = this.cell, n = Math.ceil(r / c), cx = Math.floor(p.x / c), cy = Math.floor(p.y / c), cz = Math.floor(p.z / c); for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) { const l = this.map.get(`${cx + i},${cy + j},${cz + k}`); if (l) for (const a of l) if (dist(a, p) <= r) out.push(a); } return out; }
}

// ---------------- interactions ----------------
const COV: Record<string, number> = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07, F: 0.57, CL: 1.02, BR: 1.2, I: 1.39 };
export interface Interaction { type: 'hydrogen bond' | 'hydrophobic' | 'salt bridge' | 'pi-stacking' | 'pi-cation' | 'halogen bond' | 'metal coordination' | 'water bridge'; ligAtom: string; protRes: string; protAtom: string; chain: string; seq: number; distance: number; detail?: string }
const bonded = (a: Atom, b: Atom) => dist(a, b) < (COV[a.el] ?? 0.8) + (COV[b.el] ?? 0.8) + 0.4;
function ligBonds(lig: Atom[]) { const nb = lig.map(() => [] as number[]); for (let i = 0; i < lig.length; i++) for (let j = i + 1; j < lig.length; j++) if (bonded(lig[i], lig[j])) { nb[i].push(j); nb[j].push(i); } return nb; }
const centroid = (as: { x: number; y: number; z: number }[]) => ({ x: as.reduce((s, a) => s + a.x, 0) / as.length, y: as.reduce((s, a) => s + a.y, 0) / as.length, z: as.reduce((s, a) => s + a.z, 0) / as.length });
const sub = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: { x: number; y: number; z: number }) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const angleDeg = (u: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }) => (Math.acos(Math.max(-1, Math.min(1, dot(norm(u), norm(v))))) * 180) / Math.PI;
/** Rings among ligand atoms: 5/6-membered cycles that are planar (RMS deviation < 0.25 Å) and aromatic-like (all sp2/aromatic C,N,O,S). */
function findRings(lig: Atom[], nb: number[][]): number[][] {
  const rings: number[][] = [], seen = new Set<string>();
  const dfs = (start: number, cur: number, path: number[]) => { if (path.length > 6) return; for (const n of nb[cur]) { if (n === start && path.length >= 5) { const key = [...path].sort((a, b) => a - b).join(','); if (!seen.has(key)) { seen.add(key); rings.push([...path]); } } else if (!path.includes(n) && n > start) dfs(start, n, [...path, n]); } };
  for (let i = 0; i < lig.length; i++) dfs(i, i, [i]);
  return rings.filter((r) => { const c = centroid(r.map((i) => lig[i])), a = ringNormal(r.map((i) => lig[i])); return r.every((i) => Math.abs(dot(sub(lig[i], c), a)) < 0.25) && r.every((i) => ['C', 'N', 'O', 'S'].includes(lig[i].el)) && r.filter((i) => lig[i].el === 'C').length >= 3 && r.every((i) => nb[i].length <= 3); });
}
function ringNormal(as: Atom[]) { const c = centroid(as); let n = { x: 0, y: 0, z: 0 }; for (let i = 0; i < as.length; i++) { const v = cross(sub(as[i], c), sub(as[(i + 1) % as.length], c)); n = { x: n.x + v.x, y: n.y + v.y, z: n.z + v.z }; } return norm(n); }
const PROT_RINGS: Record<string, string[][]> = { PHE: [['CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ']], TYR: [['CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ']], TRP: [['CG', 'CD1', 'NE1', 'CE2', 'CD2'], ['CD2', 'CE2', 'CE3', 'CZ2', 'CZ3', 'CH2']], HIS: [['CG', 'ND1', 'CD2', 'CE1', 'NE2']] };
const HYDROPHOBIC_ATOMS: Record<string, string[]> = { ALA: ['CB'], VAL: ['CB', 'CG1', 'CG2'], LEU: ['CB', 'CG', 'CD1', 'CD2'], ILE: ['CB', 'CG1', 'CG2', 'CD1'], MET: ['CB', 'CG', 'CE'], PRO: ['CB', 'CG', 'CD'], PHE: ['CB', 'CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ'], TRP: ['CB', 'CG', 'CD1', 'CD2', 'CE2', 'CE3', 'CZ2', 'CZ3', 'CH2'], TYR: ['CB', 'CG', 'CD1', 'CD2', 'CE1', 'CE2'], CYS: ['CB'] };
const DONORS: Record<string, string[]> = { ARG: ['NE', 'NH1', 'NH2'], ASN: ['ND2'], GLN: ['NE2'], HIS: ['ND1', 'NE2'], LYS: ['NZ'], SER: ['OG'], THR: ['OG1'], TRP: ['NE1'], TYR: ['OH'], CYS: ['SG'] };
const ACCEPTORS: Record<string, string[]> = { ASN: ['OD1'], ASP: ['OD1', 'OD2'], GLN: ['OE1'], GLU: ['OE1', 'OE2'], HIS: ['ND1', 'NE2'], SER: ['OG'], THR: ['OG1'], TYR: ['OH'], MET: ['SD'] };
const isDonor = (a: Atom) => (a.name === 'N' && a.res !== 'PRO') || (DONORS[a.res] ?? []).includes(a.name);
const isAcceptor = (a: Atom) => a.name === 'O' || a.name === 'OXT' || (ACCEPTORS[a.res] ?? []).includes(a.name);

export function profileInteractions(s: Structure, ligandKey: string): { interactions: Interaction[]; ligand: Atom[]; contacts: Map<string, number> } {
  const res = residues(s.atoms), ligRes = res.find((r) => r.key === ligandKey); if (!ligRes) throw new Error('Ligand not found.');
  const lig = ligRes.atoms, prot = s.atoms.filter((a) => isProteinRes(a.res) && !a.het || (isProteinRes(a.res))), waters = s.atoms.filter((a) => WATER.has(a.res)), metals = s.atoms.filter((a) => a.het && METALS.has(a.res) && a.res !== ligRes.res);
  const grid = new Grid(prot, 5), nb = ligBonds(lig), out: Interaction[] = [], add = (type: Interaction['type'], l: Atom, p: Atom, d: number, detail?: string) => out.push({ type, ligAtom: l.name, protRes: p.res, protAtom: p.name, chain: p.chain, seq: p.seq, distance: d, detail });
  const polarNb = (i: number) => nb[i].some((j) => lig[j].el === 'N' || lig[j].el === 'O' || lig[j].el === 'S');
  // hydrogen bonds (heavy-atom geometry: D…A 2.5–3.5 Å; ligand N/O treated as potential donor and acceptor)
  for (const l of lig) { if (l.el !== 'N' && l.el !== 'O') continue; for (const p of grid.near(l, 3.5)) { if (p.el !== 'N' && p.el !== 'O') continue; const d = dist(l, p); if (d < 2.5) continue; if ((isDonor(p) && (l.el === 'O' || l.el === 'N')) || (isAcceptor(p) && (l.el === 'N' || l.el === 'O'))) { if (!(isDonor(p) || isAcceptor(p))) continue; add('hydrogen bond', l, p, d, d <= 3.2 ? 'strong' : 'weak'); } } }
  // hydrophobic: ligand carbons not bonded to polar atoms, protein hydrophobic carbons within 4.0 Å
  lig.forEach((l, i) => { if (l.el !== 'C' || polarNb(i)) return; for (const p of grid.near(l, 4.0)) { if (p.el !== 'C') continue; if ((HYDROPHOBIC_ATOMS[p.res] ?? []).includes(p.name)) add('hydrophobic', l, p, dist(l, p)); } });
  // salt bridges: ligand carboxylate / basic-amine groups vs protein charged groups, centre-to-centre ≤ 5.0 Å
  const ligRings = findRings(lig, nb), inRing = (i: number) => ligRings.some((r) => r.includes(i)), ligCharged: { c: { x: number; y: number; z: number }; sign: 1 | -1; atom: Atom }[] = [];
  const carbonyl = (c: number) => nb[c].some((o) => lig[o].el === 'O' && dist(lig[c], lig[o]) < 1.3 && nb[o].length === 1);
  lig.forEach((a, i) => {
    if (a.el === 'C') { const os = nb[i].filter((j) => lig[j].el === 'O' && nb[j].length === 1), cs = nb[i].filter((j) => lig[j].el === 'C'); if (os.length === 2 && cs.length === 1 && nb[i].length === 3) ligCharged.push({ c: centroid(os.map((j) => lig[j])), sign: -1, atom: a }); }
    if (a.el === 'N' && !inRing(i) && nb[i].length >= 1 && nb[i].length <= 3 && nb[i].every((j) => lig[j].el === 'C') && !nb[i].some((j) => carbonyl(j) || inRing(j))) ligCharged.push({ c: a, sign: 1, atom: a });
    if (a.el === 'C' && !inRing(i) && nb[i].length === 3 && nb[i].filter((j) => lig[j].el === 'N').length === 3) ligCharged.push({ c: a, sign: 1, atom: a }); // guanidinium
  });
  const protCharged: { c: { x: number; y: number; z: number }; sign: 1 | -1; res: Atom }[] = [];
  for (const r of res.filter((x) => isProteinRes(x.res))) { const g = (n: string) => r.atoms.find((a) => a.name === n); if (r.res === 'ASP' && g('OD1') && g('OD2')) protCharged.push({ c: centroid([g('OD1')!, g('OD2')!]), sign: -1, res: g('OD1')! }); if (r.res === 'GLU' && g('OE1') && g('OE2')) protCharged.push({ c: centroid([g('OE1')!, g('OE2')!]), sign: -1, res: g('OE1')! }); if (r.res === 'LYS' && g('NZ')) protCharged.push({ c: g('NZ')!, sign: 1, res: g('NZ')! }); if (r.res === 'ARG' && g('NH1') && g('NH2') && g('NE')) protCharged.push({ c: centroid([g('NE')!, g('NH1')!, g('NH2')!]), sign: 1, res: g('NH1')! }); }
  for (const l of ligCharged) for (const p of protCharged) if (l.sign !== p.sign) { const d = dist(l.c, p.c); if (d <= 5.0) add('salt bridge', l.atom, p.res, d, l.sign === -1 ? 'ligand carboxylate' : 'ligand amine'); }
  // π-stacking and π-cation
  const protRings: { c: { x: number; y: number; z: number }; n: { x: number; y: number; z: number }; res: Atom }[] = [];
  for (const r of res) for (const names of PROT_RINGS[r.res] ?? []) { const as = names.map((n) => r.atoms.find((a) => a.name === n)).filter((a): a is Atom => !!a); if (as.length === names.length) protRings.push({ c: centroid(as), n: ringNormal(as), res: as[0] }); }
  for (const lr of ligRings) { const as = lr.map((i) => lig[i]), c = centroid(as), n = ringNormal(as);
    for (const pr of protRings) { const d = dist(c, pr.c); if (d > 5.5) continue; let ang = angleDeg(n, pr.n); if (ang > 90) ang = 180 - ang; const off = norm(sub(pr.c, c)), lat = Math.sqrt(Math.max(0, d * d - dot(sub(pr.c, c), n) ** 2)); if (ang < 30 && lat < 2.0) add('pi-stacking', as[0], pr.res, d, `parallel, ${ang.toFixed(0)}°`); else if (ang > 60 && d < 5.5) add('pi-stacking', as[0], pr.res, d, `T-shaped, ${ang.toFixed(0)}°`); void off; }
    for (const pc of protCharged.filter((x) => x.sign === 1)) { const d = dist(c, pc.c); if (d <= 6.0 && angleDeg(n, sub(pc.c, c)) % 180 < 30 || (d <= 6.0 && 180 - (angleDeg(n, sub(pc.c, c)) % 180) < 30)) add('pi-cation', as[0], pc.res, d, 'ligand ring, protein cation'); } }
  for (const pr of protRings) for (const lc of ligCharged.filter((x) => x.sign === 1)) { const d = dist(pr.c, lc.c); if (d <= 6.0) { const a = angleDeg(pr.n, sub(lc.c, pr.c)); if (Math.min(a, 180 - a) < 30) add('pi-cation', lc.atom, pr.res, d, 'protein ring, ligand cation'); } }
  // halogen bonds: C–X···(O|N) ≤ 3.5 Å, angle C–X···A ≥ 140°
  lig.forEach((x, i) => { if (!['CL', 'BR', 'I'].includes(x.el)) return; const c = nb[i].map((j) => lig[j]).find((a) => a.el === 'C'); if (!c) return; for (const p of grid.near(x, 3.5)) if ((p.el === 'O' || p.el === 'N') && angleDeg(sub(c, x), sub(p, x)) >= 140) add('halogen bond', x, p, dist(x, p), `C–X···A ${angleDeg(sub(c, x), sub(p, x)).toFixed(0)}°`); });
  // metal coordination: metal within 2.8 Å of ligand N/O/S
  for (const m of metals) for (const l of lig) if (['N', 'O', 'S'].includes(l.el) && dist(m, l) <= 2.8) out.push({ type: 'metal coordination', ligAtom: l.name, protRes: m.res, protAtom: m.name, chain: m.chain, seq: m.seq, distance: dist(m, l), detail: 'metal ion' });
  // water bridges: ligand polar atom – water – protein polar atom, both ≤ 3.5 Å
  const wGrid = new Grid(waters, 5);
  for (const l of lig) { if (l.el !== 'N' && l.el !== 'O') continue; for (const w of wGrid.near(l, 3.5)) for (const p of grid.near(w, 3.5)) if ((p.el === 'N' || p.el === 'O') && dist(p, l) > 3.6) out.push({ type: 'water bridge', ligAtom: l.name, protRes: p.res, protAtom: p.name, chain: p.chain, seq: p.seq, distance: dist(l, w) + dist(w, p), detail: `via HOH ${w.seq}` }); }
  // de-duplicate (same type, ligand atom, residue atom)
  const seen = new Set<string>(), uniq = out.filter((x) => { const k = `${x.type}|${x.ligAtom}|${x.chain}${x.seq}${x.protAtom}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const contacts = new Map<string, number>(); for (const x of uniq) contacts.set(`${x.chain}:${x.protRes} ${x.seq}`, (contacts.get(`${x.chain}:${x.protRes} ${x.seq}`) ?? 0) + 1);
  return { interactions: uniq.sort((a, b) => a.type.localeCompare(b.type) || a.distance - b.distance), ligand: lig, contacts };
}

// ---------------- SASA ----------------
const VDW: Record<string, number> = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, F: 1.47, CL: 1.75, BR: 1.85, I: 1.98, ZN: 1.39, MG: 1.73, CA: 2.31, FE: 1.94 };
const MAX_ASA: Record<string, number> = { A: 113, R: 241, N: 158, D: 151, C: 140, Q: 189, E: 183, G: 85, H: 194, I: 182, L: 180, K: 211, M: 204, F: 218, P: 143, S: 122, T: 146, W: 259, Y: 229, V: 160 }; // Miller et al. 1987
function spherePoints(n: number) { const pts: [number, number, number][] = [], ga = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < n; i++) { const y = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - y * y), t = ga * i; pts.push([Math.cos(t) * r, y, Math.sin(t) * r]); } return pts; }
/** Shrake–Rupley accessible surface area (probe radius 1.4 Å, Fibonacci sphere points). */
export function sasa(atoms: Atom[], probe = 1.4, nPoints = 128): Float64Array {
  const pts = spherePoints(nPoints), out = new Float64Array(atoms.length), grid = new Grid(atoms, 6); const rad = (a: Atom) => (VDW[a.el] ?? 1.7) + probe;
  atoms.forEach((a, i) => { const ra = rad(a), nbrs = grid.near(a, ra + 2.2 + probe).filter((b) => b !== a && dist(a, b) < ra + rad(b)); let acc = 0; for (const [dx, dy, dz] of pts) { const p = { x: a.x + dx * ra, y: a.y + dy * ra, z: a.z + dz * ra }; let buried = false; for (const b of nbrs) if (dist(p, b) < rad(b) - 1e-9) { buried = true; break; } if (!buried) acc++; } out[i] = (4 * Math.PI * ra * ra * acc) / nPoints; });
  return out;
}
export interface ResSasa { key: string; res: string; chain: string; seq: number; sasa: number; rel: number | null }
export function residueSasa(s: Structure, includeLigands = false): { rows: ResSasa[]; total: number } {
  const sel = s.atoms.filter((a) => (includeLigands ? !WATER.has(a.res) : isProteinRes(a.res))), v = sasa(sel), per = new Map<string, number>(); sel.forEach((a, i) => { const k = `${a.chain}:${a.seq}${a.icode}:${a.res}`; per.set(k, (per.get(k) ?? 0) + v[i]); });
  const rows = residues(sel).filter((r) => isProteinRes(r.res)).map((r) => { const val = per.get(r.key) ?? 0, mx = MAX_ASA[ONE[r.res]]; return { key: r.key, res: r.res, chain: r.chain, seq: r.seq, sasa: val, rel: mx ? val / mx : null }; });
  return { rows, total: [...v].reduce((a, b) => a + b, 0) };
}

// ---------------- pockets ----------------
export interface Pocket { rank: number; points: number; volume: number; center: { x: number; y: number; z: number }; residues: { chain: string; res: string; seq: number }[]; hydrophobic: number; polar: number; score: number; maxBuriedness: number }
/** LIGSITE-style detection: grid points in solvent that are enclosed by protein along ≥ minEvents of 7 axis/diagonal directions
 *  (protein–solvent–protein events, Hendlich et al. 1997), clustered by 26-connectivity; ranked by size × buriedness. */
export function findPockets(s: Structure, opts: { spacing?: number; minEvents?: number; minVolume?: number; maxRayA?: number; maxNearest?: number } = {}): Pocket[] {
  const { spacing = 1, minEvents = 5, minVolume = 40, maxRayA = 12, maxNearest = 4.5 } = opts, prot = s.atoms.filter((a) => isProteinRes(a.res)); if (prot.length < 50) throw new Error('Too few protein atoms for pocket detection.');
  const xs = prot.map((a) => a.x), ys = prot.map((a) => a.y), zs = prot.map((a) => a.z), pad = 6, min = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.min(...zs) - pad], dims = [Math.ceil((Math.max(...xs) + pad - min[0]) / spacing) + 1, Math.ceil((Math.max(...ys) + pad - min[1]) / spacing) + 1, Math.ceil((Math.max(...zs) + pad - min[2]) / spacing) + 1];
  const N = dims[0] * dims[1] * dims[2]; if (N > 6e6) throw new Error('Structure too large for the browser pocket search (> 6 M grid points). Use a chain or domain.');
  const idx = (i: number, j: number, k: number) => (i * dims[1] + j) * dims[2] + k, occ = new Uint8Array(N), probe = 1.6;
  const g = new Grid(prot, 4);
  for (const a of prot) { const r = (VDW[a.el] ?? 1.7) + 0.0, ci = Math.round((a.x - min[0]) / spacing), cj = Math.round((a.y - min[1]) / spacing), ck = Math.round((a.z - min[2]) / spacing), n = Math.ceil(r / spacing) + 1; for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) for (let k = ck - n; k <= ck + n; k++) { if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) continue; const dx = min[0] + i * spacing - a.x, dy = min[1] + j * spacing - a.y, dz = min[2] + k * spacing - a.z; if (dx * dx + dy * dy + dz * dz < r * r) occ[idx(i, j, k)] = 1; } }
  const dirs: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1]].slice(0, 13) as [number, number, number][];
  const events = new Uint8Array(N), maxRay = Math.round(maxRayA / spacing);
  const unit = (d: [number, number, number]) => [d[0] / Math.hypot(...d), d[1] / Math.hypot(...d), d[2] / Math.hypot(...d)];
  void unit; const use = [dirs[0], dirs[1], dirs[2], dirs[9], dirs[10], dirs[11], dirs[12]];
  for (let i = 0; i < dims[0]; i++) for (let j = 0; j < dims[1]; j++) for (let k = 0; k < dims[2]; k++) {
    if (occ[idx(i, j, k)]) continue; const p = { x: min[0] + i * spacing, y: min[1] + j * spacing, z: min[2] + k * spacing }; if (g.near(p, 3.8).length === 0 && false) continue;
    let ev = 0; for (const d of use) { let hitFwd = false, hitBack = false; for (let t = 1; t <= maxRay && !hitFwd; t++) { const a = i + d[0] * t, b = j + d[1] * t, c = k + d[2] * t; if (a < 0 || b < 0 || c < 0 || a >= dims[0] || b >= dims[1] || c >= dims[2]) break; if (occ[idx(a, b, c)]) hitFwd = true; } if (!hitFwd) continue; for (let t = 1; t <= maxRay && !hitBack; t++) { const a = i - d[0] * t, b = j - d[1] * t, c = k - d[2] * t; if (a < 0 || b < 0 || c < 0 || a >= dims[0] || b >= dims[1] || c >= dims[2]) break; if (occ[idx(a, b, c)]) hitBack = true; } if (hitBack) ev++; }
    events[idx(i, j, k)] = ev;
  }
  void probe;
  const cand = new Uint8Array(N); let any = 0;
  // keep enclosed points that can host a probe and lie within a few Å of the protein surface (rejects open voids and shell-like blobs)
  for (let n = 0; n < N; n++) if (!occ[n] && events[n] >= minEvents) { const k = n % dims[2], j = Math.floor(n / dims[2]) % dims[1], i = Math.floor(n / (dims[1] * dims[2])), p = { x: min[0] + i * spacing, y: min[1] + j * spacing, z: min[2] + k * spacing }; let nearest = Infinity; for (const a of g.near(p, maxNearest)) nearest = Math.min(nearest, dist(a, p)); if (nearest >= 2.6 && nearest <= maxNearest) { cand[n] = 1; any++; } }
  if (!any) return [];
  const seen = new Uint8Array(N), pockets: { pts: number[]; ev: number }[] = [];
  for (let n = 0; n < N; n++) { if (!cand[n] || seen[n]) continue; const stack = [n], pts: number[] = []; seen[n] = 1; let evsum = 0; while (stack.length) { const c = stack.pop()!, k = c % dims[2], j = Math.floor(c / dims[2]) % dims[1], i = Math.floor(c / (dims[1] * dims[2])); pts.push(c); evsum += events[c]; for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) { if (!di && !dj && !dk) continue; const a = i + di, b = j + dj, cc = k + dk; if (a < 0 || b < 0 || cc < 0 || a >= dims[0] || b >= dims[1] || cc >= dims[2]) continue; const m = idx(a, b, cc); if (cand[m] && !seen[m]) { seen[m] = 1; stack.push(m); } } } pockets.push({ pts, ev: evsum / pts.length }); }
  const vol = (n: number) => n * spacing ** 3, out: Pocket[] = [];
  for (const pk of pockets) {
    if (vol(pk.pts.length) < minVolume) continue;
    const coords = pk.pts.map((c) => { const k = c % dims[2], j = Math.floor(c / dims[2]) % dims[1], i = Math.floor(c / (dims[1] * dims[2])); return { x: min[0] + i * spacing, y: min[1] + j * spacing, z: min[2] + k * spacing }; }), center = centroid(coords);
    const lining = new Map<string, Atom>(); for (const p of coords.filter((_, i) => i % 3 === 0)) for (const a of g.near(p, 4.5)) lining.set(`${a.chain}:${a.seq}:${a.res}`, a);
    const lr = [...lining.values()], hyd = lr.filter((a) => ['ALA', 'VAL', 'LEU', 'ILE', 'MET', 'PHE', 'TRP', 'PRO', 'TYR', 'CYS'].includes(a.res)).length, pol = lr.length - hyd, v = vol(pk.pts.length);
    out.push({ rank: 0, points: pk.pts.length, volume: v, center, residues: lr.map((a) => ({ chain: a.chain, res: a.res, seq: a.seq })).sort((a, b) => a.chain.localeCompare(b.chain) || a.seq - b.seq), hydrophobic: lr.length ? hyd / lr.length : 0, polar: lr.length ? pol / lr.length : 0, maxBuriedness: pk.ev, score: Math.log(v) * pk.ev * (0.6 + 0.8 * (lr.length ? hyd / lr.length : 0)) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 10).map((p, i) => ({ ...p, rank: i + 1 }));
}

// ---------------- superposition ----------------
type V3 = [number, number, number];
export interface Transform { R: number[][]; t: V3 }
/** Optimal rotation (Horn 1987 quaternion method): minimises RMSD of moving → fixed. Returns transform applying to the moving coordinates. */
export function kabsch(fixed: V3[], moving: V3[]): { transform: Transform; rmsd: number } {
  const n = fixed.length; if (n < 3) throw new Error('Need at least 3 paired atoms.');
  const cf = [0, 1, 2].map((k) => fixed.reduce((s, p) => s + p[k], 0) / n), cm = [0, 1, 2].map((k) => moving.reduce((s, p) => s + p[k], 0) / n);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a][b] += (moving[i][a] - cm[a]) * (fixed[i][b] - cf[b]);
  const [Sxx, Sxy, Sxz] = S[0], [Syx, Syy, Syz] = S[1], [Szx, Szy, Szz] = S[2];
  const N4 = [[Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx], [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz], [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy], [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]];
  const { vals, vecs } = jacobi4(N4); let best = 0; for (let i = 1; i < 4; i++) if (vals[i] > vals[best]) best = i; const [q0, q1, q2, q3] = [vecs[0][best], vecs[1][best], vecs[2][best], vecs[3][best]];
  const R = [[q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3, 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2)], [2 * (q1 * q2 + q0 * q3), q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3, 2 * (q2 * q3 - q0 * q1)], [2 * (q1 * q3 - q0 * q2), 2 * (q2 * q3 + q0 * q1), q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3]];
  const t: V3 = [cf[0] - (R[0][0] * cm[0] + R[0][1] * cm[1] + R[0][2] * cm[2]), cf[1] - (R[1][0] * cm[0] + R[1][1] * cm[1] + R[1][2] * cm[2]), cf[2] - (R[2][0] * cm[0] + R[2][1] * cm[1] + R[2][2] * cm[2])];
  const tr = { R, t }, apply = moving.map((p) => applyT(tr, p)); let ss = 0; for (let i = 0; i < n; i++) ss += (apply[i][0] - fixed[i][0]) ** 2 + (apply[i][1] - fixed[i][1]) ** 2 + (apply[i][2] - fixed[i][2]) ** 2;
  return { transform: tr, rmsd: Math.sqrt(ss / n) };
}
export const applyT = (tr: Transform, p: V3): V3 => [tr.R[0][0] * p[0] + tr.R[0][1] * p[1] + tr.R[0][2] * p[2] + tr.t[0], tr.R[1][0] * p[0] + tr.R[1][1] * p[1] + tr.R[1][2] * p[2] + tr.t[1], tr.R[2][0] * p[0] + tr.R[2][1] * p[1] + tr.R[2][2] * p[2] + tr.t[2]];
function jacobi4(A0: number[][]): { vals: number[]; vecs: number[][] } {
  const n = 4, a = A0.map((r) => [...r]), v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) { let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2; if (off < 1e-24) break; for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) { if (Math.abs(a[p][q]) < 1e-300) continue; const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c; for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; } for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; } for (let k = 0; k < n; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; } } }
  return { vals: a.map((r, i) => r[i]), vecs: v };
}
export interface Chain { id: string; seq: string; ca: { atom: Atom; aa: string }[] }
export function chains(s: Structure): Chain[] { const m = new Map<string, Chain>(); for (const r of residues(s.atoms.filter((a) => isProteinRes(a.res)))) { const ca = r.atoms.find((a) => a.name === 'CA'); if (!ca) continue; const c = m.get(r.chain) ?? m.set(r.chain, { id: r.chain, seq: '', ca: [] }).get(r.chain)!; c.seq += ONE[r.res] ?? 'X'; c.ca.push({ atom: ca, aa: ONE[r.res] ?? 'X' }); } return [...m.values()]; }
export interface Superposition { rmsd: number; nPaired: number; identity: number; tmScore: number; perResidue: { seq: number; aa: string; d: number }[]; transform: Transform; rmsdAll: number }
/** Superpose chain B onto chain A using a sequence alignment to pair Cα atoms, with iterative 3σ outlier rejection (Kabsch core). */
export function superpose(a: Chain, b: Chain, pairs: [number, number][]): Superposition {
  if (pairs.length < 5) throw new Error('Fewer than 5 aligned residues: the chains are too different to superpose by sequence.');
  const P = (c: Chain, i: number): V3 => [c.ca[i].atom.x, c.ca[i].atom.y, c.ca[i].atom.z]; let use = pairs.slice(), result = kabsch(use.map(([i]) => P(a, i)), use.map(([, j]) => P(b, j)));
  const all = (tr: Transform) => pairs.map(([i, j]) => { const q = applyT(tr, P(b, j)), p = P(a, i); return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); });
  for (let it = 0; it < 4; it++) { const d = all(result.transform), keep = pairs.filter((_, k) => d[k] <= Math.max(2.0, result.rmsd * 3)); if (keep.length === use.length || keep.length < 5) break; use = keep; result = kabsch(use.map(([i]) => P(a, i)), use.map(([, j]) => P(b, j))); }
  const d = all(result.transform), L = a.ca.length, d0 = Math.max(0.5, L > 21 ? 1.24 * Math.cbrt(L - 15) - 1.8 : 0.5), tm = d.reduce((s, x) => s + 1 / (1 + (x / d0) ** 2), 0) / L;
  const id = pairs.filter(([i, j]) => a.ca[i].aa === b.ca[j].aa).length / pairs.length;
  return { rmsd: result.rmsd, nPaired: use.length, identity: id, tmScore: tm, perResidue: pairs.map(([i], k) => ({ seq: a.ca[i].atom.seq, aa: a.ca[i].aa, d: d[k] })), transform: result.transform, rmsdAll: Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length) };
}
export function toPdb(atoms: Atom[], tr?: Transform): string { return atoms.map((a, i) => { const p = tr ? applyT(tr, [a.x, a.y, a.z]) : ([a.x, a.y, a.z] as V3); return `${a.het ? 'HETATM' : 'ATOM  '}${String(i + 1).padStart(5)} ${a.name.length < 4 ? ' ' + a.name.padEnd(3) : a.name}${a.alt || ' '}${a.res.padStart(3)} ${a.chain}${String(a.seq).padStart(4)}${a.icode || ' '}   ${p[0].toFixed(3).padStart(8)}${p[1].toFixed(3).padStart(8)}${p[2].toFixed(3).padStart(8)}${a.occ.toFixed(2).padStart(6)}${a.b.toFixed(2).padStart(6)}          ${a.el.padStart(2)}`; }).join('\n') + '\nEND\n'; }
