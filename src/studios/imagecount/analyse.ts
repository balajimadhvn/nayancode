/** Pure image-analysis pipeline shared by the Image tab, Results tab and tests. No DOM here. */
import { autoPolarity, fillHoles, filterBySize, gaussianBlur, label, otsu, toGrey, type Component } from './seg';
import { splitTouching } from './watershed';
import type { RgbaImage } from './demo';

export interface SourceImage extends RgbaImage { name: string; original?: { width: number; height: number } }

export interface ImageSettings {
  sigma: number;
  autoThreshold: boolean;
  threshold: number;
  polarity: 'auto' | 'light' | 'dark';
  minArea: number;
  maxArea: number;
  split: boolean;
  minDistance: number;
  fillHoles: boolean;
  roiEnabled: boolean;
  roiX: number;
  roiY: number;
  roiR: number;
  pxPerMm: number;
}

export const DEFAULT_SETTINGS: ImageSettings = {
  sigma: 1, autoThreshold: true, threshold: 128, polarity: 'auto',
  minArea: 20, maxArea: 500_000, split: false, minDistance: 5, fillHoles: true,
  roiEnabled: false, roiX: 0, roiY: 0, roiR: 0, pxPerMm: 0,
};

export interface Analysis {
  image: SourceImage;
  labels: Int32Array;
  components: Component[];
  /** Threshold on the processed (possibly inverted) grey image. */
  threshold: number;
  invert: boolean;
  settings: ImageSettings;
}

/** Components from an existing label image (used after watershed splitting). */
export function componentsFromLabels(labels: Int32Array, w: number, h: number): Component[] {
  const acc = new Map<number, { area: number; sx: number; sy: number; x0: number; y0: number; x1: number; y1: number }>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = labels[y * w + x];
    if (!id) continue;
    const s = acc.get(id);
    if (s) {
      s.area++; s.sx += x; s.sy += y;
      if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x;
      if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
    } else acc.set(id, { area: 1, sx: x, sy: y, x0: x, y0: y, x1: x, y1: y });
  }
  return [...acc.entries()].map(([id, s]) => ({
    id, area: s.area, cx: s.sx / s.area, cy: s.sy / s.area,
    bbox: { x: s.x0, y: s.y0, w: s.x1 - s.x0 + 1, h: s.y1 - s.y0 + 1 },
  }));
}

export function analyse(image: SourceImage, s: ImageSettings): Analysis {
  const { width: w, height: h } = image;
  const grey = gaussianBlur(toGrey(image.data), w, h, s.sigma);
  const invert = s.polarity === 'auto' ? autoPolarity(grey, w, h) : s.polarity === 'dark';
  const work = invert ? Float32Array.from(grey, (v) => 255 - v) : grey;
  const threshold = s.autoThreshold ? otsu(work) : s.threshold;

  let mask: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = work[i] > threshold ? 1 : 0;
  if (s.fillHoles) mask = fillHoles(mask, w, h);
  if (s.roiEnabled && s.roiR > 0) {
    const r2 = s.roiR * s.roiR;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((x - s.roiX) ** 2 + (y - s.roiY) ** 2 > r2) mask[y * w + x] = 0;
    }
  }

  let labels: Int32Array, components: Component[];
  if (s.split) {
    labels = splitTouching(mask, w, h, { minDistance: s.minDistance });
    components = componentsFromLabels(labels, w, h);
  } else {
    const r = label(mask, w, h); labels = r.labels; components = r.components;
  }
  const kept = filterBySize(components, s.minArea, s.maxArea);
  const keep = new Set(kept.map((c) => c.id));
  for (let i = 0; i < labels.length; i++) if (labels[i] && !keep.has(labels[i])) labels[i] = 0;
  return { image, labels, components: kept, threshold, invert, settings: s };
}
