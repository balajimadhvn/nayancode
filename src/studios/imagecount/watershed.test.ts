import { describe, expect, it } from 'vitest';
import { label } from './seg';
import { splitTouching } from './watershed';

const W = 140, H = 100;

function discs(list: { x: number; y: number; r: number }[]): Uint8Array {
  const m = new Uint8Array(W * H);
  for (const d of list) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if ((x - d.x) ** 2 + (y - d.y) ** 2 <= d.r * d.r) m[y * W + x] = 1;
  }
  return m;
}

function areas(labels: Int32Array): number[] {
  const counts = new Map<number, number>();
  for (const l of labels) if (l > 0) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.values()];
}

describe('splitTouching', () => {
  it('does not split a single disc', () => {
    const m = discs([{ x: 70, y: 50, r: 20 }]);
    expect(label(m, W, H).components).toHaveLength(1);
    const out = splitTouching(m, W, H);
    expect(areas(out)).toHaveLength(1);
    expect(out.filter((l) => l > 0)).toHaveLength(label(m, W, H).components[0].area);
  });

  it('splits two overlapping discs into two basins of similar area', () => {
    const m = discs([{ x: 55, y: 50, r: 20 }, { x: 85, y: 50, r: 20 }]);
    expect(label(m, W, H).components).toHaveLength(1);
    const a = areas(splitTouching(m, W, H));
    expect(a).toHaveLength(2);
    expect(Math.abs(a[0] - a[1]) / Math.max(a[0], a[1])).toBeLessThan(0.2);
  });

  it('splits a chain of three overlapping discs into three', () => {
    const m = discs([{ x: 35, y: 50, r: 20 }, { x: 65, y: 50, r: 20 }, { x: 95, y: 50, r: 20 }]);
    expect(label(m, W, H).components).toHaveLength(1);
    expect(areas(splitTouching(m, W, H))).toHaveLength(3);
  });
});
