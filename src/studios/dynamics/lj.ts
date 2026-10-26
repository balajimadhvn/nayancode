/**
 * Lennard-Jones fluid in reduced units: sigma = epsilon = mass = kB = 1.
 * Pure Float64 TypeScript; no DOM. Positions are x,y,z triplets in a cubic box.
 *
 * Potential: U(r) = 4 (r^-12 - r^-6), cut (and optionally shifted) at rc.
 * Forces use the minimum-image convention and a cell list for N > 500.
 */

export interface FccLattice { pos: Float64Array; L: number; n: number; nCells: number }

/** Deterministic RNG (same 5-line style used elsewhere in the workbench). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Perfect fcc lattice of 4 nCells^3 atoms in a cubic box of density rho. */
export function makeFcc(nCells: number, rho: number): FccLattice {
  const n = 4 * nCells ** 3;
  if (!(nCells >= 1) || !(rho > 0)) throw new Error('nCells and density must be positive');
  const L = Math.cbrt(n / rho);
  const a = L / nCells;
  const basis = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]];
  const pos = new Float64Array(3 * n);
  let k = 0;
  for (let ix = 0; ix < nCells; ix++) for (let iy = 0; iy < nCells; iy++) for (let iz = 0; iz < nCells; iz++) {
    for (const b of basis) {
      pos[k++] = (ix + b[0]) * a;
      pos[k++] = (iy + b[1]) * a;
      pos[k++] = (iz + b[2]) * a;
    }
  }
  return { pos, L, n, nCells };
}

/** Maxwell-Boltzmann velocities with zero total momentum, rescaled to exactly T. */
export function maxwell(n: number, T: number, seed: number): Float64Array {
  const rnd = mulberry32(seed);
  const v = new Float64Array(3 * n);
  for (let i = 0; i < 3 * n; i += 2) {
    const u1 = Math.max(rnd(), 1e-12), u2 = rnd();
    const r = Math.sqrt(-2 * Math.log(u1));
    v[i] = r * Math.cos(2 * Math.PI * u2) * Math.sqrt(T);
    if (i + 1 < 3 * n) v[i + 1] = r * Math.sin(2 * Math.PI * u2) * Math.sqrt(T);
  }
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += v[3 * i]; my += v[3 * i + 1]; mz += v[3 * i + 2]; }
  mx /= n; my /= n; mz /= n;
  for (let i = 0; i < n; i++) { v[3 * i] -= mx; v[3 * i + 1] -= my; v[3 * i + 2] -= mz; }
  let sum2 = 0;
  for (let i = 0; i < 3 * n; i++) sum2 += v[i] * v[i];
  const scale = Math.sqrt((3 * (n - 1) * T) / Math.max(sum2, 1e-30));
  for (let i = 0; i < 3 * n; i++) v[i] *= scale;
  return v;
}

export interface ForceResult { f: Float64Array; pe: number; virial: number }

/**
 * Forces, potential energy and virial for every atom. `shift` subtracts the
 * potential at the cutoff, so energy is continuous at rc (default true).
 * Units: energy epsilon, length sigma; virial is sum f_ij . r_ij.
 */
export function forces(pos: Float64Array, L: number, rc = 2.5, opts: { shift?: boolean; useCells?: boolean } = {}): ForceResult {
  const n = pos.length / 3;
  const shift = opts.shift !== false;
  const f = new Float64Array(3 * n);
  const rc2 = rc * rc;
  const inv6c = 1 / rc ** 6, inv12c = 1 / rc ** 12;
  const uShift = shift ? 4 * (inv12c - inv6c) : 0;
  let pe = 0, virial = 0;

  const pair = (i: number, j: number) => {
    let dx = pos[3 * i] - pos[3 * j];
    let dy = pos[3 * i + 1] - pos[3 * j + 1];
    let dz = pos[3 * i + 2] - pos[3 * j + 2];
    dx -= L * Math.round(dx / L); dy -= L * Math.round(dy / L); dz -= L * Math.round(dz / L);
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 >= rc2 || r2 === 0) return;
    const inv2 = 1 / r2, inv6 = inv2 ** 3, inv12 = inv6 * inv6;
    pe += 4 * (inv12 - inv6) - uShift;
    const s = 24 * (2 * inv12 - inv6) * inv2;
    f[3 * i] += s * dx; f[3 * i + 1] += s * dy; f[3 * i + 2] += s * dz;
    f[3 * j] -= s * dx; f[3 * j + 1] -= s * dy; f[3 * j + 2] -= s * dz;
    virial += s * r2;
  };

  // Cell list: needed for large N; only when the box spans at least 3 cells.
  const useCells = opts.useCells ?? n > 500;
  const nc = Math.floor(L / rc);
  if (useCells && nc >= 3) {
    const head = new Int32Array(nc * nc * nc).fill(-1);
    const next = new Int32Array(n);
    const cellOf = (i: number) => {
      const cx = Math.min(nc - 1, Math.floor(pos[3 * i] / L * nc));
      const cy = Math.min(nc - 1, Math.floor(pos[3 * i + 1] / L * nc));
      const cz = Math.min(nc - 1, Math.floor(pos[3 * i + 2] / L * nc));
      return cx + nc * (cy + nc * cz);
    };
    for (let i = 0; i < n; i++) { const c = cellOf(i); next[i] = head[c]; head[c] = i; }
    for (let i = 0; i < n; i++) {
      const cx = Math.min(nc - 1, Math.floor(pos[3 * i] / L * nc));
      const cy = Math.min(nc - 1, Math.floor(pos[3 * i + 1] / L * nc));
      const cz = Math.min(nc - 1, Math.floor(pos[3 * i + 2] / L * nc));
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const ax = (cx + ox + nc) % nc, ay = (cy + oy + nc) % nc, az = (cz + oz + nc) % nc;
        for (let j = head[ax + nc * (ay + nc * az)]; j >= 0; j = next[j]) if (j > i) pair(i, j);
      }
    }
    return { f, pe, virial };
  }

  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pair(i, j);
  return { f, pe, virial };
}

