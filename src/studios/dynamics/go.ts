/**
 * C-alpha Go model (Clementi 2000 style): bonds, angles, dihedrals from the
 * native geometry, native-contact attraction and a soft non-native repulsion.
 * Units: epsilon = 1, length Angstrom, mass 1, kB = 1.
 */
import { nativeContacts, type CaTrace, type Contact } from './goParse';

export const KR = 100, KTHETA = 20, KPHI = 1, EPS_C = 1, EPS_R = 1, SIGMA_R = 4.0, NN_CUTOFF = 12.0;
export type Term = 'bond' | 'angle' | 'dihedral' | 'native' | 'nonnative';
export const TERMS: Term[] = ['bond', 'angle', 'dihedral', 'native', 'nonnative'];

export interface GoModel {
  n: number;
  nativeX: Float64Array; nativeY: Float64Array; nativeZ: Float64Array;
  bonds: { i: number; j: number; r0: number }[];
  angles: { i: number; j: number; k: number; theta0: number }[];
  dihedrals: { i: number; j: number; k: number; l: number; phi0: number }[];
  native: Contact[];
  nonnative: { i: number; j: number }[];
}

export interface Coords { x: Float64Array; y: Float64Array; z: Float64Array }
export interface EnergyParts { bond: number; angle: number; dihedral: number; native: number; nonnative: number; total: number }

const dx = (c: Coords, i: number, j: number) => c.x[i] - c.x[j];
const dy = (c: Coords, i: number, j: number) => c.y[i] - c.y[j];
const dz = (c: Coords, i: number, j: number) => c.z[i] - c.z[j];

/** Signed torsion angle from the four Calpha positions (same definition as the energy). */
export function dihedralOf(p1: number[], p2: number[], p3: number[], p4: number[]): number {
  const b1 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
  const b2 = [p3[0] - p2[0], p3[1] - p2[1], p3[2] - p2[2]];
  const b3 = [p4[0] - p3[0], p4[1] - p3[1], p4[2] - p3[2]];
  const n1 = cross(b1, b2), n2 = cross(b2, b3);
  const bl = Math.hypot(b2[0], b2[1], b2[2]) || 1;
  const c = cross(n1, n2);
  return Math.atan2((c[0] * b2[0] + c[1] * b2[1] + c[2] * b2[2]) / bl, dot(n1, n2));
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function angleOf(c: Coords, i: number, j: number, k: number): number {
  const ux = c.x[i] - c.x[j], uy = c.y[i] - c.y[j], uz = c.z[i] - c.z[j];
  const vx = c.x[k] - c.x[j], vy = c.y[k] - c.y[j], vz = c.z[k] - c.z[j];
  const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
  const cs = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (lu * lv)));
  return Math.acos(cs);
}

export function buildGoModel(ca: CaTrace): GoModel {
  const n = ca.n;
  const c: Coords = { x: ca.x, y: ca.y, z: ca.z };
  const bonds = [], angles = [], dihedrals = [];
  for (let i = 0; i + 1 < n; i++) bonds.push({ i, j: i + 1, r0: Math.hypot(dx(c, i, i + 1), dy(c, i, i + 1), dz(c, i, i + 1)) });
  for (let j = 1; j + 1 < n; j++) angles.push({ i: j - 1, j, k: j + 1, theta0: angleOf(c, j - 1, j, j + 1) });
  for (let j = 1; j + 2 < n; j++) {
    const p = (q: number) => [c.x[q], c.y[q], c.z[q]];
    dihedrals.push({ i: j - 1, j, k: j + 1, l: j + 2, phi0: dihedralOf(p(j - 1), p(j), p(j + 1), p(j + 2)) });
  }
  const native = nativeContacts(ca);
  const isNative = new Set(native.map((q) => `${q.i}:${q.j}`));
  const nonnative: { i: number; j: number }[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 4; j < n; j++) {
    if (isNative.has(`${i}:${j}`)) continue;
    if (Math.hypot(dx(c, i, j), dy(c, i, j), dz(c, i, j)) <= NN_CUTOFF) nonnative.push({ i, j });
  }
  return { n, nativeX: Float64Array.from(ca.x), nativeY: Float64Array.from(ca.y), nativeZ: Float64Array.from(ca.z), bonds, angles, dihedrals, native, nonnative };
}

export interface ForceResult { fx: Float64Array; fy: Float64Array; fz: Float64Array; parts: EnergyParts }

/**
 * Energy and analytic forces for the selected terms. Every term's force is
 * minus the gradient of its energy (checked with finite differences in tests).
 */
