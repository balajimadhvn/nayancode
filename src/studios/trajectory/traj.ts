/** Multi-model PDB trajectory parsing and analyses.
 *  Reuses the Kabsch superposition from the structure studio (structure/geometry.ts).
 */

import { applyT, kabsch } from '@/studios/structure/geometry';

export interface TrajAtom {
  name: string;
  res: string;
  chain: string;
  seq: number;
  x: number;
  y: number;
  z: number;
  el: string;
}

export type Frame = TrajAtom[];
export type Selection = 'ca' | 'backbone' | 'heavy' | 'all' | ((atom: TrajAtom) => boolean);

const parseAtomLine = (line: string): TrajAtom => {
  const name = line.slice(12, 16).trim();
  const res = line.slice(17, 20).trim();
  const chain = line.slice(21, 22).trim() || 'A';
  const seq = Number.parseInt(line.slice(22, 26), 10);
  const x = Number(line.slice(30, 38));
  const y = Number(line.slice(38, 46));
  const z = Number(line.slice(46, 54));
  const el = line.slice(76, 78).trim() || name.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase();
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`Cannot read coordinates from PDB line: ${line.slice(0, 30)}…`);
  return { name, res, chain, seq: Number.isFinite(seq) ? seq : 0, x, y, z, el };
};

/** Parse MODEL … ENDMDL blocks; a file without MODEL records is one frame. */
export function parsePdbTrajectory(text: string): Frame[] {
  const frames: Frame[] = [];
  let cur: Frame | null = null;
  let sawModel = false;

  const flush = () => {
    if (cur && cur.length) frames.push(cur);
    cur = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim().length === 0) continue;
    if (raw.startsWith('MODEL')) {
      flush();
      sawModel = true;
      cur = [];
      continue;
    }
    if (raw.startsWith('ENDMDL')) { flush(); continue; }
    if (raw.startsWith('ATOM') || raw.startsWith('HETATM')) {
      if (!sawModel && !cur) cur = [];
      if (cur) cur.push(parseAtomLine(raw));
    }
  }
  flush();

  if (!sawModel) {
    // a plain single-model file: all atoms collected in one frame
    return frames.length ? [frames.flat()] : [];
  }
  if (!frames.length) return [];

  const n0 = frames[0].length;
  for (let k = 1; k < frames.length; k++) {
    if (frames[k].length !== n0) throw new Error(`frame ${k + 1} has a different atom count (${frames[k].length} vs ${n0})`);
  }
  return frames;
}

const isSelected = (sel: Selection) => typeof sel === 'function'
  ? sel
  : sel === 'all' ? () => true
    : sel === 'ca' ? (a: TrajAtom) => a.name === 'CA'
      : sel === 'backbone' ? (a: TrajAtom) => ['N', 'CA', 'C', 'O'].includes(a.name)
        : (a: TrajAtom) => a.el !== 'H' && a.el !== 'D';

export function selectIndices(frame: Frame, sel: Selection = 'ca'): number[] {
  const test = isSelected(sel);
  const out: number[] = [];
  for (let i = 0; i < frame.length; i++) if (test(frame[i])) out.push(i);
  return out;
}

type V3 = [number, number, number];
const xyz = (a: TrajAtom): V3 => [a.x, a.y, a.z];

/** Superpose every frame onto frame `refFrame` using the selected atoms; all atoms receive the same transform. */
export function superposeToReference(frames: Frame[], sel: Selection = 'ca', refFrame = 0): Frame[] {
  if (!frames.length) throw new Error('No frames to superpose.');
  const ref = frames[refFrame];
  if (!ref) throw new Error(`Reference frame ${refFrame + 1} does not exist.`);
  const idx = selectIndices(ref, sel);
  if (idx.length < 3) throw new Error(`Superposition needs at least 3 selected atoms (found ${idx.length}); choose another selection.`);
  const fixed = idx.map((i) => xyz(ref[i]));
  return frames.map((frame) => {
    if (frame.length !== ref.length) throw new Error('Frames have different atom counts.');
    const moving = idx.map((i) => xyz(frame[i]));
    const { transform } = kabsch(fixed, moving);
    return frame.map((a) => {
      const p = applyT(transform, xyz(a));
      return { ...a, x: p[0], y: p[1], z: p[2] };
    });
  });
}