export interface LjState {
  n: number; L: number; rho: number; rc: number; shift: boolean;
  pos: Float64Array; vel: Float64Array; f: Float64Array;
  pe: number; virial: number;
}

export function initLj(nCells: number, rho: number, T: number, seed: number, rc = 2.5, shift = true): LjState {
  const { pos, L, n } = makeFcc(nCells, rho);
  const vel = maxwell(n, T, seed);
  const r = forces(pos, L, rc, { shift });
  return { n, L, rho, rc, shift, pos, vel, f: r.f, pe: r.pe, virial: r.virial };
}

/** Temperature from the peculiar velocities (3N-3 degrees of freedom). */
export function kineticT(s: { vel: Float64Array; n: number }): number {
  let sum = 0;
  for (let i = 0; i < 3 * s.n; i++) sum += s.vel[i] * s.vel[i];
  return sum / (3 * (s.n - 1));
}

export function totalEnergy(s: LjState): number {
  let kin = 0;
  for (let i = 0; i < 3 * s.n; i++) kin += 0.5 * s.vel[i] * s.vel[i];
  return kin + s.pe;
}

/** P = rho T + virial / (3 V). */
export function pressure(s: LjState): number { return s.rho * kineticT(s) + s.virial / (3 * s.L ** 3); }

function wrap(p: Float64Array, L: number) {
  for (let i = 0; i < p.length; i++) p[i] -= L * Math.floor(p[i] / L);
}

/** One velocity-Verlet step. The Berendsen thermostat acts after the full step. */
export function step(s: LjState, dt: number, opts: { thermostat?: 'none' | 'berendsen'; targetT?: number; tau?: number } = {}) {
  const n = s.n;
  for (let i = 0; i < 3 * n; i++) {
    s.vel[i] += 0.5 * dt * s.f[i];
    s.pos[i] += dt * s.vel[i];
  }
  wrap(s.pos, s.L);
  const r = forces(s.pos, s.L, s.rc, { shift: s.shift });
  s.f = r.f; s.pe = r.pe; s.virial = r.virial;
  for (let i = 0; i < 3 * n; i++) s.vel[i] += 0.5 * dt * s.f[i];
  if (opts.thermostat === 'berendsen') {
    const T = kineticT(s), target = opts.targetT ?? T, tau = opts.tau ?? 0.5;
    const lam = Math.sqrt(Math.max(0.01, 1 + (dt / tau) * (target / Math.max(T, 1e-9) - 1)));
    const c = Math.min(1.25, Math.max(0.8, lam));
    for (let i = 0; i < 3 * n; i++) s.vel[i] *= c;
  }
}

export function momentum(s: { vel: Float64Array; n: number }): number {
  let px = 0, py = 0, pz = 0;
  for (let i = 0; i < s.n; i++) { px += s.vel[3 * i]; py += s.vel[3 * i + 1]; pz += s.vel[3 * i + 2]; }
  return Math.hypot(px, py, pz);
}

export function runLj(s: LjState, steps: number, dt: number, opts: { thermostat?: 'none' | 'berendsen'; targetT?: number; tau?: number } = {}) {
  for (let i = 0; i < steps; i++) step(s, dt, opts);
}
