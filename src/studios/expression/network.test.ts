import { describe, expect, it } from 'vitest';
import { coMembershipNetwork, communities, degrees, forceLayout } from './network';

const tri = (o: number): { a: number; b: number; w: number }[] => [{ a: o, b: o + 1, w: 1 }, { a: o + 1, b: o + 2, w: 1 }, { a: o + 2, b: o, w: 1 }];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe('coMembershipNetwork', () => {
  const sets = { P1: ['A', 'B', 'C'], P2: ['B', 'C', 'D'], P3: ['E', 'F'] };
  const genes = ['A', 'B', 'C', 'D', 'E', 'F'];
  it('weights an edge by the number of shared pathways and keeps groups apart', () => {
    const g = coMembershipNetwork(genes, sets);
    const w = (x: string, y: string) => g.edges.find((e) => (g.nodes[e.a] === x && g.nodes[e.b] === y) || (g.nodes[e.a] === y && g.nodes[e.b] === x))?.w ?? 0;
    expect(g.nodes).toEqual(genes);
    expect(w('B', 'C')).toBe(2);
    expect(w('A', 'B')).toBe(1);
    expect(w('A', 'D')).toBe(0); // A is in P1 only, D is in P2 only
    for (const x of ['A', 'B', 'C', 'D']) for (const y of ['E', 'F']) expect(w(x, y)).toBe(0);
    expect(g.edges).toHaveLength(6); // A–B, A–C, B–C, B–D, C–D, E–F
  });
  it('ignores pathways larger than maxSetSize', () => {
    const big = { P1: ['A', 'B', 'C'], HUGE: ['A', 'B', 'C', 'D'] };
    expect(coMembershipNetwork(genes, big, 4).edges).toHaveLength(6); // both sets count when allowed
    expect(coMembershipNetwork(genes, big, 3).edges).toHaveLength(3); // only P1; HUGE is too big
  });
  it('deduplicates symbols case-insensitively', () => {
    const g = coMembershipNetwork(['a', 'A', 'B'], { P: ['A', 'B'] });
    expect(g.nodes).toEqual(['A', 'B']);
    expect(g.edges).toEqual([{ a: 0, b: 1, w: 1 }]);
  });
});

describe('forceLayout', () => {
  const graph = [...tri(0), ...tri(3)];
  it('pulls triangles together and keeps them apart', () => {
    const pos = forceLayout(6, graph, { iterations: 300, seed: 1 });
    const dist = (i: number, j: number) => Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]);
    const pairs = (a: number[]) => a.flatMap((i) => a.filter((j) => j > i).map((j) => dist(i, j)));
    const inside = mean([...pairs([0, 1, 2]), ...pairs([3, 4, 5])]);
    const across = mean([0, 1, 2].flatMap((i) => [3, 4, 5].map((j) => dist(i, j))));
    expect(inside).toBeLessThan(0.5 * across);
  });
  it('is deterministic for a seed', () => {
    expect(forceLayout(6, graph, { seed: 7 })).toEqual(forceLayout(6, graph, { seed: 7 }));
    expect(forceLayout(6, graph, { seed: 7 })).not.toEqual(forceLayout(6, graph, { seed: 8 }));
  });
  it('returns finite positions inside the box', () => {
    for (const [x, y] of forceLayout(6, graph, { width: 3, height: 2, seed: 3 })) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(3);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(2);
    }
    expect(forceLayout(0, [])).toEqual([]);
  });
});

describe('degrees and communities', () => {
  const graph = [...tri(0), ...tri(3)];
  it('counts weighted degree', () => {
    expect(degrees(6, graph)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(degrees(2, [{ a: 0, b: 1, w: 3 }])).toEqual([3, 3]);
  });
  it('finds exactly two communities in two disconnected triangles', () => {
    const c = communities(6, graph);
    expect(new Set(c).size).toBe(2);
    expect(c.slice(0, 3)).toEqual([c[0], c[0], c[0]]);
    expect(c.slice(3)).toEqual([c[3], c[3], c[3]]);
    expect(c[0]).not.toBe(c[3]);
  });
});
