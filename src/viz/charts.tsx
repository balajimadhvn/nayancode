import { useEffect, useRef, useState } from 'react';
import { ExportBar } from './FigureExport';
import { buildBars, buildBoxPlot, buildCurves, buildHeatmap, buildHistogram, buildLine, buildScatter, drawScene, tukeyQuartiles, type CurveSpec, type FigureOptions } from './figure';

export const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Canvas host: handles DPR, resize and theme changes, then calls draw(). */
export function useCanvas(height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(el);
    const mo = new MutationObserver(() => setTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.clientWidth, dpr = window.devicePixelRatio || 1;
    el.width = Math.round(w * dpr); el.height = Math.round(height * dpr);
    const g = el.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, height);
    draw(g, w, height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, height, ...deps]);
  return ref;
}

const nice = (lo: number, hi: number, n = 5) => {
  const span = hi - lo || 1, step = 10 ** Math.floor(Math.log10(span / n)), err = (n * step) / span;
  const s = step * (err <= 0.15 ? 10 : err <= 0.35 ? 5 : err <= 0.75 ? 2 : 1);
  const out: number[] = []; for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(+v.toFixed(10)); return out;
};

export interface Pt { x: number; y: number; cat: number; label: string }
export function Scatter({ points, colors, names, xLabel, yLabel, height = 360, vlines = [], hlines = [], onHover, radius = 2.6, equalAspect = false, xTicks, labelScore, labelDefault = 0, exportName = 'scatter' }: {
  labelScore?: (p: Pt) => number; labelDefault?: number; exportName?: string;
  points: Pt[]; colors: string[]; names?: string[]; xLabel: string; yLabel: string; height?: number; vlines?: number[]; hlines?: number[]; onHover?: (p: Pt | null) => void; radius?: number; equalAspect?: boolean; xTicks?: { x: number; label: string }[];
}) {
  const [tip, setTip] = useState<{ x: number; y: number; p: Pt } | null>(null);
  const geo = useRef<{ sx(v: number): number; sy(v: number): number; m: { l: number; r: number; t: number; b: number } }>({ sx: () => 0, sy: () => 0, m: { l: 52, r: 14, t: 12, b: 40 } });
  const ref = useCanvas(height, (g, w, h) => {
    const m = geo.current.m, text = cssVar('--text-faint'), border = cssVar('--border');
    let xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    if (!xs.length) return;
    let x0 = Math.min(...xs, ...vlines), x1 = Math.max(...xs, ...vlines), y0 = Math.min(...ys, ...hlines), y1 = Math.max(...ys, ...hlines);
    const px = (x1 - x0) * 0.05 || 1, py = (y1 - y0) * 0.06 || 1; x0 -= px; x1 += px; y0 -= py; y1 += py;
    if (equalAspect) { const s = Math.max(x1 - x0, y1 - y0); const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; x0 = cx - s / 2; x1 = cx + s / 2; y0 = cy - s / 2; y1 = cy + s / 2; }
    const sx = (v: number) => m.l + ((v - x0) / (x1 - x0)) * (w - m.l - m.r), sy = (v: number) => h - m.b - ((v - y0) / (y1 - y0)) * (h - m.t - m.b);
    geo.current.sx = sx; geo.current.sy = sy;
    g.font = '11px ' + cssVar('--mono'); g.fillStyle = text; g.strokeStyle = border; g.lineWidth = 1;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const t of nice(y0, y1)) { const y = sy(t); g.beginPath(); g.moveTo(m.l, y); g.lineTo(w - m.r, y); g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1; g.fillText(String(t), m.l - 8, y); }
    g.textAlign = 'center'; g.textBaseline = 'top';
    if (xTicks) { for (const t of xTicks) { const x = sx(t.x); g.fillText(t.label, x, h - m.b + 7); } }
    else for (const t of nice(x0, x1)) { const x = sx(t); g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, h - m.b); g.globalAlpha = 0.25; g.stroke(); g.globalAlpha = 1; g.fillText(String(t), x, h - m.b + 7); }
    g.setLineDash([4, 4]); g.strokeStyle = cssVar('--border-hi');
    for (const v of vlines) { g.beginPath(); g.moveTo(sx(v), m.t); g.lineTo(sx(v), h - m.b); g.stroke(); }
    for (const v of hlines) { g.beginPath(); g.moveTo(m.l, sy(v)); g.lineTo(w - m.r, sy(v)); g.stroke(); }
    g.setLineDash([]);
    const order = [...points].sort((a, b) => b.cat - a.cat); // draw highlighted categories last (cat 0 = background)
    for (const cat of [...new Set(order.map((p) => p.cat))].sort((a, b) => a - b)) {
      g.fillStyle = colors[cat]; g.globalAlpha = cat === 0 ? 0.45 : 0.9;
      g.beginPath(); for (const p of points) if (p.cat === cat) { const x = sx(p.x), y = sy(p.y); g.moveTo(x + radius, y); g.arc(x, y, radius, 0, 6.2832); } g.fill();
    }
    g.globalAlpha = 1; g.fillStyle = cssVar('--text-dim'); g.font = '600 11.5px ' + cssVar('--font');
    g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(xLabel, (w + m.l - m.r) / 2, h - 2);
    g.save(); g.translate(12, (h + m.t - m.b) / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'top'; g.fillText(yLabel, 0, 0); g.restore();
  }, [points, colors, xLabel, yLabel, vlines.join(), hlines.join(), equalAspect, xTicks]);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current!, r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best: Pt | null = null, bd = (radius + 6) ** 2;
    for (const p of points) { const dx = geo.current.sx(p.x) - mx, dy = geo.current.sy(p.y) - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = p; } }
    setTip(best ? { x: mx, y: my, p: best } : null); onHover?.(best);
  };
  return (
    <div className="chart">
      <canvas ref={ref} style={{ height }} onMouseMove={onMove} onMouseLeave={() => { setTip(null); onHover?.(null); }} />
      {tip && <div className="chart-tip" style={{ left: tip.x, top: tip.y }}><b>{tip.p.label}</b><div className="faint mono">{xLabel.split(' ')[0]} {tip.p.x.toFixed(3)} · {yLabel.split(' ')[0]} {tip.p.y.toFixed(3)}</div></div>}
      {names && <div className="legend">{names.map((n, i) => <span key={n}><i style={{ background: colors[i] }} />{n}</span>)}</div>}
      <ExportBar name={exportName} defaults={{ xLabel, yLabel, labelTopN: labelDefault }} canLabel={!!labelScore} build={(o) => buildScatter({ points, colors, names, xLabel, yLabel, vlines, hlines, equalAspect, xTicks, labelScore }, o)} />
    </div>
  );
}

