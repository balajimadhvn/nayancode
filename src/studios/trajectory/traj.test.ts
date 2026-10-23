import { describe, expect, test } from 'vitest';
import { freeEnergy2D, hbondCount, parsePdbTrajectory, pca, radiusOfGyration, rmsd, rmsdToMean, rmsf, rmsfByResidue, type Frame, type TrajAtom } from './traj';

const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

const atom = (name: string, res: string, chain: string, seq: number, x: number, y: number, z: number): TrajAtom => ({ name, res, chain, seq, x, y, z, el: name.startsWith('N') ? 'N' : name.startsWith('O') ? 'O' : name.startsWith('C') ? 'C' : 'C' });

const pdbLine = (serial: number, a: TrajAtom) => `ATOM  ${String(serial).padStart(5)} ${a.name.length < 4 ? ' ' + a.name.padEnd(3) : a.name} ${a.res.padStart(3)} ${a.chain}${String(a.seq).padStart(4)}    ${a.x.toFixed(3).padStart(8)}${a.y.toFixed(3).padStart(8)}${a.z.toFixed(3).padStart(8)}  1.00  0.00          ${a.el.padStart(2)}`;
const pdbText = (frames: Frame[]) => frames.map((f, k) => `MODEL     ${k + 1}\n${f.map((a, i) => pdbLine(i + 1, a)).join('\n')}\nENDMDL`).join('\n') + '\nEND\n';

/** apply a random proper rotation and translation */
function rigid(frame: Frame, r: () => number, maxShift = 20): Frame {
  const u1 = r(), u2 = r(), u3 = r();
  const q = [Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2), Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2), Math.sqrt(u1) * Math.sin(2 * Math.PI * u3), Math.sqrt(u1) * Math.cos(2 * Math.PI * u3)];
  const [w, x, y, z] = q;
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const t = [(r() - 0.5) * maxShift, (r() - 0.5) * maxShift, (r() - 0.5) * maxShift];
  return frame.map((a) => ({ ...a, x: R[0][0] * a.x + R[0][1] * a.y + R[0][2] * a.z + t[0], y: R[1][0] * a.x + R[1][1] * a.y + R[1][2] * a.z + t[1], z: R[2][0] * a.x + R[2][1] * a.y + R[2][2] * a.z + t[2] }));
}

const body = (r: () => number, n = 20): Frame => Array.from({ length: n }, (_, i) => atom('CA', 'ALA', 'A', i + 1, (r() - 0.5) * 20, (r() - 0.5) * 20, (r() - 0.5) * 20));

describe('PDB multi-model parser', () => {
  test('parses MODEL blocks and fixed PDB columns', () => {
    const f1 = [atom('CA', 'ALA', 'A', 1, 1.5, 2.5, 3.5), atom('N', 'ALA', 'A', 1, 0.5, 2.5, 3.5), atom('CA', 'GLY', 'B', 2, -1, -2, -3)];
    const f2 = f1.map((a) => ({ ...a, x: a.x + 1 }));
    const frames = parsePdbTrajectory(pdbText([f1, f2]));
    expect(frames).toHaveLength(2);
    expect(frames[0][0]).toMatchObject({ name: 'CA', res: 'ALA', chain: 'A', seq: 1, x: 1.5, y: 2.5, z: 3.5 });
    expect(frames[0][2]).toMatchObject({ name: 'CA', res: 'GLY', chain: 'B', seq: 2, x: -1, y: -2, z: -3 });
    expect(frames[1][0].x).toBeCloseTo(2.5, 9);
  });

  test('a file without MODEL records is a single frame', () => {
    const f = body(mulberry32(3), 5);
    const frames = parsePdbTrajectory(f.map((a, i) => pdbLine(i + 1, a)).join('\n'));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(5);
  });

  test('frames with different atom counts are rejected', () => {
    const f = body(mulberry32(4), 4);
    expect(() => parsePdbTrajectory(pdbText([f, f.slice(1)]))).toThrow(/frame 2 has a different atom count/);
  });
});

