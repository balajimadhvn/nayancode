/**
 * Structure utilities: Cα extraction, contact maps, pairwise RMSD matrices and elastic-network normal modes.
 *
 * The Anisotropic Network Model (Atilgan et al. 2001) represents a protein as Cα atoms joined by harmonic springs of
 * stiffness γ for every pair closer than `cutoff`. The 3N×3N Hessian H has the 3×3 super-element −γ (d dᵀ)/|d|²
 * off-diagonal and its negative sum on the diagonal. Its six lowest eigenvalues are the rigid-body modes (translation
 * and rotation); the non-zero eigenpairs give the slow collective motions and, through Σ_k (1/λ_k)|v_k,i|², the
 * per-residue mean-square fluctuation that predicts relative B-factors. Elastic-network models are not dynamics.
 *
 * Small systems (≤ 100 residues) are diagonalised with the cyclic Jacobi algorithm, which is accurate to machine
 * precision. Larger systems use inverse subspace iteration on the Cholesky factor of H plus the rank-six rigid-body
 * projector (which keeps the factorization positive definite); the mean-square fluctuations then come from the
 * diagonal of that inverse. The browser limit is 400 Cα atoms.
 */
import { kabsch, type Atom } from './geometry';
type V3 = [number, number, number];

export interface CA { chain: string; seq: number; icode: string; res: string; x: number; y: number; z: number; b: number; aa: string }
const ONE: Record<string, string> = { ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', MSE: 'M' };

/** Cα atoms of the first model and the first alternate location, in file order. */
export function caCoordinates(atoms: Atom[]): CA[] {
  const seen = new Set<string>(), out: CA[] = [];
  for (const a of atoms) {
    if (a.name !== 'CA' || a.het) continue;
    const key = `${a.chain}:${a.seq}${a.icode}`;
    if (seen.has(key)) continue;
    if (a.alt && a.alt !== 'A' && a.alt !== '1') continue;
    seen.add(key);
    out.push({ chain: a.chain, seq: a.seq, icode: a.icode, res: a.res, x: a.x, y: a.y, z: a.z, b: a.b, aa: ONE[a.res] ?? 'X' });
  }
  return out;
}

/** N×N contact map (1 = Cα–Cα closer than `cutoff`), skipping pairs closer than `minSep` in sequence. */
export function contactMap(ca: CA[], cutoff = 8, minSep = 1): Uint8Array {
  const n = ca.length, m = new Uint8Array(n * n), c2 = cutoff * cutoff;
  for (let i = 0; i < n; i++) for (let j = i + minSep; j < n; j++) {
    const dx = ca[i].x - ca[j].x, dy = ca[i].y - ca[j].y, dz = ca[i].z - ca[j].z;
    if (dx * dx + dy * dy + dz * dz < c2) m[i * n + j] = m[j * n + i] = 1;
  }
  return m;
}

const key = (c: CA) => `${c.chain}:${c.seq}${c.icode}`;

/** Symmetric matrix of RMSD after optimal superposition on residues shared by each pair (matched by chain and number). */
export function rmsdMatrix(structures: CA[][]): number[][] {
  const n = structures.length, out = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const b = new Map(structures[j].map((c) => [key(c), c])), fixed: V3[] = [], moving: V3[] = [];
    for (const a of structures[i]) { const m = b.get(key(a)); if (m) { fixed.push([a.x, a.y, a.z]); moving.push([m.x, m.y, m.z]); } }
    if (fixed.length < 10) throw new Error(`Structures ${i + 1} and ${j + 1} share only ${fixed.length} residues; at least 10 are needed for a superposition.`);
    out[i][j] = out[j][i] = kabsch(fixed, moving).rmsd;
  }
  return out;
}

/** Pearson correlation between predicted fluctuations and experimental B-factors. */
export function bfactorCorrelation(predicted: number[], experimental: number[]): number {
  const n = Math.min(predicted.length, experimental.length);
  if (n < 3) return NaN;
  const mp = predicted.slice(0, n).reduce((a, b) => a + b, 0) / n, me = experimental.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sp = 0, se = 0, spe = 0;
  for (let i = 0; i < n; i++) { const p = predicted[i] - mp, e = experimental[i] - me; sp += p * p; se += e * e; spe += p * e; }
  return sp > 0 && se > 0 ? spe / Math.sqrt(sp * se) : NaN;
}

export interface Mode { lambda: number; frequency: number; vector: Float64Array }
export interface AnmResult { n: number; modes: Mode[]; msf: number[]; eigenvaluesAll?: number[]; method: 'jacobi' | 'subspace'; cutoff: number }