export function LineChart({ xs, ys, xLabel, yLabel, height = 200, yMin, yMax }: { xs: number[]; ys: number[]; xLabel: string; yLabel: string; height?: number; yMin?: number; yMax?: number }) {
  const ref = useCanvas(height, (g, w, h) => {
    if (xs.length < 2) return;
    const m = { l: 48, r: 12, t: 10, b: 34 };
    const y0 = yMin ?? Math.min(...ys), y1 = yMax ?? Math.max(...ys), x0 = xs[0], x1 = xs[xs.length - 1];
    const sx = (v: number) => m.l + ((v - x0) / (x1 - x0)) * (w - m.l - m.r), sy = (v: number) => h - m.b - ((v - y0) / (y1 - y0 || 1)) * (h - m.t - m.b);
    g.font = '11px ' + cssVar('--mono'); g.fillStyle = cssVar('--text-faint'); g.strokeStyle = cssVar('--border'); g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const t of nice(y0, y1, 4)) { g.beginPath(); g.moveTo(m.l, sy(t)); g.lineTo(w - m.r, sy(t)); g.stroke(); g.fillText(+t.toFixed(3) + '', m.l - 6, sy(t)); }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const t of nice(x0, x1, 6)) g.fillText(String(t), sx(t), h - m.b + 6);
    const grad = g.createLinearGradient(0, m.t, 0, h - m.b); grad.addColorStop(0, 'rgba(34,211,238,.35)'); grad.addColorStop(1, 'rgba(34,211,238,0)');
    g.beginPath(); xs.forEach((x, i) => (i ? g.lineTo(sx(x), sy(ys[i])) : g.moveTo(sx(x), sy(ys[i])))); g.strokeStyle = cssVar('--chart-a'); g.lineWidth = 1.8; g.stroke();
    g.lineTo(sx(x1), h - m.b); g.lineTo(sx(x0), h - m.b); g.closePath(); g.fillStyle = grad; g.fill();
    g.fillStyle = cssVar('--text-dim'); g.font = '600 11.5px ' + cssVar('--font'); g.textBaseline = 'bottom'; g.fillText(xLabel, (w + m.l) / 2, h - 1);
    g.save(); g.translate(11, h / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'top'; g.fillText(yLabel, 0, 0); g.restore();
  }, [xs, ys, yMin, yMax]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /><ExportBar name="line" defaults={{ xLabel, yLabel }} build={(o) => buildLine({ xs, ys, xLabel, yLabel, yMin, yMax }, o)} /></div>;
}

