import { parseNewick, type TreeNode } from '../studios/phylo/kernels';
/**
 * Publication-figure engine. A chart is described once as a Scene (rects, lines, circles, polygons, text, all in
 * points, 1 pt = 1/72 in) and rendered to SVG (editable <text>, no CSS variables), PDF (minimal vector writer with
 * the base-14 Helvetica fonts, no dependency) or PNG at any dpi. Pure functions apart from sceneToPng/cssTheme.
 */

// ---------------------------------------------------------------- types
export type Anchor = 'start' | 'middle' | 'end';
export type Item =
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; op?: number; id?: string }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; dash?: number[]; op?: number; id?: string }
  | { k: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number; op?: number }
  | { k: 'poly'; pts: [number, number][]; fill?: string; stroke?: string; sw?: number; op?: number; close?: boolean }
  | { k: 'text'; x: number; y: number; t: string; size: number; fill: string; anchor?: Anchor; bold?: boolean; rot?: number; id?: string };
export interface Scene { w: number; h: number; bg: string | null; items: Item[]; title?: string }

export interface Theme { bg: string | null; text: string; dim: string; grid: string; axis: string }
export const LIGHT: Theme = { bg: '#ffffff', text: '#111827', dim: '#374151', grid: '#d9dde4', axis: '#111827' };
export const DARK: Theme = { bg: '#0b1220', text: '#e9edf4', dim: '#b4bccb', grid: '#2a3446', axis: '#b4bccb' };

export interface FigureOptions {
  widthMm: number; heightMm: number; fontPt: number;
  palette: 'shown' | 'okabe';
  theme: 'page' | 'light' | 'dark';
  title: string; xLabel: string; yLabel: string;
  labelTopN: number;
  dpi: number;
}
export const DEFAULT_OPTIONS: FigureOptions = { widthMm: 114, heightMm: 80, fontPt: 8, palette: 'shown', theme: 'light', title: '', xLabel: '', yLabel: '', labelTopN: 0, dpi: 300 };
export const MM = 72 / 25.4;

/** Okabe–Ito colour-blind-safe palette; index 0 is neutral grey for the "background" category. */
export const OKABE = ['#999999', '#D55E00', '#0072B2', '#009E73', '#E69F00', '#56B4E9', '#CC79A7', '#F0E442'];
export const okabe = (i: number, skipGrey = false) => (skipGrey ? OKABE[1 + (i % 7)] : OKABE[i % 8]);
export const pickColor = (o: FigureOptions, shown: string, i: number, skipGrey = false) => (o.palette === 'okabe' ? okabe(i, skipGrey) : shown);

// ---------------------------------------------------------------- colour helpers
export function parseColor(c: string): { r: number; g: number; b: number; a: number } {
  const s = c.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? (parseFloat(x) / 100) : parseFloat(x))); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; }
  m = s.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map((x) => parseFloat(x)); const h = ((p[0] % 360) + 360) % 360, sat = p[1] / 100, l = p[2] / 100;
    const k = (n: number) => (n + h / 30) % 12, a = sat * Math.min(l, 1 - l), f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { r: Math.round(255 * f(0)), g: Math.round(255 * f(8)), b: Math.round(255 * f(4)), a: p[3] ?? 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}
const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
/** Normalises any CSS colour to #rrggbb plus an alpha (folded into opacity by the caller). */
export function norm(c: string | undefined): { hex: string; a: number } | null {
  if (!c || c === 'none') return null;
  const p = parseColor(c); return { hex: `#${hex2(p.r)}${hex2(p.g)}${hex2(p.b)}`, a: p.a };
}

export function cssTheme(): Theme {
  const v = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const solid = (c: string, fallback: string) => { const p = parseColor(c); return c && p.a >= 0.99 ? c : fallback; };
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  return { bg: v('--surface-solid') || v('--bg'), text: v('--text'), dim: v('--text-dim'), grid: solid(v('--border-hi'), dark ? DARK.grid : LIGHT.grid), axis: v('--text-dim') };
}
export const themeFor = (o: FigureOptions): Theme => (o.theme === 'light' ? LIGHT : o.theme === 'dark' ? DARK : cssTheme());

// ---------------------------------------------------------------- text metrics (Helvetica AFM widths, 1000/em)
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
export function textWidth(t: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of t) { const c = ch.codePointAt(0)!; w += c >= 32 && c <= 126 ? HELV[c - 32] : GREEK[ch] ? 600 : c === 0xb5 || c === 0xb0 || c === 0xd7 ? 556 : 556; }
  return (w / 1000) * size * (bold ? 1.06 : 1);
}

// ---------------------------------------------------------------- numeric helpers
export const nice = (lo: number, hi: number, n = 5) => {
  const span = hi - lo || 1, step = 10 ** Math.floor(Math.log10(span / n)), err = (n * step) / span;
  const s = step * (err <= 0.15 ? 10 : err <= 0.35 ? 5 : err <= 0.75 ? 2 : 1);
  const out: number[] = []; for (let v = Math.ceil(lo / s - 1e-9) * s; v <= hi + 1e-9; v += s) out.push(+v.toFixed(10)); return out;
};
export const fmtTick = (v: number) => (Math.abs(v) >= 1e6 || (Math.abs(v) > 0 && Math.abs(v) < 1e-3) ? v.toExponential(0).replace('e+', 'e') : String(+v.toPrecision(6)));

// ---------------------------------------------------------------- scene building blocks
export class Painter {
  items: Item[] = [];
  constructor(public w: number, public h: number, public th: Theme, public o: FigureOptions) {}
  rect(x: number, y: number, w: number, h: number, fill?: string, op?: number, stroke?: string, sw?: number, id?: string) { this.items.push({ k: 'rect', x, y, w, h, fill, stroke, sw, op, id }); }
  line(x1: number, y1: number, x2: number, y2: number, stroke: string, sw = 0.5, dash?: number[], op?: number, id?: string) { this.items.push({ k: 'line', x1, y1, x2, y2, stroke, sw, dash, op, id }); }
  circle(cx: number, cy: number, r: number, fill?: string, op?: number, stroke?: string, sw?: number) { this.items.push({ k: 'circle', cx, cy, r, fill, op, stroke, sw }); }
  poly(pts: [number, number][], o: { fill?: string; stroke?: string; sw?: number; op?: number; close?: boolean }) { this.items.push({ k: 'poly', pts, ...o }); }
  text(x: number, y: number, t: string, size: number, fill: string, anchor: Anchor = 'start', bold = false, rot = 0, id?: string) { if (t !== '') this.items.push({ k: 'text', x, y, t, size, fill, anchor, bold, rot, id }); }
  scene(title?: string): Scene { return { w: this.w, h: this.h, bg: this.th.bg, items: this.items, title }; }
  get fs() { return this.o.fontPt; }
}