/** Per-frame RMSD of the selected atoms after superposition to frame 0. */
export function rmsd(frames: Frame[], sel: Selection = 'ca'): number[] {
  if (!frames.length) return [];
  const idx = selectIndices(frames[0], sel);
  const fitted = superposeToReference(frames, sel, 0);
  const ref = fitted[0];
  return fitted.map((frame) => {
    let ss = 0;
    for (const i of idx) ss += (frame[i].x - ref[i].x) ** 2 + (frame[i].y - ref[i].y) ** 2 + (frame[i].z - ref[i].z) ** 2;
    return Math.sqrt(ss / idx.length);
  });
}

export interface MeanStructure { frame: Frame; frames: Frame[] }

/** Mean coordinates of the superposed frames (used by RMSF and by RMSD to the mean). */
export function meanStructure(frames: Frame[], sel: Selection = 'ca'): MeanStructure {
  const fitted = superposeToReference(frames, sel, 0);
  const n = fitted[0].length;
  const mean: Frame = fitted[0].map((a) => ({ ...a }));
  for (const frame of fitted) for (let i = 0; i < n; i++) { mean[i].x += frame[i].x; mean[i].y += frame[i].y; mean[i].z += frame[i].z; }
  for (const a of mean) { a.x /= fitted.length; a.y /= fitted.length; a.z /= fitted.length; }
  return { frame: mean, frames: fitted };
}

/** Per-atom RMSF around the mean structure, after superposition on `sel`.
 *  Variances are corrected for the six global degrees of freedom removed by the fit. */
export function rmsf(frames: Frame[], sel: Selection = 'ca'): number[] {
  if (frames.length < 2) return [];
  const { frame: mean, frames: fitted } = meanStructure(frames, sel);
  const n = mean.length;
  const out = new Array<number>(n).fill(0);
  for (const frame of fitted) for (let i = 0; i < n; i++) {
    out[i] += (frame[i].x - mean[i].x) ** 2 + (frame[i].y - mean[i].y) ** 2 + (frame[i].z - mean[i].z) ** 2;
  }
  const fitDim = 3 * selectIndices(frames[0], sel).length;
  const dofFix = fitDim > 6 ? fitDim / (fitDim - 6) : 1;
  return out.map((v) => Math.sqrt((v / fitted.length) * dofFix));
}

/** Per-frame RMSD to the mean structure, after superposition on `sel` (same DoF correction as RMSF). */
export function rmsdToMean(frames: Frame[], sel: Selection = 'ca'): number[] {
  if (!frames.length) return [];
  const { frame: mean, frames: fitted } = meanStructure(frames, sel);
  const idx = selectIndices(mean, sel);
  const dofFix = idx.length * 3 > 6 ? (idx.length * 3) / (idx.length * 3 - 6) : 1;
  return fitted.map((frame) => {
    let ss = 0;
    for (const i of idx) ss += (frame[i].x - mean[i].x) ** 2 + (frame[i].y - mean[i].y) ** 2 + (frame[i].z - mean[i].z) ** 2;
    return Math.sqrt((ss / idx.length) * dofFix);
  });
}

export interface ResidueRmsf { key: string; label: string; res: string; chain: string; seq: number; rmsf: number; n: number }

/** Residue-averaged RMSF (all atoms of a residue share the same value unless weights are supplied). */
export function rmsfByResidue(frames: Frame[], sel: Selection = 'ca'): ResidueRmsf[] {
  const perAtom = rmsf(frames, sel);
  const map = new Map<string, ResidueRmsf>();
  frames[0]?.forEach((a, i) => {
    const key = `${a.chain}:${a.seq}:${a.res}`;
    const e = map.get(key);
    if (e) { e.rmsf += perAtom[i]; e.n++; } else map.set(key, { key, label: `${a.res}${a.seq}${a.chain}`, res: a.res, chain: a.chain, seq: a.seq, rmsf: perAtom[i], n: 1 });
  });
  return [...map.values()].map((e) => ({ ...e, rmsf: e.rmsf / e.n }));
}

/** Mass-unweighted radius of gyration. */
export function radiusOfGyration(frame: Frame, sel: Selection = 'all'): number {
  const atoms = selectIndices(frame, sel).map((i) => frame[i]);
  if (!atoms.length) return 0;
  const cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
  const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
  const cz = atoms.reduce((s, a) => s + a.z, 0) / atoms.length;
  let ss = 0;
  for (const a of atoms) ss += (a.x - cx) ** 2 + (a.y - cy) ** 2 + (a.z - cz) ** 2;
  return Math.sqrt(ss / atoms.length);
}

