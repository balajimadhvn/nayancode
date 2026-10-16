/** Ligand preparation on top of RDKit (WebAssembly, BSD-3): SMILES / SDF / MOL2 → protonated (pH 7.4) molecule with explicit hydrogens
 *  and 3-D coordinates (our own embedder when the input is 2-D). Shared by the browser worker and the Node benchmarks. */
import { embed3d } from './embed';
import { firstSdfRecord, hasMacrocycle, mol2ToMolBlock, parseMolBlock, PROTONATION_RULES, toMolBlock, type MolG } from './molgraph';

/** The subset of the RDKit MinimalLib API used here. */
export interface RDMol { is_valid(): boolean; delete(): void; get_molblock(): string; get_smiles(): string; get_json(): string; add_hs_in_place(): boolean; remove_hs_in_place(): boolean; set_new_coords(): boolean; get_substruct_matches(q: RDMol): string; get_num_atoms(): number }
export interface RDKitModule { get_mol(s: string, d?: string): RDMol | null; get_qmol(s: string): RDMol | null; version(): string }

export interface PreparedLigand { mol: MolG; smiles: string; protonation: string[]; embedded: boolean; embed?: { violation: number; attempts: number; chiralOk: boolean; bondRms: number }; heavyAtoms: number }

function fromRd(m: RDMol, g: MolG): MolG {
  const j = JSON.parse(m.get_json()), ext = (j.molecules?.[0]?.extensions ?? []).find((e: { name: string }) => e.name === 'rdkitRepresentation') ?? {};
  g.aromaticAtom = g.atoms.map((_, i) => (ext.aromaticAtoms ?? []).includes(i));
  (ext.aromaticBonds ?? []).forEach((k: number) => { if (g.bonds[k]) { g.bonds[k].aromatic = true; g.bonds[k].order = 1.5; } });
  g.rings = ext.atomRings ?? [];
  return g;
}

/** Formal-charge changes for the dominant ionisation state at pH 7.4 (acids deprotonated, aliphatic amines and amidines protonated). */
export function protonate(RD: RDKitModule, mol: RDMol): { molblock: string; applied: string[] } {
  mol.set_new_coords();
  let g = parseMolBlock(mol.get_molblock());
  const applied: string[] = [], done = new Set<number>();
  for (const rule of PROTONATION_RULES) {
    const q = RD.get_qmol(rule.smarts); if (!q || !q.is_valid()) { q?.delete(); continue; }
    try {
      const hits: { atoms: number[] }[] = JSON.parse(mol.get_substruct_matches(q) || '[]');
      let count = 0;
      for (const h of Array.isArray(hits) ? hits : []) {
        const a = h.atoms[rule.atom];
        if (a == null || done.has(a) || g.atoms[a].fc !== 0) continue;
        // an acid and a base in one molecule: both are ionised (zwitterion), as at pH 7.4
        done.add(a); g.atoms[a].fc = rule.charge; count++;
      }
      if (count) applied.push(`${count} × ${rule.name} → ${rule.charge > 0 ? '+1' : '−1'}`);
    } finally { q.delete(); }
  }
  return { molblock: toMolBlock(g), applied };
}

export function ligandFromSmiles(RD: RDKitModule, smiles: string, opt: { protonate?: boolean; seed?: number; name?: string } = {}): PreparedLigand {
  let s = smiles.trim().split(/\s+/)[0];
  if (!s) throw new Error('Empty SMILES.');
  if (s.includes('.')) s = largestFragment(RD, s); // salts and counter-ions are dropped
  const mol = RD.get_mol(s);
  if (!mol || !mol.is_valid()) { mol?.delete(); throw new Error(`RDKit could not parse the SMILES "${s.slice(0, 60)}".`); }
  let applied: string[] = [], mb: string;
  try {
    if (opt.protonate !== false) { const r = protonate(RD, mol); mb = r.molblock; applied = r.applied; } else { mol.set_new_coords(); mb = mol.get_molblock(); }
  } finally { mol.delete(); }
  const named = mb.replace(/^[^\n]*/, opt.name ?? 'ligand');
  const m2 = RD.get_mol(named); if (!m2 || !m2.is_valid()) { m2?.delete(); throw new Error('Protonated molecule is not valid.'); }
  try {
    m2.add_hs_in_place(); m2.set_new_coords();
    const g = fromRd(m2, parseMolBlock(m2.get_molblock())); g.name = opt.name ?? 'ligand';
    return finish(RD, g, applied, opt.seed);
  } finally { m2.delete(); }
}