export interface Frame { l: number; r: number; t: number; b: number; x0: number; x1: number; y0: number; y1: number; sx(v: number): number; sy(v: number): number; p: Painter }
export interface AxisSpec { x0: number; x1: number; y0: number; y1: number; xTicks?: { x: number; label: string }[]; yTicks?: number[]; xTickLabels?: (v: number) => string; yTickLabels?: (v: number) => string; noXTicks?: boolean; grid?: boolean; legend?: { name: string; color: string }[]; plotAspect?: number; rightPad?: number; xRot?: boolean }

/** Lays out margins from font metrics, draws title, grid, tick labels and axis labels, returns scale functions. */
export function drawFrame(p: Painter, ax: AxisSpec, labels: { title: string; x: string; y: string }): Frame {
  const fs = p.fs, th = p.th;
  const yTicks = ax.yTicks ?? nice(ax.y0, ax.y1), yl = ax.yTickLabels ?? fmtTick;
  const yw = Math.max(0, ...yTicks.map((t) => textWidth(yl(t), fs)));
  const xTicks = ax.xTicks ?? (ax.noXTicks ? [] : nice(ax.x0, ax.x1).map((x) => ({ x, label: (ax.xTickLabels ?? fmtTick)(x) })));
  const rot = ax.xRot ? Math.max(0, ...xTicks.map((t) => textWidth(t.label, fs))) * 0.72 + fs * 0.6 : 0;
  let legendH = 0; const legendRows: { name: string; color: string; x: number; row: number }[] = []; const availW = p.w - 12;
  if (ax.legend?.length) {
    let x = 0, row = 0; for (const e of ax.legend) { const w = fs * 1.4 + textWidth(e.name, fs) + fs * 1.2; if (x + w > availW && x > 0) { row++; x = 0; } legendRows.push({ ...e, x, row }); x += w; }
    legendH = (row + 1) * fs * 1.4 + 4;
  }
  const l = 6 + (labels.y ? fs * 1.3 + 3 : 0) + yw + 5, r = 8 + (ax.rightPad ?? 0);
  const t = 6 + (labels.title ? fs * 1.45 + 4 : 0);
  const b = 5 + (xTicks.length ? (ax.xRot ? rot : fs * 1.1) + 3 : 0) + (labels.x ? fs * 1.35 + 3 : 0) + legendH + 2;
  const pw = p.w - l - r;
  const sx = (v: number) => l + ((v - ax.x0) / (ax.x1 - ax.x0 || 1)) * pw, sy = (v: number) => p.h - b - ((v - ax.y0) / (ax.y1 - ax.y0 || 1)) * (p.h - t - b);
  if (labels.title) p.text(l, 6 + fs * 1.1, labels.title, fs * 1.15, th.text, 'start', true, 0, 'title');
  if (ax.grid !== false) for (const v of yTicks) p.line(l, sy(v), p.w - r, sy(v), th.grid, 0.4, undefined, 0.8);
  p.line(l, t, l, p.h - b, th.axis, 0.7); p.line(l, p.h - b, p.w - r, p.h - b, th.axis, 0.7);
  for (const v of yTicks) { p.line(l - 2.5, sy(v), l, sy(v), th.axis, 0.5); p.text(l - 4, sy(v) + fs * 0.35, yl(v), fs, th.dim, 'end'); }
  for (const tk of xTicks) {
    const x = sx(tk.x); p.line(x, p.h - b, x, p.h - b + 2.5, th.axis, 0.5);
    if (ax.xRot) p.text(x + 1, p.h - b + 4 + fs * 0.8, tk.label, fs, th.dim, 'end', false, -45); else p.text(x, p.h - b + 3 + fs * 0.95, tk.label, fs, th.dim, 'middle');
  }
  const midX = l + pw / 2, legTop = p.h - legendH;
  if (labels.x) p.text(midX, p.h - legendH - 4, labels.x, fs, th.text, 'middle', true, 0, 'x-label');
  if (labels.y) p.text(6 + fs * 0.95, t + (p.h - t - b) / 2, labels.y, fs, th.text, 'middle', true, -90, 'y-label');
  for (const e of legendRows) { const y = legTop + e.row * fs * 1.4 + 2, x = 6 + e.x; p.rect(x, y + fs * 0.1, fs * 0.8, fs * 0.8, e.color, 1); p.text(x + fs * 1.1, y + fs * 0.85, e.name, fs, th.dim); }
  return { l, r, t, b, x0: ax.x0, x1: ax.x1, y0: ax.y0, y1: ax.y1, sx, sy, p };
}

// ---------------------------------------------------------------- label collision avoidance
export interface LabelCand { x: number; y: number; text: string; score: number }
export interface PlacedLabel { x: number; y: number; ax: number; ay: number; text: string; anchor: Anchor; leader: boolean }
/**
 * Greedy placement of the top-N labels (by score): each tries 16 directions at growing radii around its point and takes
 * the first box that stays inside the plot and overlaps neither a placed label nor another candidate point.
 */
