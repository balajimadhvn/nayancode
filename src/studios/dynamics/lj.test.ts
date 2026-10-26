import { describe, expect, it } from 'vitest';
import { forces, initLj, kineticT, makeFcc, maxwell, momentum, mulberry32, runLj, step, totalEnergy, pressure, type LjState } from './lj';

const FCC_RC5_ENERGY_PER_ATOM = -8.298746504582091; // /tmp/phase4-scratch/refs.py (numpy, rc=5, no shift)

describe('fcc lattice energy (known answer from numpy)', () => {
  it('matches the independent lattice sum to 1e-6 relative', () => {
    const { pos, L, n } = makeFcc(5, 1.0);
    expect(n).toBe(500);
    expect(L).toBeCloseTo(7.937005259840997, 12);
    const r = forces(pos, L, 5.0, { shift: false });
    expect(r.pe / n).toBeCloseTo(FCC_RC5_ENERGY_PER_ATOM, 5);
    expect(Math.abs(r.pe / n - FCC_RC5_ENERGY_PER_ATOM) / Math.abs(FCC_RC5_ENERGY_PER_ATOM)).toBeLessThan(1e-6);
  });
});

describe('force is minus the gradient', () => {
  it('matches central finite differences for a random 32-atom configuration', () => {
    const rnd = mulberry32(11);
    const n = 32, L = 8;
    let pos = new Float64Array(3 * n);
    // rejection sampling: no pair closer than 0.8
    for (let tries = 0; tries < 10000; tries++) {
      for (let i = 0; i < 3 * n; i++) pos[i] = rnd() * L;
      let ok = true;
      for (let i = 0; i < n && ok; i++) for (let j = i + 1; j < n && ok; j++) {
        const dx = Math.abs(pos[3 * i] - pos[3 * j]), dy = Math.abs(pos[3 * i + 1] - pos[3 * j + 1]), dz = Math.abs(pos[3 * i + 2] - pos[3 * j + 2]);
        const r = Math.hypot(Math.min(dx, L - dx), Math.min(dy, L - dy), Math.min(dz, L - dz));
        if (r < 0.8) ok = false;
      }
      if (ok) break;
    }
    const f = forces(pos, L, 2.5, { shift: true }).f;
    const h = 1e-6;
    for (const i of [0, 7, 19]) {
      for (let d = 0; d < 3; d++) {
        const idx = 3 * i + d;
        const pp = Float64Array.from(pos); pp[idx] += h;
        const pm = Float64Array.from(pos); pm[idx] -= h;
        const ep = forces(pp, L, 2.5, { shift: true }).pe;
        const em = forces(pm, L, 2.5, { shift: true }).pe;
        const numeric = -(ep - em) / (2 * h);
        expect(Math.abs(numeric - f[idx]) / Math.max(1e-8, Math.hypot(f[3 * i], f[3 * i + 1], f[3 * i + 2]))).toBeLessThan(1e-5);
      }
    }
  });
});

describe('NVE conservation', () => {
  it('conserves energy and momentum for 2000 steps of 256 atoms', () => {
    const s = initLj(4, 0.8442, 1.0, 7, 2.5, true);
    const e0 = totalEnergy(s);
    let worst = 0, pworst = momentum(s);
    for (let i = 0; i < 2000; i++) {
      step(s, 0.003);
      worst = Math.max(worst, Math.abs(totalEnergy(s) - e0) / Math.abs(e0));
      if (i % 100 === 0) pworst = Math.max(pworst, momentum(s));
    }
    expect(worst).toBeLessThan(1e-3);
    expect(pworst).toBeLessThan(1e-9);
  });
});

describe('Berendsen thermostat', () => {
  it('holds 1.2 within 0.03 over the last 300 steps', () => {
    const s: LjState = initLj(4, 0.8442, 1.2, 3, 2.5, true);
    const temps: number[] = [];
    for (let i = 0; i < 1000; i++) {
      step(s, 0.003, { thermostat: 'berendsen', targetT: 1.2, tau: 0.2 });
      if (i >= 700) temps.push(kineticT(s));
    }
    const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
    expect(Math.abs(mean - 1.2)).toBeLessThan(0.03);
  });
});

describe('basic invariants', () => {
  it('Maxwell velocities have the requested temperature and zero momentum', () => {
    const v = maxwell(108, 1.5, 42);
    const s = { vel: v, n: 108 };
    expect(kineticT(s)).toBeCloseTo(1.5, 10);
    expect(momentum(s)).toBeLessThan(1e-10);
  });
  it('the ideal-gas limit gives P = rho T', () => {
    const s = initLj(2, 0.05, 1.0, 1, 2.5, true);
    const P = pressure(s);
    expect(P).toBeCloseTo(0.05, 4);
  });
  it('a short run keeps all positions inside the box', () => {
    const s = initLj(3, 0.8, 1.0, 5);
    runLj(s, 20, 0.003);
    for (let i = 0; i < s.pos.length; i++) {
      expect(s.pos[i]).toBeGreaterThanOrEqual(0);
      expect(s.pos[i]).toBeLessThan(s.L);
    }
  });
});