/** ANM Hessian (3N×3N, row-major) for Cα coordinates. */
export function anmHessian(ca: CA[], cutoff = 15, gamma = 1): Float64Array {
  const n = ca.length, m = 3 * n, H = new Float64Array(m * m);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = ca[j].x - ca[i].x, dy = ca[j].y - ca[i].y, dz = ca[j].z - ca[i].z;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 >= cutoff * cutoff || r2 === 0) continue;
    const d = [dx, dy, dz], blk = new Float64Array(9);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) blk[a * 3 + b] = (-gamma * d[a] * d[b]) / r2;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      H[(3 * i + a) * m + (3 * j + b)] = blk[a * 3 + b];
      H[(3 * j + a) * m + (3 * i + b)] = blk[a * 3 + b];
      H[(3 * i + a) * m + (3 * i + b)] -= blk[a * 3 + b];
      H[(3 * j + a) * m + (3 * j + b)] -= blk[a * 3 + b];
    }
  }
  return H;
}

/** Cyclic Jacobi eigendecomposition of a symmetric matrix (values ascending, vectors as columns of the returned matrix). */
function jacobi(A: Float64Array, n: number, maxSweeps = 60): { values: Float64Array; vectors: Float64Array } {
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p * n + q];
      if (Math.abs(apq) < 1e-15) continue;
      off += apq * apq;
      const app = A[p * n + p], aqq = A[q * n + q];
      const theta = (aqq - app) / (2 * apq), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = A[k * n + p], akq = A[k * n + q];
        A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = A[p * n + k], aqk = A[q * n + k];
        A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k * n + p], vkq = V[k * n + q];
        V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq;
      }
    }
    if (off < 1e-22) break;
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = A[i * n + i];
  return { values, vectors: V };
}

/** Lower-triangular Cholesky factor of a symmetric positive-definite matrix (row-major, n×n). */
function cholesky(A: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let sum = A[i * n + j];
    for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
    if (i === j) { if (!(sum > 0)) throw new Error('The ANM Hessian is not positive definite; check the coordinates.'); L[i * n + j] = Math.sqrt(sum); }
    else L[i * n + j] = sum / L[j * n + j];
  }
  return L;
}

/** Solve L Lᵀ x = b for one right-hand side. */
function cholSolve(L: Float64Array, n: number, b: Float64Array): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}

/** Six orthonormal rigid-body modes (three translations, three rotations about the centroid). */
function rigidModes(ca: CA[]): Float64Array[] {
  const n = ca.length, m = 3 * n;
  const cx = ca.reduce((a, c) => a + c.x, 0) / n, cy = ca.reduce((a, c) => a + c.y, 0) / n, cz = ca.reduce((a, c) => a + c.z, 0) / n;
  const raw: Float64Array[] = [];
  for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const) { const v = new Float64Array(m); for (let i = 0; i < n; i++) v[3 * i + axis.indexOf(1)] = 1; raw.push(v); }
  for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const) {
    const v = new Float64Array(m), [ax, ay, az] = axis;
    for (let i = 0; i < n; i++) {
      const rx = ca[i].x - cx, ry = ca[i].y - cy, rz = ca[i].z - cz;
      v[3 * i] = ay * rz - az * ry; v[3 * i + 1] = az * rx - ax * rz; v[3 * i + 2] = ax * ry - ay * rx;
    }
    raw.push(v);
  }
  const out: Float64Array[] = [];
  for (const v of raw) {
    const w = Float64Array.from(v);
    for (const q of out) { const dot = w.reduce((a, x, i) => a + x * q[i], 0); for (let i = 0; i < m; i++) w[i] -= dot * q[i]; } // Gram–Schmidt (twice below)
    for (const q of out) { const dot = w.reduce((a, x, i) => a + x * q[i], 0); for (let i = 0; i < m; i++) w[i] -= dot * q[i]; }
    const norm = Math.sqrt(w.reduce((a, x) => a + x * x, 0));
    if (norm > 1e-9) out.push(w.map((x) => x / norm) as Float64Array);
  }
  return out;
}

const MODES = 10, SUBSPACE = 14;