export function Histogram({ values, bins = 30, label, height = 170, color = '--chart-a', marker }: { values: number[]; bins?: number; label: string; height?: number; color?: string; marker?: number }) {
  const ref = useCanvas(height, (g, w, h) => {
    const v = values.filter(Number.isFinite); if (!v.length) return;
    const lo = Math.min(...v), hi = Math.max(...v), bw = (hi - lo || 1) / bins, counts = new Array(bins).fill(0);
    for (const x of v) counts[Math.min(bins - 1, Math.floor((x - lo) / bw))]++;
    const m = { l: 36, r: 8, t: 8, b: 32 }, mx = Math.max(...counts);
    const bwPx = (w - m.l - m.r) / bins;
    g.fillStyle = cssVar(color);
    counts.forEach((c, i) => { const bh = (c / mx) * (h - m.t - m.b); g.globalAlpha = 0.85; g.beginPath(); g.roundRect(m.l + i * bwPx + 1, h - m.b - bh, Math.max(1, bwPx - 2), bh, 2); g.fill(); });
    g.globalAlpha = 1; g.font = '11px ' + cssVar('--mono'); g.fillStyle = cssVar('--text-faint'); g.textAlign = 'center'; g.textBaseline = 'top';
    for (const t of nice(lo, hi, 5)) g.fillText(String(t), m.l + ((t - lo) / (hi - lo || 1)) * (w - m.l - m.r), h - m.b + 5);
    g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(String(mx), m.l - 5, m.t + 6); g.fillText('0', m.l - 5, h - m.b);
    if (marker !== undefined && marker >= lo && marker <= hi) { const x = m.l + ((marker - lo) / (hi - lo || 1)) * (w - m.l - m.r); g.strokeStyle = cssVar('--chart-d'); g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, h - m.b); g.stroke(); g.setLineDash([]); }
    g.fillStyle = cssVar('--text-dim'); g.font = '600 11.5px ' + cssVar('--font'); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(label, (w + m.l) / 2, h - 1);
  }, [values, bins, label, marker]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /><ExportBar name="histogram" defaults={{ xLabel: label, yLabel: 'Count' }} build={(o) => buildHistogram({ values, bins, label, marker }, o)} /></div>;
}

