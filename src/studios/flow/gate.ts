/** Rect, polygon and ellipse gates in transformed coordinates; gate-tree statistics on raw values. */

export type Gate =
  | { type: 'rect'; x: string; y: string; xmin: number; xmax: number; ymin: number; ymax: number }
  | { type: 'polygon'; x: string; y: string; points: [number, number][] }
  | { type: 'ellipse'; x: string; y: string; cx: number; cy: number; rx: number; ry: number; angle: number };

export type GateColumns = Record<string, ArrayLike<number>>;
export interface GateNode { id: string; name: string; gate: Gate; parent: string | null }
export interface ChannelStat { median: number; mean: number; cv: number }
export interface GateStat {
  id: string; name: string; type: Gate['type']; parent: string | null;
  count: number; parentCount: number; percentParent: number; percentTotal: number;
  channels: Record<string, ChannelStat>;
}

function inPolygon(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inGate(gate: Gate, x: number, y: number): boolean {
  if (gate.type === 'rect') return x >= gate.xmin && x <= gate.xmax && y >= gate.ymin && y <= gate.ymax;
  if (gate.type === 'polygon') return inPolygon(x, y, gate.points);
  const a = (gate.angle * Math.PI) / 180, dx = x - gate.cx, dy = y - gate.cy;
  const rx = dx * Math.cos(a) + dy * Math.sin(a), ry = -dx * Math.sin(a) + dy * Math.cos(a);
  return (rx / gate.rx) ** 2 + (ry / gate.ry) ** 2 <= 1;
}

/** Parent mask AND the new gate. Masks are 1 for included events, 0 otherwise. */
export function applyGate(mask: Uint8Array | null, columns: GateColumns, gate: Gate): Uint8Array {
  const xs = columns[gate.x], ys = columns[gate.y];
  if (!xs || !ys) throw new Error(`The gate refers to a missing parameter (${gate.x} or ${gate.y}).`);
  if (xs.length !== ys.length) throw new Error('The gate axes have different event counts.');
  if (mask && mask.length !== xs.length) throw new Error('The parent gate mask has a different event count.');
  const out = new Uint8Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    if (mask && !mask[i]) continue;
    out[i] = inGate(gate, xs[i], ys[i]) ? 1 : 0;
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function stat(values: number[]): ChannelStat {
  if (!values.length) return { median: 0, mean: 0, cv: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = values.length > 1 ? Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1)) : 0;
  return { median: median(values), mean, cv: mean === 0 ? 0 : (100 * sd) / mean };
}

/**
 * Counts and per-channel statistics for every gate, honouring parent gates. Masks are built from
 * the transformed columns; median/mean/CV are computed on the raw (untransformed) columns.
 */
export function gateStats(nodes: GateNode[], transformed: GateColumns, raw: GateColumns, channels: string[]): GateStat[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const total = nodes.length ? transformed[nodes[0].gate.x]?.length ?? 0 : 0;
  const masks = new Map<string, Uint8Array>();
  const building = new Set<string>();
  const maskOf = (node: GateNode): Uint8Array => {
    const cached = masks.get(node.id);
    if (cached) return cached;
    if (building.has(node.id)) throw new Error('The gate tree contains a cycle.');
    building.add(node.id);
    const parent = node.parent ? byId.get(node.parent) : undefined;
    if (node.parent && !parent) throw new Error(`The parent gate ${node.parent} was not found.`);
    const mask = applyGate(parent ? maskOf(parent) : null, transformed, node.gate);
    building.delete(node.id);
    masks.set(node.id, mask);
    return mask;
  };
  return nodes.map((node) => {
    const mask = maskOf(node);
    const count = mask.reduce((a, b) => a + b, 0);
    const parentCount = node.parent ? maskOf(byId.get(node.parent)!).reduce((a, b) => a + b, 0) : total;
    const channelStats: Record<string, ChannelStat> = {};
    for (const ch of channels) {
      const col = raw[ch];
      if (!col) continue;
      const vals: number[] = [];
      for (let i = 0; i < mask.length; i++) if (mask[i]) vals.push(col[i]);
      channelStats[ch] = stat(vals);
    }
    return {
      id: node.id, name: node.name, type: node.gate.type, parent: node.parent, count, parentCount,
      percentParent: parentCount ? (100 * count) / parentCount : 0,
      percentTotal: total ? (100 * count) / total : 0,
      channels: channelStats,
    };
  });
}