function largestFragment(RD: RDKitModule, smi: string): string {
  let best = smi, bn = -1;
  for (const f of smi.split('.')) { const m = RD.get_mol(f); if (!m) continue; const n = m.is_valid() ? m.get_num_atoms() : -1; m.delete(); if (n > bn) { bn = n; best = f; } }
  return best;
}

function finish(RD: RDKitModule, g: MolG, applied: string[], seed?: number): PreparedLigand {
  if (g.atoms.some((a) => ['Se', 'As', 'Hg', 'Pt', 'Au', 'Ag', 'Cu', 'Co', 'Ni', 'Fe', 'Zn', 'Mn', 'Mg', 'Ca', 'Na', 'K', 'Li', 'Al', 'Ti'].includes(a.el))) throw new Error('This ligand contains an element Vina cannot score (metals, Se, As); remove it or dock a different species.');
  let embedded = false, emb: PreparedLigand['embed'];
  if (!g.is3d) {
    // Embed, then confirm with RDKit that the 3-D structure encodes the same stereochemistry (tetrahedral centres and E/Z) as the input;
    // retry with new random seeds when it does not (bridged polycycles can invert a centre that the chirality penalty alone misses).
    const expected = canonicalSmiles(RD, toMolBlock(g)), twoD = g.atoms.map((a) => ({ x: a.x, y: a.y, z: a.z }));
    let verified = false, r = embed3d(g, { seed }), tries = 1;
    for (; tries <= 8; tries++) {
      r.coords.forEach((c, i) => { g.atoms[i].x = c[0]; g.atoms[i].y = c[1]; g.atoms[i].z = c[2]; });
      if (!expected || canonicalSmiles(RD, toMolBlock(g)) === expected) { verified = true; break; }
      twoD.forEach((c, i) => { g.atoms[i].x = c.x; g.atoms[i].y = c.y; g.atoms[i].z = c.z; });
      r = embed3d(g, { seed: (seed ?? 42) + 1000 * tries });
    }
    if (!verified) r.coords.forEach((c, i) => { g.atoms[i].x = c[0]; g.atoms[i].y = c[1]; g.atoms[i].z = c[2]; }); // keep the last 3-D attempt, flagged below
    g.is3d = true; embedded = true; emb = { violation: r.violation, attempts: r.attempts * tries, chiralOk: verified, bondRms: r.bondRms };
    if (!verified) applied = [...applied, 'warning: stereochemistry could not be reproduced in 3-D'];
  }
  if (hasMacrocycle(g)) applied = [...applied, 'warning: macrocycle: Vina keeps ring conformations rigid, so only one ring conformation is docked'];
  const smiles = canonicalSmiles(RD, toMolBlock(g));
  return { mol: g, smiles, protonation: applied, embedded, embed: emb, heavyAtoms: g.atoms.filter((a) => a.el !== 'H').length };
}

/** SDF (first record) or MOL2 file with 3-D coordinates (kept as given; hydrogens are added if the file has none). */
export function ligandFromFile(RD: RDKitModule, text: string, kind: 'sdf' | 'mol2', opt: { protonate?: boolean; seed?: number; name?: string } = {}): PreparedLigand {
  const mb = kind === 'mol2' ? mol2ToMolBlock(text) : firstSdfRecord(text);
  const g0 = parseMolBlock(mb);
  const hasH = g0.atoms.some((a) => a.el === 'H');
  const m = RD.get_mol(mb); if (!m || !m.is_valid()) { m?.delete(); throw new Error('RDKit could not read the molecule in this file.'); }
  let g: MolG;
  try {
    if (!hasH) m.add_hs_in_place();
    if (!g0.is3d) m.set_new_coords();
    g = fromRd(m, parseMolBlock(m.get_molblock()));
  } finally { m.delete(); }
  g.name = opt.name ?? (g0.name || 'ligand');
  if (!g0.is3d) { return finish(RD, g, [], opt.seed); }
  return finish(RD, g, [], opt.seed);
}

/** Canonical isomeric SMILES (hydrogens removed) of a molfile or SMILES; stereo of 3-D molfiles is perceived from the coordinates. */
export function canonicalSmiles(RD: RDKitModule, input: string): string {
  const m = RD.get_mol(input); if (!m || !m.is_valid()) { m?.delete(); return ''; }
  try { m.remove_hs_in_place(); return m.get_smiles(); } finally { m.delete(); }
}
/** Round-trip check: does the 3-D structure still encode the same isomeric SMILES as the input? */
export const sameStereo = (RD: RDKitModule, g: MolG, smilesA: string) => canonicalSmiles(RD, smilesA) === canonicalSmiles(RD, toMolBlock(g));
