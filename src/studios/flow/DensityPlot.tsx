import { useEffect, useRef, type RefObject } from 'react';
import { cssVar } from '@/viz/charts';
import type { Gate } from './gate';

interface Props {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  xLabel: string;
  yLabel: string;
  gates?: { name: string; gate: Gate }[];
  pendingPoints?: [number, number][];
  onPick?(x: number, y: number): void;
  canvasRef?: RefObject<HTMLCanvasElement | null>;
}

const W = 720, H = 520, M = { l: 62, r: 16, t: 14, b: 46 };
const COLORS = ['#ff5555', '#ffd24d', '#4dd2ff', '#7dff7d', '#d18bff', '#ff9e4d'];
const BINS = 256;

function domain(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  const s = [...values].sort((a, b) => a - b);
  let lo = s[Math.floor((s.length - 1) * 0.005)], hi = s[Math.floor((s.length - 1) * 0.995)];
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  return [lo, hi];
}

function ramp(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [4, 12, 35]], [0.22, [0, 70, 190]], [0.46, [0, 190, 220]], [0.7, [255, 220, 62]], [1, [255, 45, 30]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], f = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}

const tick = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2));

export default function DensityPlot({ x, y, xLabel, yLabel, gates = [], pendingPoints = [], onPick, canvasRef }: Props) {
  const inner = useRef<HTMLCanvasElement>(null);
  const ref = canvasRef ?? inner;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bg = cssVar('--bg') || '#0b0f14', text = cssVar('--text') || '#ddd', faint = cssVar('--text-faint') || '#888', border = cssVar('--border') || '#333';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const n = Math.min(x.length, y.length);
    if (!n) {
      ctx.fillStyle = faint; ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('No events', W / 2, H / 2); return;
    }
    const stride = Math.max(1, Math.ceil(n / 200_000));
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < n; i += stride) { xs.push(x[i]); ys.push(y[i]); }
    const [xmin, xmax] = domain(xs), [ymin, ymax] = domain(ys);
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    const bins = new Uint32Array(BINS * BINS);
    for (let i = 0; i < xs.length; i++) {
      const bx = Math.max(0, Math.min(BINS - 1, Math.floor(((xs[i] - xmin) / (xmax - xmin)) * BINS)));
      const by = Math.max(0, Math.min(BINS - 1, Math.floor(((ys[i] - ymin) / (ymax - ymin)) * BINS)));
      bins[by * BINS + bx]++;
    }
    let max = 0;
    for (const c of bins) if (c > max) max = c;
    const img = ctx.createImageData(BINS, BINS), denom = Math.log1p(max || 1);
    for (let by = 0; by < BINS; by++) for (let bx = 0; bx < BINS; bx++) {
      const count = bins[(BINS - 1 - by) * BINS + bx];
      const j = (by * BINS + bx) * 4;
      if (!count) { img.data[j + 3] = 0; continue; }
      const [r, g, b] = ramp(Math.log1p(count) / denom);
      img.data[j] = r; img.data[j + 1] = g; img.data[j + 2] = b; img.data[j + 3] = 255;
    }
    const off = document.createElement('canvas'); off.width = BINS; off.height = BINS;
    off.getContext('2d')?.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, M.l, M.t, plotW, plotH);

    const sx = (v: number) => M.l + ((v - xmin) / (xmax - xmin)) * plotW;
    const sy = (v: number) => M.t + plotH - ((v - ymin) / (ymax - ymin)) * plotH;

    ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.strokeRect(M.l, M.t, plotW, plotH);
    ctx.fillStyle = faint; ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let k = 0; k <= 4; k++) { const v = xmin + ((xmax - xmin) * k) / 4; ctx.fillText(tick(v), M.l + (plotW * k) / 4, M.t + plotH + 6); }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) { const v = ymin + ((ymax - ymin) * k) / 4; ctx.fillText(tick(v), M.l - 7, M.t + plotH - (plotH * k) / 4); }
    ctx.fillStyle = text; ctx.font = '600 12.5px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(xLabel, M.l + plotW / 2, H - 4);
    ctx.save(); ctx.translate(14, M.t + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore();

    gates.forEach(({ name, gate }, i) => {
      ctx.strokeStyle = COLORS[i % COLORS.length]; ctx.lineWidth = 1.6; ctx.beginPath();
      let lx = M.l + 5, ly = M.t + 5;
      if (gate.type === 'rect') {
        const x0 = sx(gate.xmin), y0 = sy(gate.ymax), w = sx(gate.xmax) - x0, h = sy(gate.ymin) - y0;
        ctx.rect(x0, y0, w, h); lx = x0 + 4; ly = y0 - 4;
      } else if (gate.type === 'polygon') {
        gate.points.forEach(([px, py], k) => (k ? ctx.lineTo(sx(px), sy(py)) : ctx.moveTo(sx(px), sy(py))));
        ctx.closePath();
        if (gate.points[0]) { lx = sx(gate.points[0][0]) + 4; ly = sy(gate.points[0][1]) - 4; }
      } else {
        ctx.ellipse(sx(gate.cx), sy(gate.cy), Math.abs(sx(gate.cx + gate.rx) - sx(gate.cx)), Math.abs(sy(gate.cy + gate.ry) - sy(gate.cy)), (-gate.angle * Math.PI) / 180, 0, Math.PI * 2);
        lx = sx(gate.cx) + 4; ly = sy(gate.cy) - 4;
      }
      ctx.stroke();
      ctx.fillStyle = COLORS[i % COLORS.length]; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(name, lx, ly);
    });

    if (pendingPoints.length) {
      ctx.strokeStyle = '#ffe066'; ctx.fillStyle = '#ffe066'; ctx.lineWidth = 1.5; ctx.beginPath();
      pendingPoints.forEach(([px, py], k) => (k ? ctx.lineTo(sx(px), sy(py)) : ctx.moveTo(sx(px), sy(py))));
      if (pendingPoints.length > 1) ctx.stroke();
      for (const [px, py] of pendingPoints) { ctx.beginPath(); ctx.arc(sx(px), sy(py), 3.2, 0, Math.PI * 2); ctx.fill(); }
    }
  }, [x, y, xLabel, yLabel, gates, pendingPoints, ref]);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onPick) return;
    const canvas = ref.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W, py = ((e.clientY - rect.top) / rect.height) * H;
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    if (px < M.l || px > M.l + plotW || py < M.t || py > M.t + plotH) return;
    const n = Math.min(x.length, y.length); if (!n) return;
    const stride = Math.max(1, Math.ceil(n / 200_000));
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < n; i += stride) { xs.push(x[i]); ys.push(y[i]); }
    const [xmin, xmax] = domain(xs), [ymin, ymax] = domain(ys);
    onPick(xmin + ((px - M.l) / plotW) * (xmax - xmin), ymax - ((py - M.t) / plotH) * (ymax - ymin));
  };

  return <canvas ref={ref} onClick={click} role="img" aria-label={`Density plot of ${xLabel} and ${yLabel}`}
    style={{ display: 'block', width: '100%', height: 'auto', cursor: onPick ? 'crosshair' : undefined }} />;
}
