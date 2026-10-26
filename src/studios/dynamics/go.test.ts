import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { caTrace, nativeContacts } from './goParse';
import { buildGoModel, EPS_R, forcesGo, SIGMA_R, TERMS, type Coords } from './go';
import { initGo, observe, runGo, stepGo, temperatureGo } from './goSim';

const pdb = (name: string) => readFileSync(new URL(`./fixtures/${name}.pdb`, import.meta.url), 'utf8');
const ubq = caTrace(pdb('1ubq'));
const pga = caTrace(pdb('1pga'));

describe('caTrace and nativeContacts (known answers from numpy)', () => {
  it('1UBQ has 76 C-alpha atoms and 151 contacts at 8 A, separation >= 4', () => {
    expect(ubq.n).toBe(76);
    expect(nativeContacts(ubq)).toHaveLength(151);
    expect(ubq.residues[0]).toEqual({ seq: 1, res: 'MET' });
  });
  it('1PGA has 56 C-alpha atoms and 116 contacts', () => {
    expect(pga.n).toBe(56);
    expect(nativeContacts(pga)).toHaveLength(116);
  });
});

describe('Go model at the native state', () => {
  const m = buildGoModel(ubq);
  const c: Coords = { x: m.nativeX, y: m.nativeY, z: m.nativeZ };
  it('bond, angle and dihedral forces vanish', () => {
    const f = forcesGo(m, c, ['bond', 'angle', 'dihedral']);
    let max = 0;
    for (let i = 0; i < m.n; i++) max = Math.max(max, Math.hypot(f.fx[i], f.fy[i], f.fz[i]));
    expect(max).toBeLessThan(1e-6);
  });
  it('native contacts are at r0 and contribute -N_contacts; non-native repulsion is small', () => {
    const f = forcesGo(m, c);
    let nn = 0;
    for (const q of m.nonnative) {
      const r = Math.hypot(c.x[q.i] - c.x[q.j], c.y[q.i] - c.y[q.j], c.z[q.i] - c.z[q.j]);
      nn += EPS_R * (SIGMA_R / r) ** 12;
    }
    expect(f.parts.native).toBeCloseTo(-m.native.length, 10);
    expect(f.parts.nonnative).toBeCloseTo(nn, 10);
    expect(f.parts.total).toBeCloseTo(-m.native.length + nn, 9);
    let max = 0;
    for (let i = 0; i < m.n; i++) max = Math.max(max, Math.hypot(f.fx[i], f.fy[i], f.fz[i]));
    expect(max).toBeLessThan(1e-3);
  });
});

describe('analytic forces match finite differences for every term', () => {
  const m = buildGoModel(pga);
  const c: Coords = { x: Float64Array.from(m.nativeX), y: Float64Array.from(m.nativeY), z: Float64Array.from(m.nativeZ) };
  // perturb so that every term has a non-zero force
  let seed = 3;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < m.n; i++) { c.x[i] += (rnd() - 0.5) * 0.3; c.y[i] += (rnd() - 0.5) * 0.3; c.z[i] += (rnd() - 0.5) * 0.3; }

  for (const term of TERMS) {
    it(`${term}`, () => {
      const f = forcesGo(m, c, [term]);
      const h = 1e-5;
      for (const i of [0, 11, 23, 35, 47]) {
        for (const axis of ['x', 'y', 'z'] as const) {
          const cp: Coords = { x: Float64Array.from(c.x), y: Float64Array.from(c.y), z: Float64Array.from(c.z) };
          const cm: Coords = { x: Float64Array.from(c.x), y: Float64Array.from(c.y), z: Float64Array.from(c.z) };
          cp[axis][i] += h; cm[axis][i] -= h;
          const num = -(forcesGo(m, cp, [term]).parts.total - forcesGo(m, cm, [term]).parts.total) / (2 * h);
          const ana = axis === 'x' ? f.fx[i] : axis === 'y' ? f.fy[i] : f.fz[i];
          const scale = Math.max(1e-8, Math.hypot(f.fx[i], f.fy[i], f.fz[i]));
          expect(Math.abs(num - ana) / scale).toBeLessThan(1e-4);
        }
      }
    });
  }
});

describe('Langevin thermostat', () => {
  it('mean kinetic temperature of 1PGA at T = 0.5 is within 5 %', () => {
    const s = initGo(buildGoModel(pga), 0.5, 5);
    let sum = 0, n = 0;
    for (let i = 0; i < 20_000; i++) {
      stepGo(s, 0.005, { T: 0.5, gamma: 0.05 });
      if (i >= 5_000) { sum += temperatureGo(s); n++; }
    }
    const mean = sum / n;
    expect(Math.abs(mean - 0.5) / 0.5).toBeLessThan(0.05);
  });
});

describe('folding behaviour (relative, seeded)', () => {
  function meanQ(T: number): number {
    const s = initGo(buildGoModel(pga), T, 9);
    let q = 0, n = 0;
    runGo(s, 30_000, 0.005, { T, gamma: 0.05, every: 100, onFrame: (_step, o) => { if (_step > 5_000) { q += o.Q; n++; } } });
    return q / Math.max(1, n);
  }
  it('T = 0.3 keeps the native fold (mean Q > 0.8)', () => { expect(meanQ(0.3)).toBeGreaterThan(0.8); });
  it('T = 2.0 unfolds it (mean Q < 0.4)', () => { expect(meanQ(2.0)).toBeLessThan(0.4); });
});

describe('observables', () => {
  it('native state has Q = 1, RMSD ~ 0 and a sensible Rg', () => {
    const s = initGo(buildGoModel(pga), 0.5, 1);
    const o = observe(s);
    expect(o.Q).toBe(1);
    expect(o.rmsd).toBeLessThan(1e-8);
    expect(o.rg).toBeGreaterThan(8);
    expect(o.rg).toBeLessThan(20);
  });
});
