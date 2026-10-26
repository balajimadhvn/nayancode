/** Read the first protein chain's C-alpha trace from a PDB file and find native contacts. */
import { chains, parsePdb } from '@/studios/structure/geometry';

export interface CaResidue { seq: number; res: string }
export interface CaTrace {
  x: Float64Array; y: Float64Array; z: Float64Array;
  n: number; chain: string; residues: CaResidue[];
}

/**
 * C-alpha coordinates in Angstrom of the first model of a PDB. Altlocs other
 * than blank/A are ignored (the shared parser already deduplicates them).
 */
export function caTrace(pdbText: string, chain?: string): CaTrace {
  const s = parsePdb(pdbText);
  const all = chains(s);
  if (!all.length) throw new Error('No protein C-alpha atoms found in this PDB file.');
  const c = chain ? all.find((x) => x.id === chain) : all[0];
  if (!c) throw new Error(`Chain ${chain} has no protein C-alpha atoms.`);
  const n = c.ca.length;
  if (n < 5) throw new Error('Need at least five C-alpha atoms to build a Go model.');
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const residues: CaResidue[] = [];
  c.ca.forEach((a, i) => { x[i] = a.atom.x; y[i] = a.atom.y; z[i] = a.atom.z; residues.push({ seq: a.atom.seq, res: a.atom.res }); });
  return { x, y, z, n, chain: c.id, residues };
}

export interface Contact { i: number; j: number; r0: number }

/** Native contacts: sequence separation >= minSeparation and C-alpha distance <= cutoff. */
export function nativeContacts(ca: CaTrace, opts: { cutoff?: number; minSeparation?: number } = {}): Contact[] {
  const cutoff = opts.cutoff ?? 8.0;
  const minSep = opts.minSeparation ?? 4;
  const out: Contact[] = [];
  for (let i = 0; i < ca.n; i++) {
    for (let j = i + minSep; j < ca.n; j++) {
      const dx = ca.x[i] - ca.x[j], dy = ca.y[i] - ca.y[j], dz = ca.z[i] - ca.z[j];
      const r = Math.hypot(dx, dy, dz);
      if (r <= cutoff) out.push({ i, j, r0: r });
    }
  }
  return out;
}

export function caToPdb(ca: CaTrace, coords?: { x: Float64Array; y: Float64Array; z: Float64Array }, model?: number): string {
  const x = coords?.x ?? ca.x, y = coords?.y ?? ca.y, z = coords?.z ?? ca.z;
  const lines: string[] = [];
  if (model !== undefined) lines.push(`MODEL     ${String(model).padStart(4)}`);
  for (let i = 0; i < ca.n; i++) {
    const res = (ca.residues[i]?.res ?? 'GLY').padStart(3);
    lines.push(`ATOM  ${String(i + 1).padStart(5)}  CA  ${res} ${ca.chain}${String(ca.residues[i]?.seq ?? i + 1).padStart(4)}    ${x[i].toFixed(3).padStart(8)}${y[i].toFixed(3).padStart(8)}${z[i].toFixed(3).padStart(8)}  1.00  0.00           C`);
  }
  if (model !== undefined) lines.push('ENDMDL');
  return lines.join('\n') + '\n';
}
