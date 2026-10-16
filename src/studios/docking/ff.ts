/** A small valence force field used to refine distance-geometry conformers: harmonic bonds and angles, cosine torsions
 *  (staggered sp3–sp3, planar sp2 and fixed cis/trans double bonds and amides), chirality and planarity volumes, and soft
 *  non-bonded repulsion. Parameters are generic (UFF-like magnitudes), written from textbook forms; it ranks conformers, it is
 *  not a substitute for MMFF or UFF. Analytic gradients; tested against finite differences. */

export interface FFBond { a: number; b: number; r0: number }
export interface FFAngle { a: number; b: number; c: number; t0: number; k: number }
export interface FFTorsion { a: number; b: number; c: number; d: number; k: number; n: number; delta: number }
export interface FFChiral { c: number; a: number; b: number; d: number; sign: number }
export interface FFTerms { bonds: FFBond[]; angles: FFAngle[]; torsions: FFTorsion[]; chiral: FFChiral[]; planar: [number, number, number, number][]; repel: [number, number, number][] }

type X = Float64Array;
const KB = 600, KA = 100, KR = 40;

export function ffEnergy(x: X, T: FFTerms, g: X | null): number {
  let e = 0; if (g) g.fill(0);
  for (const { a, b, r0 } of T.bonds) {
    const dx = x[3 * a] - x[3 * b], dy = x[3 * a + 1] - x[3 * b + 1], dz = x[3 * a + 2] - x[3 * b + 2], r = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-12, d = r - r0;
    e += 0.5 * KB * d * d;
    if (g) { const f = (KB * d) / r; g[3 * a] += f * dx; g[3 * a + 1] += f * dy; g[3 * a + 2] += f * dz; g[3 * b] -= f * dx; g[3 * b + 1] -= f * dy; g[3 * b + 2] -= f * dz; }
  }
  for (const { a, b, c, t0, k } of T.angles) {
    const ux = x[3 * a] - x[3 * b], uy = x[3 * a + 1] - x[3 * b + 1], uz = x[3 * a + 2] - x[3 * b + 2], vx = x[3 * c] - x[3 * b], vy = x[3 * c + 1] - x[3 * b + 1], vz = x[3 * c + 2] - x[3 * b + 2];
    const lu = Math.sqrt(ux * ux + uy * uy + uz * uz) + 1e-12, lv = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-12;
    const cs = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (lu * lv))), th = Math.acos(cs), d = th - t0;
    e += 0.5 * (k || KA) * d * d;
    if (g) {
      const sn = Math.max(0.05, Math.sqrt(1 - cs * cs)), f = ((k || KA) * d) / -sn; // dE/dcos
      const dca = [(vx / lv - (cs * ux) / lu) / lu, (vy / lv - (cs * uy) / lu) / lu, (vz / lv - (cs * uz) / lu) / lu], dcc = [(ux / lu - (cs * vx) / lv) / lv, (uy / lu - (cs * vy) / lv) / lv, (uz / lu - (cs * vz) / lv) / lv];
      for (let t = 0; t < 3; t++) { g[3 * a + t] += f * dca[t]; g[3 * c + t] += f * dcc[t]; g[3 * b + t] -= f * (dca[t] + dcc[t]); }
    }
  }
  for (const { a, b, c, d, k, n, delta } of T.torsions) {
    const b1x = x[3 * b] - x[3 * a], b1y = x[3 * b + 1] - x[3 * a + 1], b1z = x[3 * b + 2] - x[3 * a + 2];
    const b2x = x[3 * c] - x[3 * b], b2y = x[3 * c + 1] - x[3 * b + 1], b2z = x[3 * c + 2] - x[3 * b + 2];
    const b3x = x[3 * d] - x[3 * c], b3y = x[3 * d + 1] - x[3 * c + 1], b3z = x[3 * d + 2] - x[3 * c + 2];
    const mx = b1y * b2z - b1z * b2y, my = b1z * b2x - b1x * b2z, mz = b1x * b2y - b1y * b2x; // m = b1 × b2
    const nx = b2y * b3z - b2z * b3y, ny = b2z * b3x - b2x * b3z, nz = b2x * b3y - b2y * b3x; // n = b2 × b3
    const m2 = mx * mx + my * my + mz * mz, n2 = nx * nx + ny * ny + nz * nz, lb2 = Math.sqrt(b2x * b2x + b2y * b2y + b2z * b2z);
    if (m2 < 1e-10 || n2 < 1e-10) continue;
    const phi = Math.atan2(lb2 * (b1x * nx + b1y * ny + b1z * nz), mx * nx + my * ny + mz * nz);
    e += k * (1 + Math.cos(n * phi - delta));
    if (g) {
      const dEdphi = -k * n * Math.sin(n * phi - delta);
      const fa = (-dEdphi * lb2) / m2, fd = (dEdphi * lb2) / n2; // ∂φ/∂ra = −|b2|/|m|² m ; ∂φ/∂rd = +|b2|/|n|² n
      const ga = [fa * mx, fa * my, fa * mz], gd = [fd * nx, fd * ny, fd * nz];
      const p1 = (b1x * b2x + b1y * b2y + b1z * b2z) / (lb2 * lb2), p3 = (b3x * b2x + b3y * b2y + b3z * b2z) / (lb2 * lb2);
      for (let t = 0; t < 3; t++) {
        const gb = -(1 + p1) * ga[t] + p3 * gd[t], gc = p1 * ga[t] - (1 + p3) * gd[t];
        g[3 * a + t] += ga[t]; g[3 * b + t] += gb; g[3 * c + t] += gc; g[3 * d + t] += gd[t];
      }
    }
  }
  const vol = (c: number, a: number, b: number, d: number, target: number, sgn: number, w: number) => {
    const ax = x[3 * a] - x[3 * c], ay = x[3 * a + 1] - x[3 * c + 1], az = x[3 * a + 2] - x[3 * c + 2], bx = x[3 * b] - x[3 * c], by = x[3 * b + 1] - x[3 * c + 1], bz = x[3 * b + 2] - x[3 * c + 2], dx = x[3 * d] - x[3 * c], dy = x[3 * d + 1] - x[3 * c + 1], dz = x[3 * d + 2] - x[3 * c + 2];
    const v = ax * (by * dz - bz * dy) + ay * (bz * dx - bx * dz) + az * (bx * dy - by * dx), r = sgn === 0 ? v : Math.min(0, sgn * v - target);
    if (r === 0) return; e += w * r * r;
    if (g) {
      const k = 2 * w * r * (sgn === 0 ? 1 : sgn), ga = [by * dz - bz * dy, bz * dx - bx * dz, bx * dy - by * dx], gb = [dy * az - dz * ay, dz * ax - dx * az, dx * ay - dy * ax], gd = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
      for (let t = 0; t < 3; t++) { g[3 * a + t] += k * ga[t]; g[3 * b + t] += k * gb[t]; g[3 * d + t] += k * gd[t]; g[3 * c + t] -= k * (ga[t] + gb[t] + gd[t]); }
    }
  };
  for (const q of T.chiral) vol(q.c, q.a, q.b, q.d, 1.2, q.sign, 20);
  for (const [c, a, b, d] of T.planar) vol(c, a, b, d, 0, 0, 10);
  for (const [i, j, dmin] of T.repel) {
    const dx = x[3 * i] - x[3 * j], dy = x[3 * i + 1] - x[3 * j + 1], dz = x[3 * i + 2] - x[3 * j + 2], r = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-12;
    if (r >= dmin) continue;
    const d = dmin - r; e += 0.5 * KR * d * d;
    if (g) { const f = (-KR * d) / r; g[3 * i] += f * dx; g[3 * i + 1] += f * dy; g[3 * i + 2] += f * dz; g[3 * j] -= f * dx; g[3 * j + 1] -= f * dy; g[3 * j + 2] -= f * dz; }
  }
  return e;
}