/** Distance between atom `atomI` of frame `i` and atom `atomJ` of frame `j` (Å). */
export function pairDistance(frames: Frame[], i: number, j: number, atomI = 0, atomJ = 0): number {
  const a = frames[i]?.[atomI], b = frames[j]?.[atomJ];
  if (!a || !b) return NaN;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Time series of the distance between two atoms over all frames (Å). */
export function pairDistanceSeries(frames: Frame[], atomI: number, atomJ: number): number[] {
  return frames.map((frame) => {
    const a = frame[atomI], b = frame[atomJ];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : NaN;
  });
}

/** Simple donor/acceptor hydrogen-bond count: N/O pairs within 3.5 Å, different residues, no hydrogens. */
export function hbondCount(frame: Frame, cutoff = 3.5): number {
  const polar = frame.map((a, i) => ({ a, i })).filter(({ a }) => (a.el === 'N' || a.el === 'O') && a.name !== 'OXT');
  let count = 0;
  for (let p = 0; p < polar.length; p++) {
    for (let q = p + 1; q < polar.length; q++) {
      const A = polar[p].a, B = polar[q].a;
      if (A.res === B.res && A.chain === B.chain && A.seq === B.seq) continue;
      if (Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z) <= cutoff) count++;
    }
  }
  return count;
}

export interface PcaResult {
  /** eigenvalues (Å²), largest first */
  eigenvalues: number[];
  /** top nPc eigenvectors, each of length 3N */
  eigenvectors: number[][];
  /** projection of each frame on each of the top nPc components */
  projections: number[][];
  /** fraction of total variance explained by each returned component */
  explained: number[];
}