export function placeLabels(cands: LabelCand[], n: number, size: number, box: { x0: number; y0: number; x1: number; y1: number }, pointR = 2): PlacedLabel[] {
  const top = [...cands].sort((a, b) => b.score - a.score).slice(0, n);
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const pts = top.map((c) => ({ x0: c.x - pointR, y0: c.y - pointR, x1: c.x + pointR, y1: c.y + pointR }));
  const hit = (a: typeof box, b: typeof box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const out: PlacedLabel[] = [];
  for (const c of top) {
    const w = textWidth(c.text, size) + 1.5, h = size * 1.05; let done: PlacedLabel | null = null;
    for (let ring = 0; ring < 8 && !done; ring++) {
      const rad = pointR + 2 + ring * size * 0.9;
      for (let k = 0; k < 16 && !done; k++) {
        const ang = (k * Math.PI * 2) / 16 + (c.x > (box.x0 + box.x1) / 2 ? 0 : Math.PI / 16), dx = Math.cos(ang) * rad, dy = Math.sin(ang) * rad;
        const left = dx < -pointR * 0.5 ? c.x + dx - w : dx > pointR * 0.5 ? c.x + dx : c.x + dx - w / 2, bx = { x0: left, x1: left + w, y0: c.y + dy - h * 0.8, y1: c.y + dy + h * 0.25 };
        if (bx.x0 < box.x0 || bx.x1 > box.x1 || bx.y0 < box.y0 || bx.y1 > box.y1) continue;
        if (taken.some((t) => hit(bx, t)) || pts.some((q, i) => top[i] !== c && hit(bx, q))) continue;
        taken.push(bx); const anchor: Anchor = dx < -pointR * 0.5 ? 'end' : dx > pointR * 0.5 ? 'start' : 'middle';
        done = { x: anchor === 'end' ? bx.x1 - 0.75 : anchor === 'start' ? bx.x0 + 0.75 : (bx.x0 + bx.x1) / 2, y: c.y + dy, ax: c.x, ay: c.y, text: c.text, anchor, leader: ring > 0 };
      }
    }
    if (done) out.push(done);
  }
  return out;
}

// ---------------------------------------------------------------- chart builders
const baseScene = (o: FigureOptions) => new Painter(o.widthMm * MM, o.heightMm * MM, themeFor(o), o);
const orDefault = (v: string, d: string) => (v === '' ? d : v);

export interface ScatterSpec { points: { x: number; y: number; cat: number; label: string }[]; colors: string[]; names?: string[]; xLabel: string; yLabel: string; vlines?: number[]; hlines?: number[]; equalAspect?: boolean; xTicks?: { x: number; label: string }[]; labelScore?: (p: { x: number; y: number; cat: number; label: string }) => number }
export function buildScatter(s: ScatterSpec, o: FigureOptions): Scene {
  const p = baseScene(o), vl = s.vlines ?? [], hl = s.hlines ?? [];
  const xs = s.points.map((q) => q.x), ys = s.points.map((q) => q.y);
  let x0 = Math.min(...xs, ...vl), x1 = Math.max(...xs, ...vl), y0 = Math.min(...ys, ...hl), y1 = Math.max(...ys, ...hl);
  if (!s.points.length) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
  const px = (x1 - x0) * 0.05 || 1, py = (y1 - y0) * 0.06 || 1; x0 -= px; x1 += px; y0 -= py; y1 += py;
  if (s.equalAspect) { const m = Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; x0 = cx - m / 2; x1 = cx + m / 2; y0 = cy - m / 2; y1 = cy + m / 2; }
  const col = (i: number) => pickColor(o, s.colors[i] ?? s.colors[s.colors.length - 1] ?? '#888', i);
  const cats = [...new Set(s.points.map((q) => q.cat))].sort((a, b) => a - b);
  const legend = s.names?.map((n, i) => ({ name: n, color: col(i) }));
  const f = drawFrame(p, { x0, x1, y0, y1, xTicks: s.xTicks, legend,  }, { title: o.title, x: orDefault(o.xLabel, s.xLabel), y: orDefault(o.yLabel, s.yLabel) });
  const th = p.th;
  for (const v of vl) p.line(f.sx(v), f.t, f.sx(v), p.h - f.b, th.dim, 0.5, [3, 3]);
  for (const v of hl) p.line(f.l, f.sy(v), p.w - f.r, f.sy(v), th.dim, 0.5, [3, 3]);
  const rad = Math.max(0.9, o.fontPt * 0.2);
  for (const c of cats) for (const q of s.points) if (q.cat === c) p.circle(f.sx(q.x), f.sy(q.y), rad, col(c), c === 0 ? 0.5 : 0.9);
  if (o.labelTopN > 0 && s.labelScore) {
    const cand = s.points.filter((q) => q.cat !== 0).map((q) => ({ x: f.sx(q.x), y: f.sy(q.y), text: q.label, score: s.labelScore!(q) }));
    for (const lb of placeLabels(cand, o.labelTopN, o.fontPt * 0.9, { x0: f.l, y0: f.t, x1: p.w - f.r, y1: p.h - f.b }, rad)) {
      if (lb.leader) p.line(lb.ax, lb.ay, lb.anchor === 'middle' ? lb.x : lb.x + (lb.anchor === 'end' ? 0.5 : -0.5), lb.y - o.fontPt * 0.3, th.dim, 0.3);
      p.text(lb.x, lb.y, lb.text, o.fontPt * 0.9, th.text, lb.anchor, false, 0, 'gene-label');
    }
  }
  return p.scene(o.title);
}

export interface BarSpec { labels: string[]; values: number[]; colors: string[]; yLabel: string; fmt?: (v: number) => string; errors?: number[]; /** lower error-bar length when asymmetric (defaults to `errors`) */ errorsLo?: number[]; dots?: number[][]; xLabel?: string }
export function buildBars(s: BarSpec, o: FigureOptions): Scene {
  const p = baseScene(o), n = s.labels.length, th = p.th;
  const tops = s.values.map((v, i) => v + (s.errors?.[i] ?? 0)), all = [...tops, ...(s.dots?.flat() ?? [])];
  const lo = Math.min(0, ...s.values.map((v, i) => v - (s.errorsLo?.[i] ?? s.errors?.[i] ?? 0)), ...(s.dots?.flat() ?? []));
  const hi = Math.max(...all, 1e-9), ticks = nice(lo, hi, 5), y1 = Math.max(hi, ticks[ticks.length - 1]), y0 = Math.min(lo, ticks[0]);
  const fm = s.fmt ?? fmtTick;
  const f = drawFrame(p, { x0: 0, x1: n, y0, y1, yTicks: ticks, yTickLabels: fm, xTicks: s.labels.map((l, i) => ({ x: i + 0.5, label: l })), xRot: s.labels.some((l) => textWidth(l, o.fontPt) > ((p.w / Math.max(n, 1)) * 0.9)) }, { title: o.title, x: o.xLabel || s.xLabel || '', y: orDefault(o.yLabel, s.yLabel) });
  const bw = (f.sx(1) - f.sx(0)) * 0.7;
  s.values.forEach((v, i) => {
    const cx = f.sx(i + 0.5), fill = pickColor(o, s.colors[i % s.colors.length], i, true), ya = f.sy(Math.max(0, y0)), yb = f.sy(v);
    p.rect(cx - bw / 2, Math.min(ya, yb), bw, Math.abs(ya - yb), fill, 0.9, undefined, undefined, `bar-${i}`);
    const e = s.errors?.[i];
    if (e && Number.isFinite(e)) { const a = f.sy(v + e), b = f.sy(v - (s.errorsLo?.[i] ?? e)), cw = bw * 0.3; p.line(cx, a, cx, b, th.text, 0.7); p.line(cx - cw, a, cx + cw, a, th.text, 0.7); p.line(cx - cw, b, cx + cw, b, th.text, 0.7); }
    s.dots?.[i]?.forEach((d, k, arr) => p.circle(cx + ((k + 0.5) / arr.length - 0.5) * bw * 0.6, f.sy(d), Math.max(0.8, o.fontPt * 0.17), th.text, 0.85));
  });
  return p.scene(o.title);
}

export interface HeatSpec { rows: string[]; cols: string[]; z: number[][] }
export const heatColor = (v: number) => { const t = Math.max(-2, Math.min(2, v)) / 2; return t < 0 ? `rgb(${Math.round(30 + (1 + t) * 190)},${Math.round(110 + (1 + t) * 120)},${Math.round(230 + (1 + t) * 25)})` : `rgb(${Math.round(225 + t * 25)},${Math.round(225 - t * 140)},${Math.round(225 - t * 150)})`; };
export function buildHeatmap(s: HeatSpec, o: FigureOptions): Scene {
  const p = baseScene(o), fs = o.fontPt, th = p.th;
  const lw = Math.max(0, ...s.rows.map((r) => textWidth(r, fs * 0.9))) + 8, cl = Math.max(0, ...s.cols.map((c) => textWidth(c, fs * 0.9))) * 0.72 + 6;
  const top = 6 + (o.title ? fs * 1.5 + 4 : 0) + cl, left = 6 + lw, right = 10 + fs * 2.2, bottom = 8;
  if (o.title) p.text(6, 6 + fs * 1.1, o.title, fs * 1.15, th.text, 'start', true, 0, 'title');
  const cw = (p.w - left - right) / Math.max(1, s.cols.length), rh = (p.h - top - bottom) / Math.max(1, s.rows.length);
  s.z.forEach((row, i) => row.forEach((v, j) => p.rect(left + j * cw, top + i * rh, cw, rh, heatColor(v), 1)));
  const rf = Math.min(fs * 0.9, rh * 0.9);
  s.rows.forEach((r, i) => p.text(left - 4, top + (i + 0.5) * rh + rf * 0.35, r, rf, th.dim, 'end'));
  s.cols.forEach((c, j) => p.text(left + (j + 0.5) * cw, top - 3, c, Math.min(fs * 0.9, cw * 1.1), th.dim, 'start', false, -45));
  const bx = p.w - right + 4, bh = Math.min(p.h - top - bottom, 90), bw = fs * 0.8;
  for (let k = 0; k < 24; k++) p.rect(bx, top + (k * bh) / 24, bw, bh / 24 + 0.3, heatColor(2 - (k * 4) / 23), 1);
  p.text(bx + bw + 2, top + fs * 0.7, '+2', fs * 0.8, th.dim); p.text(bx + bw + 2, top + bh, '-2', fs * 0.8, th.dim);
  p.text(bx, top - 4, 'z', fs * 0.85, th.dim);
  return p.scene(o.title);
}

export interface LineSpec { xs: number[]; ys: number[]; xLabel: string; yLabel: string; yMin?: number; yMax?: number }
export function buildLine(s: LineSpec, o: FigureOptions): Scene {
  const p = baseScene(o), th = p.th, y0 = s.yMin ?? Math.min(...s.ys), y1 = s.yMax ?? Math.max(...s.ys), x0 = s.xs[0] ?? 0, x1 = s.xs[s.xs.length - 1] ?? 1;
  const f = drawFrame(p, { x0, x1, y0, y1: y1 === y0 ? y0 + 1 : y1 }, { title: o.title, x: orDefault(o.xLabel, s.xLabel), y: orDefault(o.yLabel, s.yLabel) });
  const c = pickColor(o, th === LIGHT ? '#2445c6' : '#8ea6ff', 2);
  p.poly(s.xs.map((x, i) => [f.sx(x), f.sy(s.ys[i])] as [number, number]), { stroke: c, sw: 1.1 });
  return p.scene(o.title);
}

export interface HistSpec { values: number[]; bins?: number; label: string; marker?: number }
export function buildHistogram(s: HistSpec, o: FigureOptions): Scene {
  const p = baseScene(o), th = p.th, v = s.values.filter(Number.isFinite), nb = s.bins ?? 30;
  const lo = Math.min(...v), hi = Math.max(...v), bw = (hi - lo || 1) / nb, counts = new Array<number>(nb).fill(0);
  for (const x of v) counts[Math.min(nb - 1, Math.floor((x - lo) / bw))]++;
  const mx = Math.max(1, ...counts), f = drawFrame(p, { x0: lo, x1: lo + bw * nb, y0: 0, y1: mx, grid: false }, { title: o.title, x: orDefault(o.xLabel, s.label), y: orDefault(o.yLabel, 'Count') });
  const c = pickColor(o, th === LIGHT ? '#2445c6' : '#8ea6ff', 2);
  counts.forEach((n, i) => p.rect(f.sx(lo + i * bw) + 0.3, f.sy(n), Math.max(0.5, f.sx(lo + (i + 1) * bw) - f.sx(lo + i * bw) - 0.6), f.sy(0) - f.sy(n), c, 0.9));
  if (s.marker !== undefined && s.marker >= lo && s.marker <= hi) p.line(f.sx(s.marker), f.t, f.sx(s.marker), p.h - f.b, th.dim, 0.6, [3, 2]);
  return p.scene(o.title);
}

/** Series chart with optional replicate points, error bars, fitted curve, band and vertical markers; linear or log x. */
export interface CurveSeries { name: string; color: string; points?: { x: number; y: number; err?: number }[]; curve?: { x: number; y: number }[]; band?: { x: number; lo: number; hi: number }[]; dashed?: boolean }
export interface CurveSpec { series: CurveSeries[]; xLabel: string; yLabel: string; logX?: boolean; logY?: boolean; vlines?: { x: number; label?: string; color?: string }[]; hlines?: number[]; yMin?: number; yMax?: number; xMin?: number; xMax?: number; legend?: boolean }
export function buildCurves(s: CurveSpec, o: FigureOptions): Scene {
  const p = baseScene(o), th = p.th;
  const T = (v: number, log?: boolean) => (log ? Math.log10(v) : v);
  const xsAll: number[] = [], ysAll: number[] = [];
  for (const q of s.series) {
    for (const pt of q.points ?? []) { xsAll.push(pt.x); ysAll.push(pt.y - (pt.err ?? 0), pt.y + (pt.err ?? 0)); }
    for (const pt of q.curve ?? []) { xsAll.push(pt.x); ysAll.push(pt.y); }
    for (const pt of q.band ?? []) { ysAll.push(pt.lo, pt.hi); }
  }
  const fx = xsAll.filter((x) => Number.isFinite(x) && (!s.logX || x > 0)), fy = ysAll.filter((y) => Number.isFinite(y) && (!s.logY || y > 0));
  let x0 = T(s.xMin ?? Math.min(...fx), s.logX), x1 = T(s.xMax ?? Math.max(...fx), s.logX), y0 = T(s.yMin ?? Math.min(...fy), s.logY), y1 = T(s.yMax ?? Math.max(...fy), s.logY);
  if (!fx.length) { x0 = 0; x1 = 1; } if (!fy.length) { y0 = 0; y1 = 1; }
  if (s.yMin === undefined) y0 -= (y1 - y0) * 0.04; if (s.yMax === undefined) y1 += (y1 - y0) * 0.04;
  const logTicks = (a: number, b: number) => { const out: { x: number; label: string }[] = []; for (let e = Math.ceil(a - 1e-9); e <= b + 1e-9; e++) out.push({ x: e, label: `10${sup(e)}` }); return out; };
  const xt = s.logX ? logTicks(x0, x1) : undefined;
  const yTicks = s.logY ? logTicks(y0, y1).map((t) => t.x) : undefined;
  const legend = s.legend === false || s.series.length < 2 ? undefined : s.series.map((q, i) => ({ name: q.name, color: pickColor(o, q.color, i, true) }));
  const f = drawFrame(p, { x0, x1, y0, y1, xTicks: xt?.length ? xt : undefined, yTicks, yTickLabels: s.logY ? (v) => `10${sup(v)}` : undefined, legend }, { title: o.title, x: orDefault(o.xLabel, s.xLabel), y: orDefault(o.yLabel, s.yLabel) });
  const X = (v: number) => f.sx(T(v, s.logX)), Y = (v: number) => f.sy(T(v, s.logY));
  for (const h of s.hlines ?? []) p.line(f.l, Y(h), p.w - f.r, Y(h), th.dim, 0.5, [3, 3]);
  s.series.forEach((q, i) => {
    const c = pickColor(o, q.color, i, true);
    if (q.band?.length) { const up = q.band.map((b) => [X(b.x), Y(b.hi)] as [number, number]), dn = q.band.map((b) => [X(b.x), Y(b.lo)] as [number, number]).reverse(); p.poly([...up, ...dn], { fill: c, op: 0.18, close: true }); }
    if (q.curve?.length) p.poly(q.curve.filter((d) => Number.isFinite(d.y) && (!s.logX || d.x > 0)).map((d) => [X(d.x), Y(d.y)] as [number, number]), { stroke: c, sw: 1.2 });
    for (const pt of q.points ?? []) {
      if (s.logX && pt.x <= 0) continue;
      if (pt.err) { p.line(X(pt.x), Y(pt.y - pt.err), X(pt.x), Y(pt.y + pt.err), c, 0.6); }
      p.circle(X(pt.x), Y(pt.y), Math.max(1, o.fontPt * 0.22), c, 0.95);
    }
  });
  for (const v of s.vlines ?? []) {
    if (s.logX && v.x <= 0) continue;
    const c = v.color ?? th.dim; p.line(X(v.x), f.t, X(v.x), p.h - f.b, c, 0.5, [3, 3]);
    if (v.label) p.text(X(v.x) + 2, f.t + o.fontPt * 0.9, v.label, o.fontPt * 0.85, th.dim);
  }
  return p.scene(o.title);
}
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (e: number) => (e < 0 ? '⁻' : '') + String(Math.abs(Math.round(e))).replace(/\d/g, (d) => SUP[+d]);


// ---------------------------------------------------------------- box plots
/** Tukey quartiles with linear interpolation (the default of numpy.percentile / R quantile type 7). */
export function tukeyQuartiles(values: number[]): { q1: number; median: number; q3: number; iqr: number; whiskerLo: number; whiskerHi: number; outliers: number[] } {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) throw new Error('A box plot needs at least one value.');
  const pct = (p: number) => { const k = (p / 100) * (v.length - 1), f = Math.floor(k), c = Math.min(v.length - 1, f + 1); return v[f] + (k - f) * (v[c] - v[f]); };
  const q1 = pct(25), median = pct(50), q3 = pct(75), iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  const inside = v.filter((x) => x >= lo && x <= hi);
  return { q1, median, q3, iqr, whiskerLo: inside.length ? inside[0] : q1, whiskerHi: inside.length ? inside[inside.length - 1] : q3, outliers: v.filter((x) => x < lo || x > hi) };
}

