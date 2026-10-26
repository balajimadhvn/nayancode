import { kabsch } from '@/studios/structure/geometry';
import { mulberry32 } from './lj';
import { forcesGo, type Coords, type EnergyParts, type GoModel } from './go';

export interface GoState {
  model: GoModel;
  c: Coords;
  vx: Float64Array; vy: Float64Array; vz: Float64Array;
  fx: Float64Array; fy: Float64Array; fz: Float64Array;
  parts: EnergyParts;
  t: number;
  rnd: () => number;
}

export interface GoObserved { Q: number; rmsd: number; rg: number; energy: number; temperature: number }

function gaussian(rnd: () => number): number {
  const u1 = Math.max(rnd(), 1e-12), u2 = rnd();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Native coordinates, velocities at temperature T with zero total momentum. */
export function initGo(m: GoModel, T: number, seed = 1): GoState {
  const c: Coords = { x: Float64Array.from(m.nativeX), y: Float64Array.from(m.nativeY), z: Float64Array.from(m.nativeZ) };
  const rnd = mulberry32(seed);
  const vx = new Float64Array(m.n), vy = new Float64Array(m.n), vz = new Float64Array(m.n);
  for (let i = 0; i < m.n; i++) { vx[i] = gaussian(rnd) * Math.sqrt(T); vy[i] = gaussian(rnd) * Math.sqrt(T); vz[i] = gaussian(rnd) * Math.sqrt(T); }
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < m.n; i++) { mx += vx[i]; my += vy[i]; mz += vz[i]; }
  for (let i = 0; i < m.n; i++) { vx[i] -= mx / m.n; vy[i] -= my / m.n; vz[i] -= mz / m.n; }
  let s2 = 0;
  for (let i = 0; i < m.n; i++) s2 += vx[i] ** 2 + vy[i] ** 2 + vz[i] ** 2;
  const scale = Math.sqrt((3 * m.n * T) / Math.max(s2, 1e-30)); // 3N dof for a whole chain
  for (let i = 0; i < m.n; i++) { vx[i] *= scale; vy[i] *= scale; vz[i] *= scale; }
  const f = forcesGo(m, c);
  return { model: m, c, vx, vy, vz, fx: f.fx, fy: f.fy, fz: f.fz, parts: f.parts, t: 0, rnd };
}

function halfKick(s: GoState, dt: number) {
  for (let i = 0; i < s.model.n; i++) { s.vx[i] += 0.5 * dt * s.fx[i]; s.vy[i] += 0.5 * dt * s.fy[i]; s.vz[i] += 0.5 * dt * s.fz[i]; }
}

function drift(s: GoState, dt: number) {
  for (let i = 0; i < s.model.n; i++) { s.c.x[i] += dt * s.vx[i]; s.c.y[i] += dt * s.vy[i]; s.c.z[i] += dt * s.vz[i]; }
}

export function temperatureGo(s: GoState): number {
  let k = 0;
  for (let i = 0; i < s.model.n; i++) k += s.vx[i] ** 2 + s.vy[i] ** 2 + s.vz[i] ** 2;
  return k / (3 * s.model.n);
}

/** One BAOAB Langevin step (Leimkuhler & Matthews 2013). */
export function stepGo(s: GoState, dt: number, opts: { T?: number; gamma?: number } = {}) {
  const T = opts.T ?? 1, gamma = opts.gamma ?? 0.05;
  halfKick(s, dt);
  drift(s, dt * 0.5);
  const c1 = Math.exp(-gamma * dt), c2 = Math.sqrt(T * (1 - c1 * c1));
  for (let i = 0; i < s.model.n; i++) {
    s.vx[i] = c1 * s.vx[i] + c2 * gaussian(s.rnd);
    s.vy[i] = c1 * s.vy[i] + c2 * gaussian(s.rnd);
    s.vz[i] = c1 * s.vz[i] + c2 * gaussian(s.rnd);
  }
  drift(s, dt * 0.5);
  const f = forcesGo(s.model, s.c);
  s.fx = f.fx; s.fy = f.fy; s.fz = f.fz; s.parts = f.parts;
  halfKick(s, dt);
  s.t += dt;
}

/** Q (native-contact fraction), C-alpha RMSD after superposition to the native, Rg, energy. */
export function observe(s: GoState): GoObserved {
  const m = s.model;
  let q = 0;
  for (const n of m.native) {
    const r = Math.hypot(s.c.x[n.i] - s.c.x[n.j], s.c.y[n.i] - s.c.y[n.j], s.c.z[n.i] - s.c.z[n.j]);
    if (r < 1.2 * n.r0) q++;
  }
  const moving: [number, number, number][] = [], fixed: [number, number, number][] = [];
  for (let i = 0; i < m.n; i++) { moving.push([s.c.x[i], s.c.y[i], s.c.z[i]]); fixed.push([m.nativeX[i], m.nativeY[i], m.nativeZ[i]]); }
  const rmsd = m.n > 3 ? kabsch(fixed, moving).rmsd : NaN;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < m.n; i++) { cx += s.c.x[i]; cy += s.c.y[i]; cz += s.c.z[i]; }
  cx /= m.n; cy /= m.n; cz /= m.n;
  let rg2 = 0;
  for (let i = 0; i < m.n; i++) rg2 += (s.c.x[i] - cx) ** 2 + (s.c.y[i] - cy) ** 2 + (s.c.z[i] - cz) ** 2;
  let kin = 0;
  for (let i = 0; i < m.n; i++) kin += 0.5 * (s.vx[i] ** 2 + s.vy[i] ** 2 + s.vz[i] ** 2);
  return { Q: q / Math.max(1, m.native.length), rmsd, rg: Math.sqrt(rg2 / m.n), energy: kin + s.parts.total, temperature: temperatureGo(s) };
}

export function runGo(s: GoState, steps: number, dt: number, opts: { T?: number; gamma?: number; onFrame?: (step: number, o: GoObserved) => void; every?: number } = {}) {
  const every = opts.every ?? 100;
  for (let i = 0; i < steps; i++) {
    stepGo(s, dt, opts);
    if (opts.onFrame && (i + 1) % every === 0) opts.onFrame(i + 1, observe(s));
  }
}
