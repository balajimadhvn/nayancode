/** Marker-controlled watershed for splitting touching objects. */
import { gaussianBlur, label } from './seg';

/** Exact squared Euclidean distance transform (Felzenszwalb–Huttenlocher), one dimension. */
function dt1d(f: Float64Array): Float64Array {
  const n = f.length, d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
  return d;
}

/** Distance from each foreground pixel to the nearest background pixel. */
export function distanceTransform(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const f = new Float64Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = mask[i] ? INF : 0;
  const row = new Float64Array(Math.max(w, h));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = f[y * w + x];
    const d = dt1d(row.subarray(0, w));
    for (let x = 0; x < w; x++) f[y * w + x] = d[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) row[y] = f[y * w + x];
    const d = dt1d(row.subarray(0, h));
    for (let y = 0; y < h; y++) f[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? Math.sqrt(f[i]) : 0;
  return out;
}

class MaxHeap {
  private idx: number[] = [];
  private pri: number[] = [];
  get size() { return this.idx.length; }
  push(i: number, p: number) {
    this.idx.push(i); this.pri.push(p);
    let c = this.idx.length - 1;
    while (c > 0) {
      const parent = (c - 1) >> 1;
      if (this.pri[parent] >= this.pri[c]) break;
      this.swap(parent, c); c = parent;
    }
  }
  pop(): number {
    const top = this.idx[0], li = this.idx.pop()!, lp = this.pri.pop()!;
    if (this.idx.length) {
      this.idx[0] = li; this.pri[0] = lp;
      let c = 0;
      for (;;) {
        const a = c * 2 + 1, b = a + 1;
        let m = c;
        if (a < this.idx.length && this.pri[a] > this.pri[m]) m = a;
        if (b < this.idx.length && this.pri[b] > this.pri[m]) m = b;
        if (m === c) break;
        this.swap(m, c); c = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.idx[a], this.idx[b]] = [this.idx[b], this.idx[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
  }
}

export interface SplitOptions { minDistance?: number; h?: number }

/**
 * Split touching foreground objects. Markers are local maxima of the blurred distance transform at
 * least minDistance apart; a priority flood then assigns every foreground pixel to the basin that
 * reaches it first. If no marker survives, the connected components are returned unchanged.
 */
export function splitTouching(mask: Uint8Array, w: number, h: number, opts: SplitOptions = {}): Int32Array {
  const minDistance = opts.minDistance ?? 5;
  let hasBackground = false;
  for (let i = 0; i < mask.length; i++) if (!mask[i]) { hasBackground = true; break; }
  if (!hasBackground) return label(mask, w, h).labels;
  const dist = distanceTransform(mask, w, h);
  const smooth = gaussianBlur(dist, w, h, opts.h ?? 1);

  const candidates: { i: number; v: number }[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i] || smooth[i] < minDistance) continue;
      const v = smooth[i];
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (smooth[(y + dy) * w + x + dx] > v) { isMax = false; break; }
      }
      if (isMax) candidates.push({ i, v });
    }
  }
  candidates.sort((a, b) => b.v - a.v || (a.i % w) - (b.i % w) || Math.floor(a.i / w) - Math.floor(b.i / w));

  const markers: { i: number; v: number }[] = [];
  const min2 = minDistance * minDistance;
  for (const c of candidates) {
    if (markers.every((m) => {
      const dx = (c.i % w) - (m.i % w), dy = Math.floor(c.i / w) - Math.floor(m.i / w);
      return dx * dx + dy * dy >= min2;
    })) markers.push(c);
  }
  if (!markers.length) return label(mask, w, h).labels;

  const labels = new Int32Array(w * h);
  const heap = new MaxHeap();
  markers.forEach((m, k) => { labels[m.i] = k + 1; heap.push(m.i, dist[m.i]); });
  while (heap.size) {
    const i = heap.pop(), lab = labels[i], x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!mask[j] || labels[j]) continue;
      labels[j] = lab; heap.push(j, dist[j]);
    }
  }
  return labels;
}