export interface BoxGroup { name: string; values: number[]; color: string }
export interface BoxSpec { groups: BoxGroup[]; xLabel: string; yLabel: string }
/** Box-and-whisker plot: Q1–Q3 box, median, 1.5×IQR whiskers, outliers as circles and jittered individual points. */
export function buildBoxPlot(s: BoxSpec, o: FigureOptions): Scene {
  const p = baseScene(o), th = p.th, n = s.groups.length;
  const stats = s.groups.map((g) => tukeyQuartiles(g.values));
  const all = s.groups.flatMap((g) => g.values);
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.06 || 1, ticks = nice(lo - pad, hi + pad, 5);
  const f = drawFrame(p, { x0: 0, x1: n, y0: Math.min(lo - pad, ticks[0]), y1: Math.max(hi + pad, ticks[ticks.length - 1]), xTicks: s.groups.map((g, i) => ({ x: i + 0.5, label: g.name })), xRot: s.groups.some((g) => textWidth(g.name, o.fontPt) > ((p.w / Math.max(n, 1)) * 0.9)) }, { title: o.title, x: orDefault(o.xLabel, s.xLabel), y: orDefault(o.yLabel, s.yLabel) });
  const bw = (f.sx(1) - f.sx(0)) * 0.55;
  s.groups.forEach((g, i) => {
    const st = stats[i], cx = f.sx(i + 0.5), c = pickColor(o, g.color, i, true);
    p.rect(cx - bw / 2, f.sy(st.q3), bw, Math.max(0.4, f.sy(st.q1) - f.sy(st.q3)), c, 0.55, th.text, 0.5, `box-${i}`);
    p.line(cx - bw / 2, f.sy(st.median), cx + bw / 2, f.sy(st.median), th.text, 0.9, undefined, undefined, `median-${i}`);
    if (st.whiskerHi > st.q3) p.line(cx, f.sy(st.q3), cx, f.sy(st.whiskerHi), th.text, 0.6);
    if (st.whiskerLo < st.q1) p.line(cx, f.sy(st.q1), cx, f.sy(st.whiskerLo), th.text, 0.6);
    p.line(cx - bw * 0.18, f.sy(st.whiskerHi), cx + bw * 0.18, f.sy(st.whiskerHi), th.text, 0.6, undefined, undefined, `whisker-hi-${i}`);
    p.line(cx - bw * 0.18, f.sy(st.whiskerLo), cx + bw * 0.18, f.sy(st.whiskerLo), th.text, 0.6, undefined, undefined, `whisker-lo-${i}`);
    st.outliers.forEach((v) => p.circle(cx, f.sy(v), Math.max(0.8, o.fontPt * 0.18), undefined, 1, th.text, 0.5));
    // Jittered observations (deterministic, so the same figure is reproducible).
    g.values.forEach((v, k) => { const j = ((Math.imul(k + 1 + i * 7919, 2654435761) >>> 8) / 16777216 - 0.5) * bw * 0.5; p.circle(cx + j, f.sy(v), Math.max(0.55, o.fontPt * 0.11), th.text, 0.55); });
  });
  return p.scene(o.title);
}