/** Box-and-whisker plot of one or more groups: Q1–Q3 box, median, 1.5×IQR whiskers, outliers and jittered points. */
export function BoxPlot({ groups, yLabel, height = 240, exportName = 'box-plot' }: { groups: { name: string; values: number[]; color: string }[]; yLabel: string; height?: number; exportName?: string }) {
  const ref = useCanvas(height, (g, w, h) => {
    const all = groups.flatMap((q) => q.values).filter(Number.isFinite);
    if (!all.length) return;
    const lo = Math.min(...all), hi = Math.max(...all), m = { l: 48, r: 10, t: 10, b: 34 };
    const ticks = nice(lo, hi, 5), y0 = Math.min(lo, ticks[0]), y1 = Math.max(hi, ticks[ticks.length - 1]);
    const sy = (v: number) => h - m.b - ((v - y0) / (y1 - y0 || 1)) * (h - m.t - m.b);
    const bw = ((w - m.l - m.r) / groups.length) * 0.55;
    g.font = '11px ' + cssVar('--mono'); g.fillStyle = cssVar('--text-faint'); g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const t of ticks) { const y = sy(t); g.strokeStyle = cssVar('--border'); g.beginPath(); g.moveTo(m.l, y); g.lineTo(w - m.r, y); g.stroke(); g.fillText(String(t), m.l - 5, y); }
    groups.forEach((q, i) => {
      const st = tukeyQuartiles(q.values), cx = m.l + ((i + 0.5) / groups.length) * (w - m.l - m.r), c = cssVar(q.color);
      g.globalAlpha = 0.35; g.fillStyle = c; g.fillRect(cx - bw / 2, sy(st.q3), bw, Math.max(1, sy(st.q1) - sy(st.q3)));
      g.globalAlpha = 1; g.strokeStyle = cssVar('--text-dim'); g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - bw / 2, sy(st.median)); g.lineTo(cx + bw / 2, sy(st.median)); g.stroke();
      g.beginPath(); g.moveTo(cx, sy(st.q3)); g.lineTo(cx, sy(st.whiskerHi)); g.moveTo(cx, sy(st.q1)); g.lineTo(cx, sy(st.whiskerLo)); g.stroke();
      for (const v of st.outliers) { g.beginPath(); g.arc(cx, sy(v), 2.2, 0, Math.PI * 2); g.stroke(); }
      q.values.forEach((v, k) => { const j = ((Math.imul(k + 1 + i * 7919, 2654435761) >>> 8) / 16777216 - 0.5) * bw * 0.5; g.globalAlpha = 0.55; g.fillStyle = cssVar('--text-dim'); g.beginPath(); g.arc(cx + j, sy(v), 1.4, 0, Math.PI * 2); g.fill(); });
      g.globalAlpha = 1; g.fillStyle = cssVar('--text-faint'); g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(q.name, cx, h - m.b + 6);
    });
    g.fillStyle = cssVar('--text-dim'); g.font = '600 11.5px ' + cssVar('--font'); g.textBaseline = 'bottom'; g.textAlign = 'center'; g.fillText(yLabel, (w + m.l) / 2, h - 1);
  }, [groups, yLabel]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /><ExportBar name={exportName} defaults={{ yLabel }} build={(o) => buildBoxPlot({ groups, xLabel: '', yLabel }, o)} /></div>;
}

export function BarChart({ labels, values, colors, yLabel, height = 220, fmt = (v: number) => String(Math.round(v)), errors, errorsLo, dots, exportName = 'bar-chart' }: { labels: string[]; values: number[]; colors: string[]; yLabel: string; height?: number; fmt?: (v: number) => string; errors?: number[]; errorsLo?: number[]; dots?: number[][]; exportName?: string }) {
  const ref = useCanvas(height, (g, w, h) => {
    const m = { l: 56, r: 10, t: 14, b: 46 }, mx = Math.max(...values.map((v, i) => v + (errors?.[i] ?? 0)), ...(dots?.flat() ?? []), 1e-9), bw = (w - m.l - m.r) / labels.length;
    g.strokeStyle = cssVar('--border'); g.fillStyle = cssVar('--text-faint'); g.font = '11px ' + cssVar('--mono'); g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const t of nice(0, mx, 4)) { const y = h - m.b - (t / mx) * (h - m.t - m.b); g.beginPath(); g.moveTo(m.l, y); g.lineTo(w - m.r, y); g.stroke(); g.fillText(fmt(t), m.l - 6, y); }
    labels.forEach((l, i) => {
      const bh = (values[i] / mx) * (h - m.t - m.b), x = m.l + i * bw + bw * 0.15;
      g.fillStyle = colors[i % colors.length]; g.globalAlpha = 0.9; g.beginPath(); g.roundRect(x, h - m.b - bh, bw * 0.7, bh, 4); g.fill(); g.globalAlpha = 1;
      g.fillStyle = cssVar('--text-faint'); g.textAlign = 'center'; g.textBaseline = 'top'; g.save(); g.translate(x + bw * 0.35, h - m.b + 6); if (bw < 56) g.rotate(0.6); g.textAlign = bw < 56 ? 'left' : 'center'; g.fillText(l.length > 12 ? l.slice(0, 11) + '…' : l, 0, 0); g.restore();
      const px = x + bw * 0.35, Y = (v: number) => h - m.b - (v / mx) * (h - m.t - m.b), e = errors?.[i];
      g.strokeStyle = cssVar('--text'); g.fillStyle = cssVar('--text');
      if (e && Number.isFinite(e)) { g.beginPath(); g.moveTo(px, Y(values[i] + e)); g.lineTo(px, Y(Math.max(0, values[i] - (errorsLo?.[i] ?? e)))); g.moveTo(px - 4, Y(values[i] + e)); g.lineTo(px + 4, Y(values[i] + e)); g.moveTo(px - 4, Y(Math.max(0, values[i] - (errorsLo?.[i] ?? e)))); g.lineTo(px + 4, Y(Math.max(0, values[i] - (errorsLo?.[i] ?? e)))); g.stroke(); }
      dots?.[i]?.forEach((d, k, a) => { g.beginPath(); g.arc(px + ((k + 0.5) / a.length - 0.5) * bw * 0.5, Y(d), 2.2, 0, 6.3); g.fill(); });
    });
    g.save(); g.translate(11, h / 2); g.rotate(-Math.PI / 2); g.fillStyle = cssVar('--text-dim'); g.font = '600 11.5px ' + cssVar('--font'); g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(yLabel, 0, 0); g.restore();
  }, [labels, values, colors, yLabel, errors, errorsLo, dots]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /><ExportBar name={exportName} defaults={{ yLabel }} build={(o) => buildBars({ labels, values, colors, yLabel, fmt, errors, errorsLo, dots }, o)} /></div>;
}