/** Essential dynamics: PCA on superposed coordinates, top components by power iteration with deflation. */
export function pca(frames: Frame[], sel: Selection = 'ca', nPc = 3): PcaResult {
  if (frames.length < 2) throw new Error('PCA needs at least two frames.');
  const idx = selectIndices(frames[0], sel);
  if (idx.length < 3) throw new Error(`PCA needs at least 3 selected atoms (found ${idx.length}).`);
  if (idx.length > 300) throw new Error(`PCA is limited to 300 selected atoms (${idx.length} selected).`);
  const fitted = superposeToReference(frames, sel, 0);
  const n = fitted.length, N = idx.length, dim = 3 * N;

  const X = new Float64Array(n * dim);
  for (let f = 0; f < n; f++) for (let a = 0; a < N; a++) {
    const atom = fitted[f][idx[a]];
    X[f * dim + a * 3] = atom.x;
    X[f * dim + a * 3 + 1] = atom.y;
    X[f * dim + a * 3 + 2] = atom.z;
  }
  const mean = new Float64Array(dim);
  for (let f = 0; f < n; f++) for (let d = 0; d < dim; d++) mean[d] += X[f * dim + d];
  for (let d = 0; d < dim; d++) mean[d] /= n;

  const C = new Float64Array(dim * dim);
  const centred = new Float64Array(dim);
  for (let f = 0; f < n; f++) {
    for (let d = 0; d < dim; d++) centred[d] = X[f * dim + d] - mean[d];
    for (let a = 0; a < dim; a++) {
      const va = centred[a];
      if (va === 0) continue;
      for (let b = a; b < dim; b++) C[a * dim + b] += va * centred[b];
    }
  }
  for (let a = 0; a < dim; a++) for (let b = a; b < dim; b++) { const v = C[a * dim + b] / (n - 1); C[a * dim + b] = v; if (b !== a) C[b * dim + a] = v; }

  let trace = 0;
  for (let d = 0; d < dim; d++) trace += C[d * dim + d];

  const A = Float64Array.from(C);
  const eigenvalues: number[] = [];
  const eigenvectors: number[][] = [];
  const count = Math.min(nPc, dim);

  for (let comp = 0; comp < count; comp++) {
    // start from the row with the largest remaining diagonal
    let start = 0, best = -Infinity;
    for (let d = 0; d < dim; d++) { const v = A[d * dim + d]; if (v > best) { best = v; start = d; } }
    if (!(best > 0)) { eigenvalues.push(0); eigenvectors.push(new Array(dim).fill(0)); continue; }
    let v = new Float64Array(dim);
    for (let d = 0; d < dim; d++) v[d] = A[start * dim + d];
    let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (!(norm > 0)) { eigenvalues.push(0); eigenvectors.push(new Array(dim).fill(0)); continue; }
    for (let d = 0; d < dim; d++) v[d] /= norm;

    let prev = 0, lambda = 0;
    for (let it = 0; it < 400; it++) {
      const w = new Float64Array(dim);
      for (let a = 0; a < dim; a++) {
        let s = 0;
        const row = a * dim;
        for (let b = 0; b < dim; b++) s += A[row + b] * v[b];
        w[a] = s;
      }
      for (const prevVec of eigenvectors) {
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += w[d] * prevVec[d];
        for (let d = 0; d < dim; d++) w[d] -= dot * prevVec[d];
      }
      norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
      if (!(norm > 1e-14)) break;
      v = new Float64Array(dim);
      for (let d = 0; d < dim; d++) v[d] = w[d] / norm;
      if (Math.abs(norm - prev) <= 1e-10 * Math.max(1, norm)) { lambda = norm; break; }
      prev = norm;
      lambda = norm;
    }
    // Rayleigh quotient on the (deflated) matrix
    let rq = 0;
    for (let a = 0; a < dim; a++) { let s = 0; const row = a * dim; for (let b = 0; b < dim; b++) s += A[row + b] * v[b]; rq += v[a] * s; }
    lambda = Math.max(0, rq);
    eigenvalues.push(lambda);
    eigenvectors.push(Array.from(v));
    for (let a = 0; a < dim; a++) { if (v[a] === 0) continue; for (let b = 0; b < dim; b++) A[a * dim + b] -= lambda * v[a] * v[b]; }
  }

  // deterministic sign: largest absolute component positive
  for (const ev of eigenvectors) {
    let k = 0;
    for (let d = 1; d < ev.length; d++) if (Math.abs(ev[d]) > Math.abs(ev[k])) k = d;
    if (ev[k] < 0) for (let d = 0; d < ev.length; d++) ev[d] = -ev[d];
  }

  const projections: number[][] = [];
  for (let f = 0; f < n; f++) {
    const row: number[] = [];
    for (const ev of eigenvectors) {
      let s = 0;
      for (let d = 0; d < dim; d++) s += (X[f * dim + d] - mean[d]) * ev[d];
      row.push(s);
    }
    projections.push(row);
  }

  return { eigenvalues, eigenvectors, projections, explained: eigenvalues.map((e) => (trace > 0 ? e / trace : 0)) };
}

/** Two-dimensional free-energy surface, F = −kT ln(P/Pmax), kJ/mol. Empty bins are NaN. */
export function freeEnergy2D(x: number[], y: number[], bins = 40, T = 300): number[][] {
  const kT = 0.0083144626 * T;
  const n = Math.min(x.length, y.length);
  const out: number[][] = Array.from({ length: bins }, () => new Array<number>(bins).fill(NaN));
  if (!n) return out;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < xMin) xMin = x[i]; if (x[i] > xMax) xMax = x[i];
    if (y[i] < yMin) yMin = y[i]; if (y[i] > yMax) yMax = y[i];
  }
  const sx = xMax > xMin ? (bins - 1e-12) / (xMax - xMin) : 0;
  const sy = yMax > yMin ? (bins - 1e-12) / (yMax - yMin) : 0;
  const counts = Array.from({ length: bins }, () => new Array<number>(bins).fill(0));
  for (let i = 0; i < n; i++) {
    const bx = Math.min(bins - 1, Math.max(0, Math.floor((x[i] - xMin) * sx)));
    const by = Math.min(bins - 1, Math.max(0, Math.floor((y[i] - yMin) * sy)));
    counts[bx][by]++;
  }
  let maxCount = 0;
  for (const row of counts) for (const c of row) if (c > maxCount) maxCount = c;
  if (!maxCount) return out;
  for (let i = 0; i < bins; i++) for (let j = 0; j < bins; j++) {
    if (counts[i][j] > 0) out[i][j] = -kT * Math.log(counts[i][j] / maxCount);
  }
  return out;
}

export const RMSF_NOTE = 'RMSF is computed around the mean structure after superposition; the radius of gyration is mass-unweighted.';