// ---------------------------------------------------------------- multiple sequence alignment
const AA_GROUP: [RegExp, string][] = [[/[AVILMFWY]/, '#4c72b0'], [/[KR]/, '#c44e52'], [/[DE]/, '#8c5a9a'], [/[STNQ]/, '#2f8f5b'], [/C/, '#d1607f'], [/[GP]/, '#d08a26'], [/H/, '#2a9d8f']];
const NT: Record<string, string> = { A: '#2f8f5b', C: '#4c72b0', G: '#d08a26', T: '#c44e52', U: '#c44e52', N: '#8a93a3' };
const residueColor = (ch: string, type: 'dna' | 'protein') => (type === 'dna' ? NT[ch.toUpperCase()] ?? '#8a93a3' : AA_GROUP.find(([re]) => re.test(ch.toUpperCase()))?.[1] ?? '#8a93a3');

export interface MsaSpec { names: string[]; seqs: string[]; type: 'dna' | 'protein'; blockWidth?: number }
/** Multiple-sequence-alignment figure: one coloured cell per residue, names on the left, wrapped into blocks with a ruler. */
export function buildMsa(s: MsaSpec, o: FigureOptions): Scene {
  const p = baseScene(o), th = p.th, cols = Math.max(...s.seqs.map((q) => q.length)), blockWidth = s.blockWidth ?? 60;
  if (!s.seqs.length || !cols) throw new Error('An alignment figure needs at least one non-empty sequence.');
  const left = Math.max(0, ...s.names.map((n) => textWidth(n, o.fontPt * 0.95))) + 8;
  const width = p.w - left - 10, nb = Math.ceil(cols / blockWidth), perBlock = Math.min(blockWidth, cols);
  const cw = width / perBlock, rows = s.seqs.length, blocks = Math.max(1, nb);
  const rulerH = o.fontPt * 1.5, gapH = o.fontPt * 0.9;
  const avail = p.h - 8 - rulerH * blocks - gapH * (blocks - 1);
  const rh = Math.max(o.fontPt * 0.6, Math.min(o.fontPt * 1.05, avail / rows));
  const fs = Math.min(o.fontPt * 0.95, cw * 1.1, rh * 0.95);
  if (o.title) p.text(6, 6 + o.fontPt * 1.1, o.title, o.fontPt * 1.15, th.text, 'start', true, 0, 'title');
  let y = 6 + (o.title ? o.fontPt * 1.6 : 0);
  s.names.forEach((n, i) => p.text(left - 4, y + i * rh + rh * 0.75, n, Math.min(fs, o.fontPt * 0.95), th.dim, 'end', false, 0, `msa-name-${i}`));
  for (let b = 0; b < blocks; b++) {
    const start = b * blockWidth;
    // Position ruler.
    const nums: number[] = [];
    for (let c = 0; c < perBlock; c++) { const col = start + c + 1; if (col === 1 || col % 10 === 0) nums.push(c); }
    if (!nums.length) nums.push(0);
    for (const c of nums) p.text(left + c * cw + cw / 2, y + rulerH * 0.72, String(start + c + 1), Math.min(fs * 0.85, o.fontPt * 0.85), th.dim, 'middle');
    const top = y + rulerH;
    s.seqs.forEach((seq, r) => {
      for (let c = 0; c < perBlock; c++) {
        const col = start + c; if (col >= cols) break;
        const ch = (seq[col] ?? '-').toUpperCase(), x = left + c * cw, yy = top + r * rh;
        p.rect(x, yy, cw - 0.2, rh - 0.2, residueColor(ch, s.type), 0.16);
        p.text(x + cw / 2, yy + rh * 0.76, ch, fs, residueColor(ch, s.type), 'middle', false, 0, `res-${r}-${col}`);
      }
    });
    y = top + rows * rh + gapH;
  }
  return p.scene(o.title);
}

