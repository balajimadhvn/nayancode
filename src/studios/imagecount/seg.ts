/** Image segmentation kernels: grey conversion, blur, Otsu threshold, polarity, labelling, hole filling. */

export interface Bbox { x: number; y: number; w: number; h: number }
export interface Component { id: number; area: number; cx: number; cy: number; bbox: Bbox }

/** Luminance 0.299 R + 0.587 G + 0.114 B. */
export function toGrey(rgba: Uint8ClampedArray): Float32Array {
  const n = Math.floor(rgba.length / 4);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  }
  return out;
}

/** Separable Gaussian blur with a ceil(3 sigma) radius and clamped edges. */
export function gaussianBlur(grey: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (!(sigma > 0) || w <= 0 || h <= 0) return grey;
  const radius = Math.ceil(3 * sigma);
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = v; total += v;
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= total;
  const temp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += kernel[k + radius] * grey[row + Math.max(0, Math.min(w - 1, x + k))];
      temp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += kernel[k + radius] * temp[Math.max(0, Math.min(h - 1, y + k)) * w + x];
      out[y * w + x] = s;
    }
  }
  return out;
}

/** Otsu threshold t; foreground pixels are those strictly greater than t. Ties keep the lowest t. */
export function otsu(grey: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < grey.length; i++) hist[Math.max(0, Math.min(255, Math.round(grey[i])))]++;
  const total = grey.length;
  if (!total) return 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = -1, bestT = 0;
  for (let t = 0; t < 255; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > best) { best = variance; bestT = t; }
  }
  return bestT;
}

/** True when the outer 10 % border is brighter than the image, i.e. objects are dark and should be inverted. */
export function autoPolarity(grey: Float32Array, w: number, h: number): boolean {
  if (!w || !h) return false;
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.1));
  let borderSum = 0, borderN = 0, allSum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = grey[y * w + x];
      allSum += v;
      if (x < band || x >= w - band || y < band || y >= h - band) { borderSum += v; borderN++; }
    }
  }
  return borderN > 0 && borderSum / borderN > allSum / (w * h);
}

/** 8-connected two-pass labelling with union-find. Labels are compacted to 1..N; background is 0. */
export function label(mask: Uint8Array, w: number, h: number): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(w * h);
  const parent: number[] = [0];
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) { const next = parent[a]; parent[a] = r; a = next; }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const neighbours: number[] = [];
      if (x > 0 && mask[i - 1]) neighbours.push(labels[i - 1]);
      if (y > 0) {
        if (x > 0 && mask[i - w - 1]) neighbours.push(labels[i - w - 1]);
        if (mask[i - w]) neighbours.push(labels[i - w]);
        if (x < w - 1 && mask[i - w + 1]) neighbours.push(labels[i - w + 1]);
      }
      if (!neighbours.length) { labels[i] = next; parent[next] = next; next++; }
      else {
        let min = neighbours[0];
        for (const n of neighbours) if (n < min) min = n;
        labels[i] = min;
        for (const n of neighbours) union(min, n);
      }
    }
  }

  const ids = new Map<number, number>();
  const sums = new Map<number, { area: number; sx: number; sy: number; x0: number; y0: number; x1: number; y1: number }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const root = find(labels[i]);
      let id = ids.get(root);
      if (id === undefined) { id = ids.size + 1; ids.set(root, id); }
      labels[i] = id;
      const s = sums.get(id);
      if (s) {
        s.area++; s.sx += x; s.sy += y;
        if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x;
        if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
      } else sums.set(id, { area: 1, sx: x, sy: y, x0: x, y0: y, x1: x, y1: y });
    }
  }
  const components: Component[] = [];
  for (let id = 1; id <= ids.size; id++) {
    const s = sums.get(id)!;
    components.push({ id, area: s.area, cx: s.sx / s.area, cy: s.sy / s.area, bbox: { x: s.x0, y: s.y0, w: s.x1 - s.x0 + 1, h: s.y1 - s.y0 + 1 } });
  }
  return { labels, components };
}

export function filterBySize(components: Component[], minArea: number, maxArea: number): Component[] {
  return components.filter((c) => c.area >= minArea && c.area <= maxArea);
}

/** Fill enclosed background regions: flood the background from the border; anything unreached is foreground. */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const i = stack.pop()!, x = i % w, y = (i - x) / w;
    seed(x - 1, y); seed(x + 1, y); seed(x, y - 1); seed(x, y + 1);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] || !outside[i] ? 1 : 0;
  return out;
}
