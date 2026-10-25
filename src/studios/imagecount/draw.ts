/** Canvas overlay drawing for the image counter (DOM helper, not a kernel). */
import type { Analysis } from './analyse';

/** Draw the source image, foreground outlines and numbered centroid markers at full working resolution. */
export function drawAnnotated(canvas: HTMLCanvasElement, a: Analysis, numbers = true): void {
  const { width: w, height: h } = a.image;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(a.image.data), w, h), 0, 0);

  const outline = ctx.createImageData(w, h);
  const out = outline.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, id = a.labels[i];
    if (!id) continue;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
      a.labels[i - 1] !== id || a.labels[i + 1] !== id || a.labels[i - w] !== id || a.labels[i + w] !== id;
    if (!edge) continue;
    const j = i * 4;
    out[j] = 255; out[j + 1] = 55; out[j + 2] = 55; out[j + 3] = 235;
  }
  const layer = document.createElement('canvas');
  layer.width = w; layer.height = h;
  layer.getContext('2d')?.putImageData(outline, 0, 0);
  ctx.drawImage(layer, 0, 0);

  if (!numbers || !a.components.length) return;
  const font = Math.max(10, Math.min(22, Math.min(w, h) / 55));
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, font / 5); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#ffffff';
  const show = a.components.length <= 2000 ? a.components : a.components.slice(0, 2000);
  for (const c of show) { ctx.strokeText(String(c.id), c.cx, c.cy); ctx.fillText(String(c.id), c.cx, c.cy); }
}
