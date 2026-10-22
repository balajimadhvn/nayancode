/** Gene network for a list of differentially expressed genes.
 *
 *  Offline edges come from pathway co-membership: two genes are joined when they share at least one pathway, and the edge
 *  weight is the number of shared pathways. Sets bigger than `maxSetSize` are skipped so that giant pathways (ribosome,
 *  signalling) do not connect every gene to every other gene. Co-membership is not a physical interaction.
 *
 *  Drawing uses Fruchterman–Reingold with a fixed seed, so the same graph always gives the same picture.
 */
import { louvain } from '@/studios/singlecell/kernels';

export interface Net { nodes: string[]; edges: { a: number; b: number; w: number }[] }

/** Graph from pathway co-membership. `sets` maps a pathway id/name to its gene symbols; order of `genes` is preserved. */
export function coMembershipNetwork(genes: string[], sets: Record<string, string[]>, maxSetSize = 200): Net {
  const nodes: string[] = [], index = new Map<string, number>();
  for (const g of genes) {
    const s = g.trim().toUpperCase();
    if (!s || index.has(s)) continue;
    index.set(s, nodes.length); nodes.push(s);
  }
  const weights = new Map<number, number>();
  for (const members of Object.values(sets)) {
    if (members.length > maxSetSize) continue;
    const hit: number[] = [];
    for (const g of members) { const i = index.get(g.trim().toUpperCase()); if (i !== undefined) hit.push(i); }
    for (let x = 0; x < hit.length; x++) for (let y = x + 1; y < hit.length; y++) {
      const a = Math.min(hit[x], hit[y]), b = Math.max(hit[x], hit[y]), key = a * nodes.length + b;
      weights.set(key, (weights.get(key) ?? 0) + 1);
    }
  }
  const edges = [...weights.entries()].map(([key, w]) => ({ a: Math.floor(key / nodes.length), b: key % nodes.length, w }))
    .sort((p, q) => p.a - q.a || p.b - q.b || p.w - q.w);
  return { nodes, edges };
}

/** Weighted degree of every node. */
export function degrees(n: number, edges: { a: number; b: number; w: number }[]): number[] {
  const d = new Array<number>(n).fill(0);
  for (const e of edges) { if (e.a === e.b) continue; d[e.a] += e.w; d[e.b] += e.w; }
  return d;
}

/** Louvain communities from the same adjacency lists the Single-Cell Studio uses; ids are renumbered from 0 by size. */
export function communities(n: number, edges: { a: number; b: number; w: number }[]): number[] {
  if (!n) return [];
  const adj: Map<number, number>[] = Array.from({ length: n }, () => new Map<number, number>());
  for (const e of edges) {
    if (e.a === e.b) continue;
    adj[e.a].set(e.b, (adj[e.a].get(e.b) ?? 0) + e.w);
    adj[e.b].set(e.a, (adj[e.b].get(e.a) ?? 0) + e.w);
  }
  const raw = louvain(adj, 1, 1), sizes = new Map<number, number>();
  for (const c of raw) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const order = [...sizes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).map(([c]) => c);
  const id = new Map(order.map((c, i) => [c, i]));
  return raw.map((c) => id.get(c)!);
}

export interface LayoutOpts { iterations?: number; seed?: number; width?: number; height?: number }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Fruchterman–Reingold with a fixed seed. Returns positions inside [0,width] × [0,height]. */
export function forceLayout(n: number, edges: { a: number; b: number; w: number }[], opts: LayoutOpts = {}): [number, number][] {
  const { iterations = 300, seed = 1, width = 1, height = 1 } = opts;
  if (!n) return [];
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pos = Array.from({ length: n }, (): [number, number] => [width * (0.05 + 0.9 * rnd()), height * (0.05 + 0.9 * rnd())]);
  const disp = Array.from({ length: n }, (): [number, number] => [0, 0]);
  const k = Math.sqrt((width * height) / Math.max(1, n));
  let temp = Math.min(width, height) / 10;
  const cool = temp / Math.max(1, iterations);
  for (let it = 0; it < iterations; it++) {
    for (const d of disp) { d[0] = 0; d[1] = 0; }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = pos[i][0] - pos[j][0], dy = pos[i][1] - pos[j][1], d2 = dx * dx + dy * dy;
      if (d2 < 1e-12) { dx = (rnd() - 0.5) * 1e-6 + 1e-6; dy = (rnd() - 0.5) * 1e-6; d2 = dx * dx + dy * dy; }
      const f = (k * k) / d2;
      disp[i][0] += dx * f; disp[i][1] += dy * f; disp[j][0] -= dx * f; disp[j][1] -= dy * f;
    }
    for (const e of edges) {
      if (e.a === e.b) continue;
      const dx = pos[e.a][0] - pos[e.b][0], dy = pos[e.a][1] - pos[e.b][1];
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-9, f = (d * d) / k;
      disp[e.a][0] -= (dx / d) * f; disp[e.a][1] -= (dy / d) * f;
      disp[e.b][0] += (dx / d) * f; disp[e.b][1] += (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const len = Math.hypot(disp[i][0], disp[i][1]);
      if (len < 1e-12) continue;
      const step = Math.min(len, temp);
      pos[i][0] = clamp(pos[i][0] + (disp[i][0] / len) * step, 0, width);
      pos[i][1] = clamp(pos[i][1] + (disp[i][1] / len) * step, 0, height);
    }
    temp = Math.max(0, temp - cool);
  }
  return pos;
}