describe('superposition, RMSD and RMSF', () => {
  test('a rigid body copied with random rotations and translations superposes to < 1e-6 Å', () => {
    const r = mulberry32(11);
    const base = body(r);
    const frames = Array.from({ length: 30 }, (_, k) => (k === 0 ? base : rigid(base, r)));
    const after = rmsd(frames);
    expect(after).toHaveLength(30);
    for (const v of after) expect(v).toBeLessThan(1e-6);
    const raw = Math.sqrt(base.reduce((s, a, i) => s + (a.x - frames[1][i].x) ** 2 + (a.y - frames[1][i].y) ** 2 + (a.z - frames[1][i].z) ** 2, 0) / base.length);
    expect(raw).toBeGreaterThan(1);
  });

  test('Gaussian noise of 0.5 Å per coordinate gives RMSF and RMSD to the mean near 0.866 Å', () => {
    const r = mulberry32(23);
    const base = body(r);
    const sigma = 0.5;
    const frames = Array.from({ length: 400 }, () => base.map((a) => ({ ...a, x: a.x + sigma * gauss(r), y: a.y + sigma * gauss(r), z: a.z + sigma * gauss(r) })));
    const fluct = rmsf(frames, 'ca');
    const expected = sigma * Math.sqrt(3);
    for (const v of fluct) expect(Math.abs(v - expected) / expected).toBeLessThan(0.06);
    const toMean = rmsdToMean(frames, 'ca');
    const avg = toMean.reduce((s, v) => s + v, 0) / toMean.length;
    expect(Math.abs(avg - expected) / expected).toBeLessThan(0.06);
    expect(rmsfByResidue(frames, 'ca')).toHaveLength(base.length);
  });

  test('radius of gyration of a centred cube of side 2 is sqrt(3)', () => {
    const cube: Frame = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cube.push(atom('CA', 'GLY', 'A', cube.length + 1, x, y, z));
    expect(radiusOfGyration(cube)).toBeCloseTo(Math.sqrt(3), 9);
  });

  test('hydrogen bonds count N/O pairs within 3.5 Å in different residues', () => {
    const frame = [atom('N', 'ALA', 'A', 1, 0, 0, 0), { ...atom('O', 'GLY', 'A', 2, 2.9, 0, 0) }, { ...atom('O', 'SER', 'A', 3, 10, 0, 0) }];
    expect(hbondCount(frame)).toBe(1);
  });
});

describe('essential dynamics (PCA)', () => {
  test('a planted collective motion is recovered as PC1', () => {
    const r = mulberry32(31);
    const base = Array.from({ length: 4 }, (_, i) => atom('CA', 'ALA', 'A', i + 1, i * 4, 0, 0));
    const raw = base.map((_, i) => (i % 2 === 0 ? 1 : -1));
    const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
    const v = raw.map((x) => x / norm);
    const amp = 3, sigma = 0.3;
    const frames = Array.from({ length: 400 }, () => {
      const a = amp * gauss(r);
      return base.map((p, i) => ({ ...p, x: p.x + a * v[i] + sigma * gauss(r), y: p.y + sigma * gauss(r), z: p.z + sigma * gauss(r) }));
    });
    const res = pca(frames, 'ca', 3);
    expect(res.eigenvalues[0]).toBeGreaterThan(9.09 * 0.9);
    expect(res.eigenvalues[0]).toBeLessThan(9.09 * 1.1);
    expect(res.explained[0]).toBeGreaterThan(0.85);
    const pc1 = res.eigenvectors[0];
    // only the x components of a breathing mode matter; compare with the planted 3N vector
    const planted = new Array(12).fill(0).map((_, d) => (d % 3 === 0 ? v[Math.floor(d / 3)] : 0));
    const dot = pc1.reduce((s, x, d) => s + x * planted[d], 0);
    expect(Math.abs(dot)).toBeGreaterThan(0.99);
    expect(res.projections).toHaveLength(400);
    expect(res.projections[0]).toHaveLength(3);
  });
});

describe('free-energy surface', () => {
  test('a 2-D Gaussian has its minimum at the centre and 0.5 kT at one sigma', () => {
    const r = mulberry32(41);
    const n = 200000, sigma = 1;
    const x: number[] = [], y: number[] = [];
    for (let i = 0; i < n; i++) { x.push(sigma * gauss(r)); y.push(sigma * gauss(r)); }
    const bins = 40;
    const fe = freeEnergy2D(x, y, bins, 300);
    const kT = 0.0083144626 * 300;
    let best = { i: 0, j: 0, v: Infinity };
    for (let i = 0; i < bins; i++) for (let j = 0; j < bins; j++) if (Number.isFinite(fe[i][j]) && fe[i][j] < best.v) best = { i, j, v: fe[i][j] };
    expect(best.v).toBeGreaterThanOrEqual(0);
    expect(best.v).toBeLessThan(1e-9);
    const xMin = x.reduce((s, v) => Math.min(s, v), Infinity), xMax = x.reduce((s, v) => Math.max(s, v), -Infinity);
    const yMin = y.reduce((s, v) => Math.min(s, v), Infinity), yMax = y.reduce((s, v) => Math.max(s, v), -Infinity);
    const ix = Math.floor(((1 - xMin) / (xMax - xMin)) * bins);
    const jy = Math.floor(((0 - yMin) / (yMax - yMin)) * bins);
    expect(Math.abs(fe[ix][jy] - 0.5 * kT) / (0.5 * kT)).toBeLessThan(0.25);
    expect(Number.isNaN(fe[0][0]) || fe[0][0] > 0).toBe(true);
  });
});