/** Normal-mode analysis. Returns the ten lowest non-zero eigenpairs and the per-residue mean-square fluctuations. */
export function anm(ca: CA[], cutoff = 15, gamma = 1): AnmResult {
  const n = ca.length;
  if (n < 5) throw new Error('Normal-mode analysis needs at least 5 Cα atoms.');
  if (n > 400) throw new Error('ANM in the browser is limited to 400 residues; select a chain or domain.');
  const m = 3 * n, H = anmHessian(ca, cutoff, gamma);
  if (n <= 100) {
    const { values, vectors } = jacobi(H, m);
    const idx = [...values.keys()].sort((a, b) => values[a] - values[b]);
    const nonzero = idx.filter((i) => values[i] > 1e-6);
    const modes: Mode[] = nonzero.slice(0, MODES).map((i) => {
      const vec = new Float64Array(m);
      for (let k = 0; k < m; k++) vec[k] = vectors[k * m + i];
      return { lambda: values[i], frequency: Math.sqrt(values[i]), vector: vec };
    });
    const msf = new Array(n).fill(0);
    for (const i of nonzero) { const w = 1 / values[i]; for (let a = 0; a < n; a++) for (let c = 0; c < 3; c++) { const x = vectors[(3 * a + c) * m + i]; msf[a] += w * x * x; } }
    return { n, modes, msf, eigenvaluesAll: idx.map((i) => values[i]), method: 'jacobi', cutoff };
  }

  // Larger systems: M = H + P (P the rank-six rigid-body projector) is positive definite, so M⁻¹ has the same
  // eigenvectors as H with eigenvalues 1/λ. Inverse subspace iteration on M then finds the smallest non-zero modes.
  const rigid = rigidModes(ca);
  const M = Float64Array.from(H);
  for (const r of rigid) for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) M[i * m + j] += r[i] * r[j];
  const L = cholesky(M, m);
  const proj = (v: Float64Array) => { for (let pass = 0; pass < 2; pass++) for (const r of rigid) { const dot = v.reduce((a, x, i) => a + x * r[i], 0); for (let i = 0; i < m; i++) v[i] -= dot * r[i]; } return v; };
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5);
  let Q: Float64Array[] = Array.from({ length: SUBSPACE }, () => proj(Float64Array.from({ length: m }, rnd)));
  const orthonormalise = (cols: Float64Array[]) => {
    for (let i = 0; i < cols.length; i++) {
      for (let pass = 0; pass < 2; pass++) for (let j = 0; j < i; j++) { const d = cols[i].reduce((a, x, k) => a + x * cols[j][k], 0); for (let k = 0; k < m; k++) cols[i][k] -= d * cols[j][k]; }
      const norm = Math.sqrt(cols[i].reduce((a, x) => a + x * x, 0)) || 1;
      for (let k = 0; k < m; k++) cols[i][k] /= norm;
    }
    return cols;
  };
  Q = orthonormalise(Q);
  const ritz = () => {
    const A = new Float64Array(SUBSPACE * SUBSPACE);
    for (let i = 0; i < SUBSPACE; i++) for (let j = i; j < SUBSPACE; j++) {
      let s = 0; const qi = Q[i], qj = Q[j];
      for (let a = 0; a < m; a++) { if (!qi[a] || !qj[a]) continue; for (let b = 0; b < m; b++) s += qi[a] * H[a * m + b] * qj[b]; }
      A[i * SUBSPACE + j] = A[j * SUBSPACE + i] = s;
    }
    const { values, vectors } = jacobi(A, SUBSPACE);
    const idx = [...values.keys()].sort((a, b) => values[a] - values[b]);
    return { values: idx.map((i) => values[i]), vectors: idx.map((i) => Float64Array.from({ length: SUBSPACE }, (_, k) => vectors[k * SUBSPACE + i])) };
  };
  let prev: number[] = [], cur = ritz().values;
  for (let it = 0; it < 40; it++) {
    Q = orthonormalise(Q.map((q) => proj(cholSolve(L, m, q))));
    cur = ritz().values;
    if (prev.length && cur.every((v, i) => Math.abs(v - prev[i]) <= 1e-9 * Math.max(1, Math.abs(v)))) break;
    prev = cur;
  }
  const { values, vectors } = ritz();
  const nonzero = values.map((v, i) => ({ v, i })).filter((x) => x.v > 1e-6).slice(0, MODES);
  const modes: Mode[] = nonzero.map(({ v, i }) => {
    const vec = new Float64Array(m);
    for (let a = 0; a < m; a++) { let s = 0; for (let k = 0; k < SUBSPACE; k++) s += Q[k][a] * vectors[i][k]; vec[a] = s; }
    return { lambda: v, frequency: Math.sqrt(v), vector: vec };
  });
  // Mean-square fluctuations: diagonal of M⁻¹ = Σ_{j≥i} L⁻¹[j][i]² (the rigid modes contribute 1, not 1/0).
  const inv = new Float64Array(m * m);
  for (let col = 0; col < m; col++) { const e = new Float64Array(m); e[col] = 1; const x = cholSolve(L, m, e); for (let i = 0; i < m; i++) inv[i * m + col] = x[i]; }
  const msf = new Array(n).fill(0);
  for (let a = 0; a < n; a++) msf[a] = inv[(3 * a) * m + 3 * a] + inv[(3 * a + 1) * m + 3 * a + 1] + inv[(3 * a + 2) * m + 3 * a + 2];
  return { n, modes, msf, method: 'subspace', cutoff };
}
