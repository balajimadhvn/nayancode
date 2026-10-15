import { exposeKernels, type Kernel } from '@/compute/rpc';
import { align } from '../sequence/kernels';
import * as g from './geometry';

const ligands: Kernel<{ text: string }, { ligands: g.LigandInfo[]; atoms: number; chains: { id: string; length: number }[]; title: string; format: string }> = (a) => { const s = g.parseStructure(a.text); return { ligands: g.listLigands(s), atoms: s.atoms.length, chains: g.chains(s).map((c) => ({ id: c.id, length: c.ca.length })), title: s.title, format: s.format }; };
const interactions: Kernel<{ text: string; ligandKey: string }, { interactions: g.Interaction[]; contacts: [string, number][]; ligandAtoms: number; centroid: [number, number, number] }> = (a) => {
  const s = g.parseStructure(a.text), r = g.profileInteractions(s, a.ligandKey), n = r.ligand.length;
  return { interactions: r.interactions, contacts: [...r.contacts.entries()], ligandAtoms: n, centroid: [r.ligand.reduce((x, y) => x + y.x, 0) / n, r.ligand.reduce((x, y) => x + y.y, 0) / n, r.ligand.reduce((x, y) => x + y.z, 0) / n] };
};
const pockets: Kernel<{ text: string; ligandKey?: string }, { pockets: g.Pocket[]; ligandCentroid: [number, number, number] | null; ligandName: string | null }> = (a, ctx) => {
  ctx.progress(0.1, 'Parsing'); const s = g.parseStructure(a.text); ctx.progress(0.2, 'Scanning grid for buried cavities'); const p = g.findPockets(s);
  let c: [number, number, number] | null = null, nm: string | null = null; if (a.ligandKey) { const r = g.residues(s.atoms).find((x) => x.key === a.ligandKey); if (r) { c = [r.atoms.reduce((x, y) => x + y.x, 0) / r.atoms.length, r.atoms.reduce((x, y) => x + y.y, 0) / r.atoms.length, r.atoms.reduce((x, y) => x + y.z, 0) / r.atoms.length]; nm = r.res; } }
  return { pockets: p, ligandCentroid: c, ligandName: nm };
};
const solvent: Kernel<{ text: string }, { rows: g.ResSasa[]; total: number }> = (a) => g.residueSasa(g.parseStructure(a.text));
const compare: Kernel<{ textA: string; chainA: string; textB: string; chainB: string }, { sup: Omit<g.Superposition, 'transform'>; nA: number; nB: number; transformedPdb: string; pairsN: number }> = (a) => {
  const A = g.parseStructure(a.textA), B = g.parseStructure(a.textB), ca = g.chains(A).find((c) => c.id === a.chainA), cb = g.chains(B).find((c) => c.id === a.chainB);
  if (!ca || !cb) throw new Error('Chain not found (needs protein Cα atoms).');
  const al = align(ca.seq, cb.seq, { mode: 'local', kind: 'protein' }), pairs: [number, number][] = []; let i = al.aStart - 1, j = al.bStart - 1;
  for (let k = 0; k < al.a.length; k++) { const x = al.a[k], y = al.b[k]; if (x !== '-' && y !== '-') pairs.push([i, j]); if (x !== '-') i++; if (y !== '-') j++; }
  const sup = g.superpose(ca, cb, pairs); const moved = B.atoms.map((x) => ({ ...x, chain: 'Y' }));
  const { transform, ...rest } = sup; return { sup: rest, nA: ca.ca.length, nB: cb.ca.length, transformedPdb: g.toPdb(moved, transform), pairsN: pairs.length };
};
export type StructureKernels = { ligands: typeof ligands; interactions: typeof interactions; pockets: typeof pockets; solvent: typeof solvent; compare: typeof compare };
exposeKernels({ ligands, interactions, pockets, solvent, compare } as Record<string, Kernel>);