// ---------------------------------------------------------------- phylogenetic trees
export interface TreeTip { name: string; depth: number; x: number; y: number }
export interface TreeLayout { tips: TreeTip[]; maxDepth: number; left: number; right: number; pxPerUnit: number }
export interface TreeSpec { newick: string; showSupport?: boolean; showScale?: boolean }

/** Tip positions of a rectangular phylogram: x is the cumulative branch length, tips are spread evenly down the page. */
export function treeLayout(newick: string, o: FigureOptions): TreeLayout {
  const tree = parseNewick(newick);
  const tips: { node: TreeNode; name: string; depth: number }[] = [];
  const walk = (node: TreeNode, depth: number) => {
    if (!node.children.length) { tips.push({ node, name: node.name ?? '', depth }); return; }
    for (const c of node.children) walk(c, depth + (c.length || 0));
  };
  walk(tree, tree.length || 0);
  const maxDepth = Math.max(1e-12, ...tips.map((t) => t.depth));
  const labelW = Math.max(0, ...tips.map((t) => textWidth(t.name, o.fontPt)));
  const left = 8, right = 12 + labelW;
  const plotW = o.widthMm * MM - left - right;
  const pxPerUnit = plotW / maxDepth;
  const top = 6 + (o.title ? o.fontPt * 1.6 : 0), bottom = p2Height(o) - (6 + 8);
  const step = (bottom - top) / Math.max(1, tips.length - 1 || 1);
  return { tips: tips.map((t, i) => ({ name: t.name, depth: t.depth, x: left + t.depth * pxPerUnit, y: tips.length === 1 ? (top + bottom) / 2 : top + i * step })), maxDepth, left, right, pxPerUnit };
}
const p2Height = (o: FigureOptions) => o.heightMm * MM;