export function forcesGo(m: GoModel, c: Coords, terms: Term[] = TERMS): ForceResult {
  const has = new Set(terms);
  const n = m.n;
  const fx = new Float64Array(n), fy = new Float64Array(n), fz = new Float64Array(n);
  const parts: EnergyParts = { bond: 0, angle: 0, dihedral: 0, native: 0, nonnative: 0, total: 0 };

  if (has.has('bond')) for (const b of m.bonds) {
    const qx = dx(c, b.i, b.j), qy = dy(c, b.i, b.j), qz = dz(c, b.i, b.j);
    const r = Math.hypot(qx, qy, qz) || 1e-12, dr = r - b.r0;
    parts.bond += 0.5 * KR * dr * dr;
    const s = -KR * dr / r;
    fx[b.i] += s * qx; fy[b.i] += s * qy; fz[b.i] += s * qz;
    fx[b.j] -= s * qx; fy[b.j] -= s * qy; fz[b.j] -= s * qz;
  }

  if (has.has('angle')) for (const a of m.angles) {
    const ux = c.x[a.i] - c.x[a.j], uy = c.y[a.i] - c.y[a.j], uz = c.z[a.i] - c.z[a.j];
    const vx = c.x[a.k] - c.x[a.j], vy = c.y[a.k] - c.y[a.j], vz = c.z[a.k] - c.z[a.j];
    const lu = Math.hypot(ux, uy, uz) || 1e-12, lv = Math.hypot(vx, vy, vz) || 1e-12;
    const cs = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (lu * lv)));
    const theta = Math.acos(cs), dth = theta - a.theta0;
    parts.angle += 0.5 * KTHETA * dth * dth;
    const sinT = Math.max(Math.sqrt(Math.max(1 - cs * cs, 0)), 1e-6);
    const gix = -(vx / (lu * lv) - cs * ux / (lu * lu)) / sinT;
    const giy = -(vy / (lu * lv) - cs * uy / (lu * lu)) / sinT;
    const giz = -(vz / (lu * lv) - cs * uz / (lu * lu)) / sinT;
    const gkx = -(ux / (lu * lv) - cs * vx / (lv * lv)) / sinT;
    const gky = -(uy / (lu * lv) - cs * vy / (lv * lv)) / sinT;
    const gkz = -(uz / (lu * lv) - cs * vz / (lv * lv)) / sinT;
    const s = -KTHETA * dth; // -dU/dtheta
    fx[a.i] += s * gix; fy[a.i] += s * giy; fz[a.i] += s * giz;
    fx[a.k] += s * gkx; fy[a.k] += s * gky; fz[a.k] += s * gkz;
    fx[a.j] -= s * (gix + gkx); fy[a.j] -= s * (giy + gky); fz[a.j] -= s * (giz + gkz);
  }

  if (has.has('dihedral')) for (const d of m.dihedrals) {
    const p1 = [c.x[d.i], c.y[d.i], c.z[d.i]], p2 = [c.x[d.j], c.y[d.j], c.z[d.j]];
    const p3 = [c.x[d.k], c.y[d.k], c.z[d.k]], p4 = [c.x[d.l], c.y[d.l], c.z[d.l]];
    const b1 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    const b2 = [p3[0] - p2[0], p3[1] - p2[1], p3[2] - p2[2]];
    const b3 = [p4[0] - p3[0], p4[1] - p3[1], p4[2] - p3[2]];
    const n1 = cross(b1, b2), n2 = cross(b2, b3);
    const l2 = Math.hypot(b2[0], b2[1], b2[2]) || 1e-12;
    const cn = cross(n1, n2);
    const phi = Math.atan2(dot(cn, b2) / l2, dot(n1, n2));
    const dphi = phi - d.phi0;
    parts.dihedral += KPHI * ((1 - Math.cos(dphi)) + 0.5 * (1 - Math.cos(3 * dphi)));
    const dU = KPHI * (Math.sin(dphi) + 1.5 * Math.sin(3 * dphi)); // dU/dphi
    const ln1 = dot(n1, n1) || 1e-12, ln2 = dot(n2, n2) || 1e-12;
    const g1 = n1.map((q) => -l2 / ln1 * q), g4 = n2.map((q) => l2 / ln2 * q);
    const a2 = -1 - dot(b1, b2) / (l2 * l2), b2c = dot(b3, b2) / (l2 * l2);
    const g2 = [a2 * g1[0] + b2c * g4[0], a2 * g1[1] + b2c * g4[1], a2 * g1[2] + b2c * g4[2]];
    const g3 = [-(g1[0] + g2[0] + g4[0]), -(g1[1] + g2[1] + g4[1]), -(g1[2] + g2[2] + g4[2])];
    const s = -dU;
    const add = (idx: number, g: number[]) => { fx[idx] += s * g[0]; fy[idx] += s * g[1]; fz[idx] += s * g[2]; };
    add(d.i, g1); add(d.j, g2); add(d.k, g3); add(d.l, g4);
  }

  if (has.has('native')) for (const q of m.native) {
    const qx = dx(c, q.i, q.j), qy = dy(c, q.i, q.j), qz = dz(c, q.i, q.j);
    const r = Math.max(Math.hypot(qx, qy, qz), 1e-6);
    const a = q.r0 / r, a6 = a ** 6, a10 = a6 * a ** 4, a12 = a6 * a6;
    parts.native += EPS_C * (5 * a12 - 6 * a10);
    const dUdr = (60 * EPS_C / r) * (a10 - a12);
    const s = -dUdr / r;
    fx[q.i] += s * qx; fy[q.i] += s * qy; fz[q.i] += s * qz;
    fx[q.j] -= s * qx; fy[q.j] -= s * qy; fz[q.j] -= s * qz;
  }

  if (has.has('nonnative')) for (const q of m.nonnative) {
    const qx = dx(c, q.i, q.j), qy = dy(c, q.i, q.j), qz = dz(c, q.i, q.j);
    const r = Math.max(Math.hypot(qx, qy, qz), 1e-6);
    const a = SIGMA_R / r, a6 = a ** 6;
    parts.nonnative += EPS_R * a6 * a6;
    const s = 12 * EPS_R * SIGMA_R ** 12 / r ** 14;
    fx[q.i] += s * qx; fy[q.i] += s * qy; fz[q.i] += s * qz;
    fx[q.j] -= s * qx; fy[q.j] -= s * qy; fz[q.j] -= s * qz;
  }

  parts.total = parts.bond + parts.angle + parts.dihedral + parts.native + parts.nonnative;
  return { fx, fy, fz, parts };
}
