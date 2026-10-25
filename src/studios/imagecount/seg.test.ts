import { describe, expect, it } from 'vitest';
import { autoPolarity, fillHoles, filterBySize, gaussianBlur, label, otsu, toGrey } from './seg';

const W = 200, H = 200;
const DISCS = [
  { x: 30, y: 30, r: 8 }, { x: 80, y: 35, r: 9 }, { x: 130, y: 30, r: 10 }, { x: 180, y: 40, r: 11 },
  { x: 40, y: 120, r: 12 }, { x: 100, y: 130, r: 13 }, { x: 160, y: 115, r: 14 },
];

function dots(bg = 30, fg = 230): Float32Array {
  const g = new Float32Array(W * H).fill(bg);
  for (const d of DISCS) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if ((x - d.x) ** 2 + (y - d.y) ** 2 <= d.r * d.r) g[y * W + x] = fg;
  }
  return g;
}

function maskOf(g: Float32Array, threshold: number): Uint8Array {
  const m = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) m[i] = g[i] > threshold ? 1 : 0;
  return m;
}

export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('toGrey', () => {
  it('uses Rec. 601 luminance', () => {
    expect(toGrey(new Uint8ClampedArray([255, 0, 0, 255]))[0]).toBeCloseTo(76.245, 4);
    expect(toGrey(new Uint8ClampedArray([0, 255, 0, 255]))[0]).toBeCloseTo(149.685, 4);
  });
});

describe('gaussianBlur', () => {
  it('returns the input unchanged for sigma 0 and preserves a constant field', () => {
    const g = new Float32Array(100).fill(7);
    expect(gaussianBlur(g, 10, 10, 0)).toBe(g);
    const b = gaussianBlur(g, 10, 10, 1.5);
    for (const v of b) expect(v).toBeCloseTo(7, 6);
  });
});

describe('otsu', () => {
  it('separates a two-valued image with a threshold at the lower class', () => {
    const g = new Float32Array(100 * 100);
    for (let i = 0; i < g.length; i++) g[i] = i < 5000 ? 50 : 200;
    const t = otsu(g);
    expect(t).toBeGreaterThanOrEqual(50); expect(t).toBeLessThan(200);
    expect(maskOf(g, t).reduce((a, b) => a + b, 0)).toBe(5000);
  });

  it('puts the threshold between the modes of a bimodal Gaussian mixture', () => {
    const rnd = seeded(9);
    const normal = (mean: number, sd: number) => {
      const u = Math.max(1e-12, rnd()), v = rnd();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const g = new Float32Array(10000);
    for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, normal(i < 5000 ? 60 : 190, 10)));
    const t = otsu(g);
    expect(t).toBeGreaterThan(100); expect(t).toBeLessThan(150);
  });
});

describe('autoPolarity and labelling', () => {
  it('detects seven bright discs and their areas and centroids', () => {
    const m = maskOf(dots(), 100);
    const { labels, components } = label(m, W, H);
    expect(components).toHaveLength(7);
    const expectedArea = DISCS.reduce((s, d) => s + Math.PI * d.r * d.r, 0);
    const actualArea = components.reduce((s, c) => s + c.area, 0);
    expect(Math.abs(actualArea - expectedArea) / expectedArea).toBeLessThan(0.05);
    components.forEach((c) => {
      const d = DISCS.find((x) => Math.hypot(c.cx - x.x, c.cy - x.y) < 0.5);
      expect(d).toBeDefined();
      expect(Math.abs(c.area - Math.PI * d!.r ** 2) / (Math.PI * d!.r ** 2)).toBeLessThan(0.05);
    });
    for (const d of DISCS) expect(components.some((c) => Math.hypot(c.cx - d.x, c.cy - d.y) < 0.5)).toBe(true);
    expect(labels.filter((l) => l > 0)).toHaveLength(actualArea);
  });

  it('flags dark objects on a bright background and counts them after inversion', () => {
    const g = new Float32Array(W * H).fill(230);
    for (const d of DISCS) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if ((x - d.x) ** 2 + (y - d.y) ** 2 <= d.r * d.r) g[y * W + x] = 40;
    }
    expect(autoPolarity(g, W, H)).toBe(true);
    const inverted = Float32Array.from(g, (v) => 255 - v);
    const { components } = label(maskOf(inverted, otsu(inverted)), W, H);
    expect(components).toHaveLength(7);
  });
});

describe('fillHoles and filterBySize', () => {
  it('fills a ring into a disc', () => {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d2 = (x - 100) ** 2 + (y - 100) ** 2;
      if (d2 <= 400 && d2 > 100) m[y * W + x] = 1;
    }
    const before = m.reduce((a, b) => a + b, 0);
    const out = fillHoles(m, W, H);
    const after = out.reduce((a, b) => a + b, 0);
    expect(before).toBeLessThan(Math.PI * 400 * 0.85);
    expect(Math.abs(after - Math.PI * 400) / (Math.PI * 400)).toBeLessThan(0.05);
    expect(out[100 * W + 100]).toBe(1);
  });

  it('removes a three-pixel speck but keeps the discs', () => {
    const m = maskOf(dots(), 100);
    m[5 * W + 5] = 1; m[5 * W + 6] = 1; m[5 * W + 7] = 1;
    const { components } = label(m, W, H);
    expect(components).toHaveLength(8);
    expect(filterBySize(components, 12, 10000)).toHaveLength(7);
  });
});