/** Rectangular phylogram with tip labels, optional support values and a branch-length scale bar. */
export function buildTree(s: TreeSpec, o: FigureOptions): Scene {
  const p = baseScene(o), th = p.th, lay = treeLayout(s.newick, o);
  if (o.title) p.text(6, 6 + o.fontPt * 1.1, o.title, o.fontPt * 1.15, th.text, 'start', true, 0, 'title');
  const tree = parseNewick(s.newick);
  const ys = new Map<TreeNode, number>();
  lay.tips.forEach((t) => {
    const leaf = findLeaf(tree, t.name);
    if (leaf) ys.set(leaf, t.y);
  });
  const settle = (node: TreeNode): number => {
    if (!node.children.length) return ys.get(node) ?? 0;
    const cy = node.children.map(settle), v = (Math.min(...cy) + Math.max(...cy)) / 2;
    ys.set(node, v); return v;
  };
  const rootY = settle(tree);
  const xOf = new Map<TreeNode, number>();
  const place = (node: TreeNode, x: number) => {
    xOf.set(node, x);
    for (const c of node.children) place(c, x + (c.length || 0) * lay.pxPerUnit);
  };
  place(tree, lay.left);
  const draw = (node: TreeNode) => {
    const nx = xOf.get(node)!, ny = ys.get(node) ?? rootY;
    if (node.children.length) {
      const cy = node.children.map((c) => ys.get(c) ?? ny);
      p.line(nx, Math.min(...cy), nx, Math.max(...cy), th.dim, 0.7);
      for (const c of node.children) { const cx = xOf.get(c)!, ccy = ys.get(c) ?? ny; p.line(nx, ccy, cx, ccy, th.axis, 0.7); draw(c); }
      if (s.showSupport && node.support !== undefined) p.text(nx + 1, ny - o.fontPt * 0.45, String(Math.round(node.support)), o.fontPt * 0.8, th.dim, 'start', false, 0, `support-${Math.round(ny)}`);
    } else {
      p.circle(nx, ny, Math.max(0.6, o.fontPt * 0.13), th.dim, 1);
      p.text(nx + 3, ny + o.fontPt * 0.35, node.name ?? '', o.fontPt, th.text, 'start', false, 0, `tip-${node.name ?? ''}`);
    }
  };
  draw(tree);
  if (s.showScale !== false) {
    const unit = 10 ** Math.floor(Math.log10(lay.maxDepth / 4 || 1e-3)), len = unit * lay.pxPerUnit;
    const y = p.h - 6;
    p.line(lay.left, y, lay.left + len, y, th.axis, 0.8, undefined, undefined, 'scale-bar');
    p.text(lay.left, y - o.fontPt * 0.5, fmtTick(unit), o.fontPt * 0.85, th.dim, 'middle');
  }
  return p.scene(o.title);
}
function findLeaf(node: TreeNode, name: string): TreeNode | null {
  if (!node.children.length) return node.name === name ? node : null;
  for (const c of node.children) { const f = findLeaf(c, name); if (f) return f; }
  return null;
}

// ---------------------------------------------------------------- SVG
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v: number) => String(+v.toFixed(2));
export function sceneToSvg(sc: Scene): string {
  const wmm = +(sc.w / MM).toFixed(2), hmm = +(sc.h / MM).toFixed(2);
  const out: string[] = [`<?xml version="1.0" encoding="UTF-8"?>`, `<svg xmlns="http://www.w3.org/2000/svg" width="${wmm}mm" height="${hmm}mm" viewBox="0 0 ${n2(sc.w)} ${n2(sc.h)}" font-family="Helvetica, Arial, sans-serif">`];
  if (sc.title) out.push(`<title>${esc(sc.title)}</title>`);
  const bg = norm(sc.bg ?? undefined); if (bg) out.push(`<rect id="background" x="0" y="0" width="${n2(sc.w)}" height="${n2(sc.h)}" fill="${bg.hex}"/>`);
  const paint = (fill?: string, stroke?: string, sw?: number, op?: number) => {
    const f = norm(fill), s = norm(stroke); let a = f ? `fill="${f.hex}"` : 'fill="none"';
    if (s) a += ` stroke="${s.hex}" stroke-width="${n2(sw ?? 0.5)}"`;
    const o = (op ?? 1) * (f?.a ?? s?.a ?? 1); if (o < 1) a += ` opacity="${+o.toFixed(3)}"`; return a;
  };
  for (const it of sc.items) {
    if (it.k === 'rect') out.push(`<rect${it.id ? ` id="${it.id}"` : ''} x="${n2(it.x)}" y="${n2(it.y)}" width="${n2(it.w)}" height="${n2(it.h)}" ${paint(it.fill, it.stroke, it.sw, it.op)}/>`);
    else if (it.k === 'line') { const s = norm(it.stroke)!; out.push(`<line${it.id ? ` id="${it.id}"` : ''} x1="${n2(it.x1)}" y1="${n2(it.y1)}" x2="${n2(it.x2)}" y2="${n2(it.y2)}" stroke="${s.hex}" stroke-width="${n2(it.sw)}"${it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : ''}${(it.op ?? 1) * s.a < 1 ? ` opacity="${+((it.op ?? 1) * s.a).toFixed(3)}"` : ''}/>`); }
    else if (it.k === 'circle') out.push(`<circle cx="${n2(it.cx)}" cy="${n2(it.cy)}" r="${n2(it.r)}" ${paint(it.fill, it.stroke, it.sw, it.op)}/>`);
    else if (it.k === 'poly') { if (it.pts.length < 2) continue; out.push(`<${it.close ? 'polygon' : 'polyline'} points="${it.pts.map(([x, y]) => `${n2(x)},${n2(y)}`).join(' ')}" ${paint(it.fill, it.stroke, it.sw, it.op)} stroke-linejoin="round"/>`); }
    else { const c = norm(it.fill)!; out.push(`<text${it.id ? ` id="${it.id}"` : ''} x="${n2(it.x)}" y="${n2(it.y)}" font-size="${n2(it.size)}" fill="${c.hex}"${it.anchor && it.anchor !== 'start' ? ` text-anchor="${it.anchor}"` : ''}${it.bold ? ' font-weight="bold"' : ''}${it.rot ? ` transform="rotate(${it.rot} ${n2(it.x)} ${n2(it.y)})"` : ''}>${esc(it.t)}</text>`); }
  }
  out.push('</svg>');
  return out.join('\n');
}

