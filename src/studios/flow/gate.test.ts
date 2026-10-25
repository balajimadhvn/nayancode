import { describe, expect, it } from 'vitest';
import { applyGate, gateStats, type GateNode } from './gate';

const xs = new Float64Array([5, 15, 0.1, 2, 8]);
const ys = new Float64Array([5, 5, 0.1, 8, 2]);
const cols = { X: xs, Y: ys };

describe('applyGate', () => {
  it('tests rectangles including the border', () => {
    const mask = applyGate(null, cols, { type: 'rect', x: 'X', y: 'Y', xmin: 0, xmax: 10, ymin: 0, ymax: 10 });
    expect([...mask]).toEqual([1, 0, 1, 1, 1]);
  });

  it('uses even-odd point in polygon for a square and a concave L', () => {
    const square = applyGate(null, { X: new Float64Array([5, 15, -1]), Y: new Float64Array([5, 5, -1]) },
      { type: 'polygon', x: 'X', y: 'Y', points: [[0, 0], [10, 0], [10, 10], [0, 10]] });
    expect([...square]).toEqual([1, 0, 0]);
    const L = applyGate(null, { X: new Float64Array([2, 8, 2, 8]), Y: new Float64Array([2, 2, 8, 8]) },
      { type: 'polygon', x: 'X', y: 'Y', points: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]] });
    expect([...L]).toEqual([1, 1, 1, 0]);
  });

  it('rotates an ellipse by 90 degrees, swapping rx and ry', () => {
    const points = { X: new Float64Array([0, 9, 0]), Y: new Float64Array([9, 0, 1]) };
    const flat = applyGate(null, points, { type: 'ellipse', x: 'X', y: 'Y', cx: 0, cy: 0, rx: 10, ry: 2, angle: 0 });
    expect([...flat]).toEqual([0, 1, 1]);
    const turned = applyGate(null, points, { type: 'ellipse', x: 'X', y: 'Y', cx: 0, cy: 0, rx: 10, ry: 2, angle: 90 });
    expect([...turned]).toEqual([1, 0, 1]);
  });

  it('combines a parent mask with AND', () => {
    const parent = new Uint8Array([1, 1, 0, 1, 1]);
    const mask = applyGate(parent, cols, { type: 'rect', x: 'X', y: 'Y', xmin: 0, xmax: 10, ymin: 0, ymax: 10 });
    expect([...mask]).toEqual([1, 0, 0, 1, 1]);
  });
});

describe('gateStats', () => {
  const transformed = { X: new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), Y: new Float64Array(10) };
  const raw = { X: new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) };
  const all: GateNode = { id: 'all', name: 'All', parent: null, gate: { type: 'rect', x: 'X', y: 'Y', xmin: 0, xmax: 11, ymin: -1, ymax: 1 } };
  const half: GateNode = { id: 'half', name: 'Half', parent: 'all', gate: { type: 'rect', x: 'X', y: 'Y', xmin: 5.5, xmax: 11, ymin: -1, ymax: 1 } };

  it('counts the tree, keeps children below parents and computes raw statistics', () => {
    const [a, b] = gateStats([all, half], transformed, raw, ['X']);
    expect(a.count).toBe(10); expect(a.percentParent).toBe(100); expect(a.percentTotal).toBe(100);
    expect(b.count).toBe(5); expect(b.percentParent).toBe(50); expect(b.percentTotal).toBe(50);
    expect(a.channels.X.median).toBeCloseTo(5.5, 12);
    expect(a.channels.X.mean).toBeCloseTo(5.5, 12);
    expect(a.channels.X.cv).toBeCloseTo(55.04818825631803, 10);
    expect(b.channels.X.median).toBeCloseTo(8, 12);
    expect(b.count).toBeLessThanOrEqual(a.count);
  });

  it('rejects a missing parent and a cycle', () => {
    expect(() => gateStats([{ ...half, parent: 'nope' }], transformed, raw, [])).toThrow(/not found/);
    expect(() => gateStats([{ ...all, parent: 'half' }, half], transformed, raw, [])).toThrow(/cycle/);
  });
});