/** Polak–Ribière conjugate gradients with backtracking line search. */
export function ffMinimise(x: X, T: FFTerms, maxIter = 600): number {
  const n3 = x.length, g = new Float64Array(n3), gp = new Float64Array(n3), dir = new Float64Array(n3), xt = new Float64Array(n3);
  let e = ffEnergy(x, T, g), last = 0.01;
  for (let i = 0; i < n3; i++) dir[i] = -g[i];
  for (let it = 0; it < maxIter; it++) {
    let slope = 0, gn = 0; for (let i = 0; i < n3; i++) { slope += g[i] * dir[i]; gn += g[i] * g[i]; }
    if (gn < 1e-6) break;
    if (slope >= 0) { for (let i = 0; i < n3; i++) dir[i] = -g[i]; slope = -gn; }
    let step = last * 2, ok = false, en = e;
    for (let ls = 0; ls < 30; ls++) { for (let i = 0; i < n3; i++) xt[i] = x[i] + step * dir[i]; en = ffEnergy(xt, T, null); if (en <= e + 1e-4 * step * slope) { ok = true; break; } step *= 0.5; }
    if (!ok) break;
    last = step;
    x.set(xt); gp.set(g); const de = e - en; e = ffEnergy(x, T, g);
    let num = 0, den = 0; for (let i = 0; i < n3; i++) { num += g[i] * (g[i] - gp[i]); den += gp[i] * gp[i]; }
    const beta = Math.max(0, num / (den || 1));
    for (let i = 0; i < n3; i++) dir[i] = -g[i] + beta * dir[i];
    if (de < 1e-9) break;
  }
  return e;
}
