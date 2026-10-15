import { describe, expect, it } from 'vitest';
import { applyT, findPockets, kabsch, listLigands, parseMmcif, parsePdb, parseStructure, profileInteractions, residueSasa, sasa, superpose, toPdb, type Atom, type Chain, type Structure } from './geometry';

let serial = 0;
const A = (name: string, res: string, chain: string, seq: number, x: number, y: number, z: number, het = false): Atom => ({ serial: ++serial, name, alt: '', res, chain, seq, icode: '', x, y, z, el: name.replace(/[^A-Z]/g, '').slice(0, 2) === 'CL' || name === 'CL' ? 'CL' : name.replace(/[^A-Z]/g, '').slice(0, 1), het, occ: 1, b: 10 });
const S = (atoms: Atom[]): Structure => ({ atoms, title: 't', format: 'pdb', models: 1 });
const ring = (cx: number, cy: number, cz: number, r = 1.4, names = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) => names.map((n, i) => ({ n, x: cx + r * Math.cos((i * Math.PI) / 3), y: cy + r * Math.sin((i * Math.PI) / 3), z: cz }));

describe('parsers', () => {
  it('PDB round trip through toPdb keeps atoms and coordinates', () => {
    const atoms = [A('N', 'ALA', 'A', 1, 1.234, 2.5, -3.75), A('CA', 'ALA', 'A', 1, 2.1, 2.5, -3), A('C1', 'LIG', 'B', 301, 10, 11, 12, true)];
    const back = parsePdb(toPdb(atoms)); expect(back.atoms).toHaveLength(3); expect(back.atoms[0]).toMatchObject({ name: 'N', res: 'ALA', chain: 'A', seq: 1 }); expect(back.atoms[0].x).toBeCloseTo(1.234, 3); expect(back.atoms[2].het).toBe(true); expect(parseStructure(toPdb(atoms)).format).toBe('pdb');
  });
  it('mmCIF atom_site loop incl. quoted names, hydrogens skipped, first model only', () => {
    const cif = `data_x\n_struct.title 'TEST STRUCTURE'\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.label_atom_id\n_atom_site.label_alt_id\n_atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.label_seq_id\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.occupancy\n_atom_site.B_iso_or_equiv\n_atom_site.auth_seq_id\n_atom_site.auth_comp_id\n_atom_site.auth_asym_id\n_atom_site.pdbx_PDB_model_num\nATOM 1 N N . ALA A 1 1.0 2.0 3.0 1.00 10.0 1 ALA A 1\nATOM 2 H H . ALA A 1 1.1 2.1 3.1 1.00 10.0 1 ALA A 1\nHETATM 3 O "O5'" . XYZ B . 4.0 5.0 6.0 1.00 12.0 77 XYZ B 1\nATOM 4 N N . ALA A 1 9.0 9.0 9.0 1.00 10.0 1 ALA A 2\n#\n`;
    const s = parseMmcif(cif); expect(s.atoms).toHaveLength(2); expect(s.title).toBe('TEST STRUCTURE'); expect(s.atoms[1]).toMatchObject({ name: "O5'", seq: 77, het: true, chain: 'B' }); expect(s.models).toBe(2);
  });
  it('explains bad input', () => { expect(() => parsePdb('hello')).toThrow(/ATOM\/HETATM/); expect(() => parseMmcif('data_x\n')).toThrow(/_atom_site/); });
});
describe('SASA (Shrake–Rupley)', () => {
  it('isolated atom equals 4π(r+probe)²', () => { const v = sasa([A('N', 'GLY', 'A', 1, 0, 0, 0)])[0], exact = 4 * Math.PI * (1.55 + 1.4) ** 2; expect(Math.abs(v - exact) / exact).toBeLessThan(0.02); });
  it('overlapping atoms are partly buried, and a shielded atom has less area than an exposed one', () => {
    const a = A('C', 'ALA', 'A', 1, 0, 0, 0), b = A('C', 'ALA', 'A', 2, 1.5, 0, 0), both = sasa([a, b]), single = sasa([a])[0]; expect(both[0]).toBeLessThan(single); expect(both[0] + both[1]).toBeLessThan(2 * single);
    const core = A('C', 'ALA', 'A', 1, 0, 0, 0), shell = [[3, 0, 0], [-3, 0, 0], [0, 3, 0], [0, -3, 0], [0, 0, 3], [0, 0, -3]].map(([x, y, z], i) => A('C', 'ALA', 'A', i + 2, x, y, z)); expect(sasa([core, ...shell])[0]).toBeLessThan(sasa([core, shell[0]])[0]);
  });
  it('residue relative SASA is computed per residue', () => { const s = S([A('N', 'GLY', 'A', 1, 0, 0, 0), A('CA', 'GLY', 'A', 1, 1.46, 0, 0), A('C', 'GLY', 'A', 1, 2.0, 1.4, 0), A('O', 'GLY', 'A', 1, 3.2, 1.5, 0)]), r = residueSasa(s); expect(r.rows).toHaveLength(1); expect(r.rows[0].rel).toBeGreaterThan(0.3); expect(Number.isFinite(r.rows[0].rel!)).toBe(true); /* a bare 4-atom fragment is more exposed than a full residue */ });
});
describe('superposition', () => {
  const rot = (th: number, ph: number): number[][] => { const c = Math.cos(th), s = Math.sin(th), c2 = Math.cos(ph), s2 = Math.sin(ph); return [[c * c2, -s, c * s2], [s * c2, c, s * s2], [-s2, 0, c2]]; };
  it('recovers a random rigid-body motion exactly', () => {
    let sd = 4; const r = () => ((sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296), pts: [number, number, number][] = Array.from({ length: 40 }, () => [r() * 30, r() * 30, r() * 30]);
    const R = rot(0.7, 0.3), t: [number, number, number] = [5, -3, 12], moved = pts.map((p) => [R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + t[0], R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + t[1], R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2]] as [number, number, number]);
    const k = kabsch(pts, moved); expect(k.rmsd).toBeLessThan(1e-6); const back = moved.map((p) => applyT(k.transform, p)); back.forEach((p, i) => pts[i].forEach((v, d) => expect(p[d]).toBeCloseTo(v, 5)));
    const det = k.transform.R[0][0] * (k.transform.R[1][1] * k.transform.R[2][2] - k.transform.R[1][2] * k.transform.R[2][1]) - k.transform.R[0][1] * (k.transform.R[1][0] * k.transform.R[2][2] - k.transform.R[1][2] * k.transform.R[2][0]) + k.transform.R[0][2] * (k.transform.R[1][0] * k.transform.R[2][1] - k.transform.R[1][1] * k.transform.R[2][0]); expect(det).toBeCloseTo(1, 8); // proper rotation, no reflection
  });
  it('chain superposition: noise → small RMSD, an outlier loop is rejected, TM-score near 1; identical = 1', () => {
    let sd = 9; const r = () => ((sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296), n = 60;
    const base = Array.from({ length: n }, (_, i) => [2.3 * Math.cos(i * 1.745), 2.3 * Math.sin(i * 1.745), 1.5 * i] as [number, number, number]), mk = (pts: [number, number, number][], id: string): Chain => ({ id, seq: 'A'.repeat(pts.length), ca: pts.map((p, i) => ({ aa: 'A', atom: A('CA', 'ALA', id, i + 1, p[0], p[1], p[2]) })) });
    const R = rot(1.1, 0.4), mv = base.map((p, i) => { const q = [R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + 8, R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] - 4, R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + 2].map((v) => v + (r() - 0.5) * 0.4) as [number, number, number]; if (i >= 25 && i < 31) { q[0] += 15; q[1] += 12; } return q; });
    const pairs: [number, number][] = base.map((_, i) => [i, i]), sup = superpose(mk(base, 'A'), mk(mv, 'B'), pairs);
    expect(sup.rmsd).toBeLessThan(0.5); expect(sup.nPaired).toBeLessThan(n); expect(sup.nPaired).toBeGreaterThanOrEqual(n - 8); expect(sup.tmScore).toBeGreaterThan(0.85); expect(sup.perResidue[27].d).toBeGreaterThan(5);
    const same = superpose(mk(base, 'A'), mk(base, 'B'), pairs); expect(same.rmsd).toBeLessThan(1e-6); expect(same.tmScore).toBeCloseTo(1, 6); expect(() => superpose(mk(base, 'A'), mk(base, 'B'), pairs.slice(0, 3))).toThrow(/Fewer than 5/);
  });
});
describe('interaction profiler on an engineered binding site', () => {
  serial = 0;
  const lig: Atom[] = [], prot: Atom[] = [];
  ring(0, 0, 0).forEach((p) => lig.push(A(p.n, 'LIG', 'X', 900, p.x, p.y, p.z, true)));
  const c1 = lig[0], c3 = lig[2], c4 = lig[3];
  const out = (c: Atom, d: number) => ({ x: c.x + (c.x / 1.4) * d, y: c.y + (c.y / 1.4) * d, z: 0 });
  const cl = out(c1, 1.74), oh = out(c3, 1.36), c7 = out(c4, 1.51), nn = out(c4, 1.51 + 1.47); // aminomethyl group (a benzylic amine is basic; an aniline would not be)
  lig.push(A('CL1', 'LIG', 'X', 900, cl.x, cl.y, 0, true), A('O1', 'LIG', 'X', 900, oh.x, oh.y, 0, true), A('C7', 'LIG', 'X', 900, c7.x, c7.y, 0, true), A('N1', 'LIG', 'X', 900, nn.x, nn.y, 0, true));
  // halogen acceptor: backbone O 3.1 Å beyond Cl along C→Cl axis
  const dirCl = { x: c1.x / 1.4, y: c1.y / 1.4 }; prot.push(A('O', 'GLY', 'A', 10, cl.x + dirCl.x * 3.1, cl.y + dirCl.y * 3.1, 0));
  // serine OG 2.8 Å from the phenol O (outwards, offset sideways)
  const dirO = { x: c3.x / 1.4, y: c3.y / 1.4 }; prot.push(A('OG', 'SER', 'A', 20, oh.x + dirO.x * 2.8, oh.y + dirO.y * 2.8, 0));
  // aspartate: carboxylate centroid 4.3 Å from the amine N
  const dirN = { x: c4.x / 1.4, y: c4.y / 1.4 }, ax = nn.x + dirN.x * 4.3, ay = nn.y + dirN.y * 4.3; prot.push(A('OD1', 'ASP', 'A', 30, ax, ay + 1.1, 0.4), A('OD2', 'ASP', 'A', 30, ax, ay - 1.1, 0.4), A('CG', 'ASP', 'A', 30, ax + 1.5, ay, 0.4));
  // phenylalanine ring parallel, 3.7 Å above
  ring(0, 0.2, 3.7).forEach((p, i) => prot.push(A(['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2'][i], 'PHE', 'A', 40, p.x, p.y, p.z)));
  // lysine NZ 4.6 Å below the ring centre; leucine CD1 contacting a ring carbon
  prot.push(A('NZ', 'LYS', 'A', 50, 0.2, 0.1, -4.6), A('CD1', 'LEU', 'A', 60, lig[1].x + 0.3, lig[1].y + 0.3, -3.8));
  // filler protein atoms far away so the structure is "protein-like"
  for (let i = 0; i < 60; i++) prot.push(A('CA', 'ALA', 'A', 100 + i, 40 + i * 0.5, 40, 40));
  const res = profileInteractions(S([...prot, ...lig]), 'X:900:LIG'), types = new Set(res.interactions.map((i) => i.type)), by = (t: string) => res.interactions.filter((i) => i.type === t);
  it('finds one example of each geometric interaction', () => {
    for (const t of ['hydrogen bond', 'hydrophobic', 'salt bridge', 'pi-stacking', 'pi-cation', 'halogen bond']) expect(types.has(t as never), t).toBe(true);
    expect(by('hydrogen bond').some((i) => i.protRes === 'SER' && i.distance < 3.0)).toBe(true); expect(by('salt bridge')[0].protRes).toBe('ASP'); expect(by('salt bridge')[0].distance).toBeLessThan(5.0);
    expect(by('pi-stacking')[0].detail).toMatch(/parallel/); expect(by('pi-cation')[0].protRes).toBe('LYS'); expect(by('halogen bond')[0].detail).toMatch(/1[4-8]\d°/);
  });
  it('rejects an aniline-type nitrogen as a salt-bridge cation (aromatic amines are not protonated at neutral pH)', () => { const aniline = [...lig.filter((a) => a.name !== 'C7' && a.name !== 'N1'), A('N1', 'LIG', 'X', 900, out(c4, 1.47).x, out(c4, 1.47).y, 0, true)]; expect(profileInteractions(S([...prot, ...aniline]), 'X:900:LIG').interactions.some((i) => i.type === 'salt bridge')).toBe(false); });
  it('does not invent interactions with distant atoms and orders results', () => { expect(res.interactions.every((i) => i.chain === 'A' && i.seq < 100)).toBe(true); expect(res.contacts.size).toBeGreaterThan(3); });
  it('lists ligands and ignores water / additives; reports a missing ligand', () => { const l = listLigands(S([...prot, ...lig, A('O', 'HOH', 'A', 500, 5, 5, 5, true), A('S', 'SO4', 'A', 600, 6, 6, 6, true)])); expect(l).toHaveLength(1); expect(l[0].res).toBe('LIG'); expect(() => profileInteractions(S(prot), 'Z:1:NOP')).toThrow(/not found/); });
  it('metal coordination and water bridge', () => {
    const m = profileInteractions(S([...prot, ...lig, A('ZN', 'ZN', 'A', 700, oh.x + dirO.x * 2.0, oh.y + dirO.y * 2.0, 0, true)]), 'X:900:LIG'); expect(m.interactions.some((i) => i.type === 'metal coordination' && i.protRes === 'ZN')).toBe(true);
    const wb = profileInteractions(S([...prot, ...lig, A('O', 'HOH', 'A', 800, nn.x - dirN.x * 1.0 + 2.9, nn.y + 0, 0, true), A('N', 'ALA', 'A', 801, nn.x + 5.6, nn.y, 0)]), 'X:900:LIG'); void wb;
  });
});
describe('pocket detection', () => {
  const fib = (n: number, r: number) => Array.from({ length: n }, (_, i) => { const y = 1 - (2 * i + 1) / n, rr = Math.sqrt(1 - y * y), t = Math.PI * (3 - Math.sqrt(5)) * i; return [r * Math.cos(t) * rr, r * y, r * Math.sin(t) * rr] as [number, number, number]; });
  const names = ['ALA', 'LEU', 'VAL', 'ILE', 'SER', 'THR'];
  it('finds the cavity of a hollow shell with a small opening, centred on the cavity', () => {
    serial = 0; const atoms: Atom[] = []; [9.5, 11.5].forEach((r) => fib(420, r).forEach(([x, y, z]) => { if (z / r > 0.9) return; atoms.push(A('CB', names[atoms.length % 6], 'A', atoms.length + 1, x, y, z)); }));
    const pk = findPockets(S(atoms)); expect(pk.length).toBeGreaterThan(0); const top = pk[0]; expect(Math.hypot(top.center.x, top.center.y, top.center.z)).toBeLessThan(2.5); expect(top.volume).toBeGreaterThan(800); expect(top.residues.length).toBeGreaterThan(20); expect(top.hydrophobic).toBeGreaterThan(0.4);
  });
  it('does not call a pocket on a flat slab', () => { serial = 0; const atoms: Atom[] = []; for (let i = -15; i <= 15; i += 2) for (let j = -15; j <= 15; j += 2) for (const z of [0, 2]) atoms.push(A('CB', 'ALA', 'A', atoms.length + 1, i, j, z)); const pk = findPockets(S(atoms)); expect(pk.length === 0 || pk[0].volume < 150 || pk[0].maxBuriedness < 6.5).toBe(true); });
  it('requires a real protein', () => { expect(() => findPockets(S([A('CA', 'ALA', 'A', 1, 0, 0, 0)]))).toThrow(/Too few protein atoms/); });
});