/** Diverging heatmap of z-scores with row/column labels. */
export function Heatmap({ rows, cols, z, height = 440 }: { rows: string[]; cols: string[]; z: number[][]; height?: number }) {
  const ref = useCanvas(height, (g, w, h) => {
    const m = { l: 86, r: 10, t: 54, b: 10 }, cw = (w - m.l - m.r) / cols.length, rh = (h - m.t - m.b) / rows.length;
    const color = (v: number) => { const t = Math.max(-2, Math.min(2, v)) / 2; return t < 0 ? `rgb(${Math.round(30 + (1 + t) * 190)},${Math.round(110 + (1 + t) * 120)},${Math.round(230 + (1 + t) * 25)})` : `rgb(${Math.round(225 + t * 25)},${Math.round(225 - t * 140)},${Math.round(225 - t * 150)})`; };
    z.forEach((row, i) => row.forEach((v, j) => { g.fillStyle = color(v); g.fillRect(m.l + j * cw, m.t + i * rh, cw - 1, rh - 1); }));
    g.fillStyle = cssVar('--text-faint'); g.font = '10.5px ' + cssVar('--mono'); g.textAlign = 'right'; g.textBaseline = 'middle';
    if (rh > 8) rows.forEach((r, i) => g.fillText(r, m.l - 6, m.t + (i + 0.5) * rh));
    g.save(); cols.forEach((c, j) => { g.save(); g.translate(m.l + (j + 0.5) * cw, m.t - 6); g.rotate(-0.7); g.textAlign = 'left'; g.fillText(c, 0, 0); g.restore(); }); g.restore();
  }, [rows, cols, z]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /><ExportBar name="heatmap" defaults={{}} build={(o) => buildHeatmap({ rows, cols, z }, o)} /></div>;
}

/** Fitted curves with replicate points, error bars, confidence band and marker lines; linear or log axes. Drawn from the same scene as the export. */
export function CurvePlot({ spec, height = 320, exportName = 'curves' }: { spec: CurveSpec; height?: number; exportName?: string }) {
  const build = (o: FigureOptions, w: number, h: number) => buildCurves(spec, { ...o, widthMm: w / (72 / 25.4), heightMm: h / (72 / 25.4) });
  const ref = useCanvas(height, (g, w, h) => {
    const sc = build({ widthMm: 0, heightMm: 0, fontPt: 10.5, palette: 'shown', theme: 'page', title: '', xLabel: '', yLabel: '', labelTopN: 0, dpi: 96 }, w, h);
    sc.bg = null; drawScene(g, sc, 1);
  }, [spec]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /><ExportBar name={exportName} defaults={{ xLabel: spec.xLabel, yLabel: spec.yLabel }} build={(o) => buildCurves(spec, o)} /></div>;
}