// ---------------------------------------------------------------- PDF (single page, base-14 fonts, ASCII-only file)
const GREEK: Record<string, string> = { Δ: 'D', Σ: 'S', Γ: 'G', Ω: 'W', α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', λ: 'l', μ: 'm', π: 'p', ρ: 'r', σ: 's', τ: 't', χ: 'c', κ: 'k', θ: 'q', φ: 'f' };
const WIN: Record<string, number> = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80 };
const SUPER: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
const pdfEsc = (c: number) => (c === 0x28 || c === 0x29 || c === 0x5c ? '\\' + String.fromCharCode(c) : c >= 32 && c < 127 ? String.fromCharCode(c) : '\\' + c.toString(8).padStart(3, '0'));
/** Splits text into runs of {font, bytes}; Greek letters use the Symbol font, superscript digits are lowered to plain digits. */
function pdfRuns(t: string): { sym: boolean; sup?: boolean; s: string }[] {
  const runs: { sym: boolean; sup?: boolean; s: string }[] = [];
  const push = (sym: boolean, s: string, sup = false) => { const l = runs[runs.length - 1]; if (l && l.sym === sym && !!l.sup === sup) l.s += s; else runs.push({ sym, s, sup }); };
  for (const ch of t) {
    if (GREEK[ch]) push(true, GREEK[ch]);
    else if (ch === '−') push(false, '-');
    else if (ch === '≥') push(false, '>=');
    else if (ch === '≤') push(false, '<=');
    else if (SUPER[ch]) push(false, SUPER[ch], true);
    else { const c = ch.codePointAt(0)!; push(false, c < 256 ? ch : WIN[ch] ? String.fromCharCode(WIN[ch]) : '?'); }
  }
  return runs;
}
const num = (v: number) => String(+v.toFixed(3));
export function sceneToPdf(sc: Scene): string {
  const H = sc.h, Y = (y: number) => H - y;
  const alphas = new Map<number, string>();
  const gs = (a: number) => { const k = Math.round(a * 1000) / 1000; if (!alphas.has(k)) alphas.set(k, `G${alphas.size}`); return alphas.get(k)!; };
  const rgb = (c: { hex: string }, stroke = false) => { const r = parseInt(c.hex.slice(1, 3), 16) / 255, g = parseInt(c.hex.slice(3, 5), 16) / 255, b = parseInt(c.hex.slice(5, 7), 16) / 255; return `${num(r)} ${num(g)} ${num(b)} ${stroke ? 'RG' : 'rg'}`; };
  const c: string[] = [];
  const bg = norm(sc.bg ?? undefined); if (bg) c.push(`${rgb(bg)} 0 0 ${num(sc.w)} ${num(sc.h)} re f`);
  const shape = (path: string, fill?: string, stroke?: string, sw = 0.5, op = 1, dash?: number[]) => {
    const f = norm(fill), s = norm(stroke); if (!f && !s) return;
    const a = op * (f?.a ?? s?.a ?? 1); c.push('q'); if (a < 1) c.push(`/${gs(a)} gs`);
    if (f) c.push(rgb(f)); if (s) { c.push(rgb(s, true), `${num(sw)} w`); }
    if (dash) c.push(`[${dash.join(' ')}] 0 d`);
    c.push(path + (f && s ? ' B' : f ? ' f' : ' S')); c.push('Q');
  };
  const K = 0.5523;
  for (const it of sc.items) {
    if (it.k === 'rect') shape(`${num(it.x)} ${num(Y(it.y + it.h))} ${num(it.w)} ${num(it.h)} re`, it.fill, it.stroke, it.sw, it.op);
    else if (it.k === 'line') shape(`${num(it.x1)} ${num(Y(it.y1))} m ${num(it.x2)} ${num(Y(it.y2))} l`, undefined, it.stroke, it.sw, it.op, it.dash);
    else if (it.k === 'circle') {
      const { cx, r } = it, cy = Y(it.cy), k = r * K;
      shape(`${num(cx + r)} ${num(cy)} m ${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c ${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c ${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c ${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c h`, it.fill, it.stroke, it.sw, it.op);
    } else if (it.k === 'poly') {
      if (it.pts.length < 2) continue;
      shape(it.pts.map(([x, y], i) => `${num(x)} ${num(Y(y))} ${i ? 'l' : 'm'}`).join(' ') + (it.close ? ' h' : ''), it.fill, it.stroke, it.sw, it.op);
    } else {
      const col = norm(it.fill)!, runs = pdfRuns(it.t), bold = !!it.bold;
      const wOf = (r: { sym: boolean; sup?: boolean; s: string }) => (r.sym ? r.s.length * 0.6 * it.size : textWidth(r.s, r.sup ? it.size * 0.7 : it.size, bold));
      const total = runs.reduce((a, r) => a + wOf(r), 0), start = it.anchor === 'middle' ? -total / 2 : it.anchor === 'end' ? -total : 0;
      const th = (-(it.rot ?? 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
      let off = start; c.push('q', rgb(col)); if (col.a < 1) c.push(`/${gs(col.a)} gs`);
      for (const r of runs) {
        const bytes = [...r.s].map((ch) => pdfEsc(ch.charCodeAt(0))).join(''), px = it.x + cs * off, py = Y(it.y) + sn * off;
        c.push(`BT /${r.sym ? 'F3' : bold ? 'F2' : 'F1'} ${num(r.sup ? it.size * 0.7 : it.size)} Tf ${r.sup ? num(it.size * 0.35) : 0} Ts ${num(cs)} ${num(sn)} ${num(-sn)} ${num(cs)} ${num(px)} ${num(py)} Tm (${bytes}) Tj ET`);
        off += wOf(r);
      }
      c.push('Q');
    }
  }
  const stream = c.join('\n');
  const gsDict = [...alphas].map(([a, n]) => `/${n} << /ca ${a} /CA ${a} >>`).join(' ');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(sc.w)} ${num(sc.h)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> /ExtGState << ${gsDict} >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>',
  ];
  let pdf = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${sc.title ? '' : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

// ---------------------------------------------------------------- PNG (draws the scene on a canvas)
export function drawScene(g: CanvasRenderingContext2D, sc: Scene, scale = 1) {
  g.save(); g.scale(scale, scale);
  const bg = norm(sc.bg ?? undefined); if (bg) { g.fillStyle = bg.hex; g.fillRect(0, 0, sc.w, sc.h); }
  const apply = (fill?: string, stroke?: string, sw?: number, op?: number, path?: () => void) => {
    const f = norm(fill), s = norm(stroke);
    if (f) { g.globalAlpha = (op ?? 1) * f.a; g.fillStyle = f.hex; path?.(); g.fill(); }
    if (s) { g.globalAlpha = (op ?? 1) * s.a; g.strokeStyle = s.hex; g.lineWidth = sw ?? 0.5; path?.(); g.stroke(); }
    g.globalAlpha = 1;
  };
  for (const it of sc.items) {
    if (it.k === 'rect') apply(it.fill, it.stroke, it.sw, it.op, () => { g.beginPath(); g.rect(it.x, it.y, it.w, it.h); });
    else if (it.k === 'line') { const s = norm(it.stroke)!; g.globalAlpha = (it.op ?? 1) * s.a; g.strokeStyle = s.hex; g.lineWidth = it.sw; g.setLineDash(it.dash ?? []); g.beginPath(); g.moveTo(it.x1, it.y1); g.lineTo(it.x2, it.y2); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
    else if (it.k === 'circle') apply(it.fill, it.stroke, it.sw, it.op, () => { g.beginPath(); g.arc(it.cx, it.cy, it.r, 0, Math.PI * 2); });
    else if (it.k === 'poly') apply(it.fill, it.stroke, it.sw, it.op, () => { g.beginPath(); it.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (it.close) g.closePath(); });
    else { const c = norm(it.fill)!; g.save(); g.translate(it.x, it.y); if (it.rot) g.rotate((it.rot * Math.PI) / 180); g.fillStyle = c.hex; g.font = `${it.bold ? 'bold ' : ''}${it.size}px Helvetica, Arial, sans-serif`; g.textAlign = it.anchor === 'middle' ? 'center' : it.anchor === 'end' ? 'right' : 'left'; g.textBaseline = 'alphabetic'; g.fillText(it.t, 0, 0); g.restore(); }
  }
  g.restore();
}
export async function sceneToPng(sc: Scene, dpi: number): Promise<Blob> {
  const scale = dpi / 72, cv = document.createElement('canvas');
  cv.width = Math.round(sc.w * scale); cv.height = Math.round(sc.h * scale);
  drawScene(cv.getContext('2d')!, sc, scale);
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
}
