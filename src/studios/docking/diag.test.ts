import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRdkitNode } from './rdkitNode';
import { ligandFromSmiles } from './rdkitBridge';
import { ligandToPdbqt, automorphisms, type V3 } from './pdbqt';
import { crystalLigand, mapCrystalToMol } from './crystal';
import { parseStructure, kabsch } from '../structure/geometry';
it('diag', async () => {
  const RD = await loadRdkitNode();
  const rows = readFileSync('benchmarks/docking/complexes.tsv', 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
  for (const [id, comp, smi] of rows) {
    const s = parseStructure(readFileSync(`benchmarks/.cache/docking/pdb/${id}.pdb`, 'utf8'));
    const xl = crystalLigand(s, comp); const L = ligandFromSmiles(RD, smi, { name: comp });
    const map = mapCrystalToMol(xl, L.mol); if (!map) { process.stderr.write(`${id} nomatch\n`); continue; }
    const p = ligandToPdbqt(L.mol);
    const heavy = p.atomMap.filter((a) => L.mol.atoms[a].el !== 'H'), hi = new Map(heavy.map((a, k) => [a, k]));
    const ref: V3[] = new Array(heavy.length); for (const m of map) ref[hi.get(m.molAtom)!] = m.pos;
    const mine: V3[] = heavy.map((a) => [L.mol.atoms[a].x, L.mol.atoms[a].y, L.mol.atoms[a].z]);
    const el = heavy.map((a) => L.mol.atoms[a].el); const bonds: [number, number, number][] = L.mol.bonds.filter((b) => hi.has(b.a) && hi.has(b.b)).map((b) => [hi.get(b.a)!, hi.get(b.b)!, 1]);
    const autos = automorphisms(el, bonds, 300); let best = Infinity;
    for (const a of autos) best = Math.min(best, kabsch(ref, a.map((j) => mine[j])).rmsd);
    process.stderr.write(`${id} ${comp} rot=${p.rotatable} kabsch-rmsd(embedded vs crystal)=${best.toFixed(2)} charge=${L.mol.atoms.reduce((t, a) => t + a.fc, 0)} ${L.protonation.join(',')}\n`);
  }
}, 600000);