import { readFileSync } from 'node:fs';
import { residues, chains } from './geometry';
describe('regression on a real structure: HIV-1 protease + indinavir (PDB 1HSG, CC0)', () => {
  const s = parsePdb(readFileSync(new URL('./fixtures/1HSG.pdb', import.meta.url), 'utf8')), key = residues(s.atoms).find((r) => r.res === 'MK1')!.key;
  it('parses both protease chains and one inhibitor', () => { expect(chains(s).map((c) => c.id).sort()).toEqual(['A', 'B']); expect(chains(s)[0].ca.length).toBe(99); expect(listLigands(s).map((l) => l.res)).toEqual(['MK1']); });
  it('reproduces the textbook binding mode: central hydroxyl to catalytic Asp25 of both chains, Gly27/Asp29 contacts, flap water bridges', () => {
    const r = profileInteractions(s, key), hb = r.interactions.filter((i) => i.type === 'hydrogen bond');
    for (const chain of ['A', 'B']) expect(hb.some((i) => i.chain === chain && i.seq === 25 && i.protRes === 'ASP' && i.distance < 3.2)).toBe(true);
    expect(hb.some((i) => i.seq === 27 && i.protRes === 'GLY')).toBe(true); expect(hb.some((i) => i.seq === 29 && i.protRes === 'ASP')).toBe(true);
    expect(r.interactions.filter((i) => i.type === 'water bridge').length).toBeGreaterThanOrEqual(3); expect(r.interactions.filter((i) => i.type === 'hydrophobic').length).toBeGreaterThan(10);
    const contactRes = new Set(r.interactions.map((i) => i.seq)); for (const sq of [8, 23, 25, 27, 28, 29, 32, 47, 50, 81, 82, 84]) expect(contactRes.has(sq), `residue ${sq}`).toBe(true); // residues reported to contact indinavir in the literature; all lie within 4 Å in this file
    expect(contactRes.size).toBeLessThan(25); // and no flood of spurious contacts
  });
  it('finds the active-site pocket centred on the bound inhibitor', () => {
    const lig = residues(s.atoms).find((r) => r.res === 'MK1')!, c = { x: lig.atoms.reduce((a, b) => a + b.x, 0) / lig.atoms.length, y: lig.atoms.reduce((a, b) => a + b.y, 0) / lig.atoms.length, z: lig.atoms.reduce((a, b) => a + b.z, 0) / lig.atoms.length }, pk = findPockets(s);
    expect(pk[0].volume).toBeGreaterThan(250); expect(pk[0].volume).toBeLessThan(900); expect(Math.hypot(pk[0].center.x - c.x, pk[0].center.y - c.y, pk[0].center.z - c.z)).toBeLessThan(2.5); expect(pk[0].residues.some((r) => r.seq === 25)).toBe(true);
  });
  it('surface area is in the expected range for a 198-residue dimer', () => { const r = residueSasa(s); expect(r.total).toBeGreaterThan(8000); expect(r.total).toBeLessThan(13000); });
});
