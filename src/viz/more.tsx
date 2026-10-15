import { useMemo, useState } from 'react';
import type { TreeNode } from '@/studios/phylo/kernels';
import { cssVar, useCanvas } from './charts';

export const catColors = (n: number) => Array.from({ length: Math.max(1, n) }, (_, i) => `hsl(${Math.round((i * 360) / Math.max(n, 6) + 192) % 360} 72% 60%)`);

/** Phylogram / cladogram on canvas with support values and scale bar. */
export function TreeView({ tree, phylogram = true, minSupport = 0, tipColors }: { tree: TreeNode; phylogram?: boolean; minSupport?: number; tipColors?: Map<string, string> }) {
  const layout = useMemo(() => {
    const tips: { n: TreeNode; y: number }[] = []; const pos = new Map<TreeNode, { x: number; y: number }>(); let maxX = 0;
    const depthOf = (n: TreeNode): number => (n.children.length ? 1 + Math.max(...n.children.map(depthOf)) : 0);
    const rec = (n: TreeNode, x: number): number => {
      const xx = phylogram ? x + n.length : 0; let y: number;
      if (!n.children.length) { y = tips.length; tips.push({ n, y }); maxX = Math.max(maxX, phylogram ? xx : 0); }
      else { const ys = n.children.map((c) => rec(c, xx)); y = (ys[0] + ys[ys.length - 1]) / 2; }
      pos.set(n, { x: xx, y }); return y;
    };
    rec(tree, 0);
    if (!phylogram) { const D = depthOf(tree); const set = (n: TreeNode) => { const p = pos.get(n)!; p.x = D - depthOf(n); n.children.forEach(set); }; set(tree); maxX = D; }
    return { tips, pos, maxX: maxX || 1 };
  }, [tree, phylogram]);
  const rowH = 18, height = Math.max(260, layout.tips.length * rowH + 50);
  const ref = useCanvas(height, (g, w) => {
    const m = { l: 14, r: 150, t: 12, b: 34 }, sx = (v: number) => m.l + (v / layout.maxX) * (w - m.l - m.r), sy = (v: number) => m.t + v * rowH + rowH / 2;
    g.lineWidth = 1.5; g.strokeStyle = cssVar('--text-faint'); g.font = '11.5px ' + cssVar('--mono'); g.textBaseline = 'middle';
    const draw = (n: TreeNode) => {
      const p = layout.pos.get(n)!;
      if (n.children.length) { const ys = n.children.map((c) => layout.pos.get(c)!.y); g.beginPath(); g.moveTo(sx(p.x), sy(Math.min(...ys))); g.lineTo(sx(p.x), sy(Math.max(...ys))); g.stroke(); for (const c of n.children) { const cp = layout.pos.get(c)!; g.beginPath(); g.moveTo(sx(p.x), sy(cp.y)); g.lineTo(sx(cp.x), sy(cp.y)); g.stroke(); draw(c); }
        if (n.support !== undefined && n.support >= minSupport) { g.fillStyle = n.support >= 90 ? cssVar('--accent-3') : n.support >= 70 ? cssVar('--warn') : cssVar('--text-faint'); g.font = '10px ' + cssVar('--mono'); g.textAlign = 'right'; g.fillText(String(n.support), sx(p.x) - 3, sy(p.y) - 7); g.font = '11.5px ' + cssVar('--mono'); } }
      else { const col = tipColors?.get(n.name ?? '') ?? cssVar('--chart-a'); g.fillStyle = col; g.beginPath(); g.arc(sx(p.x), sy(p.y), 3.2, 0, 6.3); g.fill(); g.fillStyle = cssVar('--text'); g.textAlign = 'left'; g.fillText(n.name ?? '', sx(p.x) + 8, sy(p.y)); }
    };
    draw(tree);
    if (phylogram) { const nice = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1].find((v) => (v / layout.maxX) * (w - m.l - m.r) > 50) ?? 1, x0 = m.l, y0 = height - 14; g.strokeStyle = cssVar('--text-dim'); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (nice / layout.maxX) * (w - m.l - m.r), y0); g.stroke(); g.fillStyle = cssVar('--text-dim'); g.textAlign = 'left'; g.fillText(`${nice} substitutions/site`, x0 + (nice / layout.maxX) * (w - m.l - m.r) + 8, y0); }
  }, [layout, phylogram, minSupport, tipColors, tree]);
  return <div className="chart" style={{ overflow: 'auto', maxHeight: 640 }}><canvas ref={ref} style={{ height, minWidth: 560 }} /></div>;
}

const PROT_COLORS: Record<string, string> = Object.fromEntries([...'AVLIMFWC'].map((c) => [c, '#5b8def']).concat([...'KR'].map((c) => [c, '#e5584f'])).concat([...'DE'].map((c) => [c, '#b45fd1'])).concat([...'STNQ'].map((c) => [c, '#3fb97a'])).concat([...'GP'].map((c) => [c, '#e3a63a'])).concat([...'HY'].map((c) => [c, '#2bb3b3'])));
const NT_COLORS: Record<string, string> = { A: '#3fb97a', C: '#5b8def', G: '#e3a63a', T: '#e5584f', U: '#e5584f' };
/** Virtualised-by-scroll MSA viewer with conservation track. */
export function MsaView({ names, aln, kind, entropy, consensus }: { names: string[]; aln: string[]; kind: 'dna' | 'protein'; entropy: number[]; consensus: string }) {
  const cw = 11, rh = 17, L = aln[0]?.length ?? 0, width = Math.min(L * cw, 30000), H = (names.length + 2) * rh + 22, [hover, setHover] = useState<string | null>(null);
  const ref = useCanvas(H, (g) => {
    const cols = kind === 'dna' ? NT_COLORS : PROT_COLORS; g.font = '11px ' + cssVar('--mono'); g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let c = 0; c < Math.min(L, 2700); c++) { const e = entropy[c], bh = e * 18; g.fillStyle = cssVar('--chart-a'); g.globalAlpha = 0.25 + 0.7 * e; g.fillRect(c * cw + 1, 20 - bh, cw - 2, bh); g.globalAlpha = 1; if (c % 10 === 9) { g.fillStyle = cssVar('--text-faint'); g.fillText(String(c + 1), c * cw + cw / 2, 8); } }
    const row = (txt: string, y: number, bold = false) => { for (let c = 0; c < Math.min(txt.length, 2700); c++) { const ch = txt[c]; if (ch === '-') { g.fillStyle = cssVar('--border-hi'); g.fillRect(c * cw + 2, y + rh / 2 - 1, cw - 4, 2); continue; } g.fillStyle = (cols[ch] ?? '#8890a0'); g.globalAlpha = bold ? 1 : 0.28; g.fillRect(c * cw, y, cw - 1, rh - 1); g.globalAlpha = 1; g.fillStyle = cssVar('--text'); g.fillText(ch, c * cw + cw / 2, y + rh / 2 + 0.5); } };
    row(consensus.replace(/\./g, '-'), 24, true); aln.forEach((r, i) => row(r, 24 + (i + 1) * rh + 4));
  }, [aln, entropy, consensus, kind]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '24px 10px 0', background: 'var(--surface-solid)', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: `${rh}px`, whiteSpace: 'nowrap', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <div style={{ height: rh, color: 'var(--text-faint)' }}>consensus</div><div style={{ height: 4 }} />
        {names.map((n) => <div key={n} style={{ height: rh, overflow: 'hidden', textOverflow: 'ellipsis' }} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)} title={n}>{n}</div>)}
      </div>
      <div style={{ overflowX: 'auto' }}><canvas ref={ref} style={{ height: H, width }} data-hover={hover ?? ''} /></div>
    </div>
  );
}

export function StackedBars({ labels, series, names, colors, height = 300 }: { labels: string[]; series: number[][]; names: string[]; colors: string[]; height?: number }) {
  const ref = useCanvas(height, (g, w, h) => {
    const m = { l: 40, r: 8, t: 8, b: 52 }, bw = (w - m.l - m.r) / labels.length; g.font = '10.5px ' + cssVar('--mono'); g.fillStyle = cssVar('--text-faint'); g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const t of [0, 0.25, 0.5, 0.75, 1]) { g.fillText(`${t * 100}%`, m.l - 5, h - m.b - t * (h - m.t - m.b)); }
    labels.forEach((l, j) => { let acc = 0; series.forEach((s, i) => { const v = s[j]; g.fillStyle = colors[i % colors.length]; g.fillRect(m.l + j * bw + 1, h - m.b - (acc + v) * (h - m.t - m.b), Math.max(1, bw - 2), v * (h - m.t - m.b)); acc += v; }); g.save(); g.translate(m.l + j * bw + bw / 2, h - m.b + 6); g.rotate(0.7); g.fillStyle = cssVar('--text-faint'); g.textAlign = 'left'; g.fillText(l, 0, 0); g.restore(); });
  }, [labels, series, colors]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /><div className="legend">{names.map((n, i) => <span key={n}><i style={{ background: colors[i % colors.length] }} />{n}</span>)}</div></div>;
}

export function BoxByGroup({ groups, values, yLabel, colors, height = 240 }: { groups: string[]; values: number[][]; yLabel: string; colors: string[]; height?: number }) {
  const ref = useCanvas(height, (g, w, h) => {
    const m = { l: 52, r: 10, t: 12, b: 30 }, all = values.flat(), lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1, y = (v: number) => h - m.b - ((v - lo) / span) * (h - m.t - m.b), bw = (w - m.l - m.r) / groups.length;
    g.strokeStyle = cssVar('--border'); g.fillStyle = cssVar('--text-faint'); g.font = '10.5px ' + cssVar('--mono'); g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) { const v = lo + (span * i) / 4; g.beginPath(); g.moveTo(m.l, y(v)); g.lineTo(w - m.r, y(v)); g.stroke(); g.fillText(v.toFixed(span < 5 ? 2 : 0), m.l - 5, y(v)); }
    groups.forEach((gn, i) => { const v = [...values[i]].sort((a, b) => a - b), q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))], cx = m.l + i * bw + bw / 2, bwid = Math.min(80, bw * 0.5);
      g.strokeStyle = colors[i]; g.fillStyle = colors[i]; g.globalAlpha = 0.22; g.fillRect(cx - bwid / 2, y(q(0.75)), bwid, y(q(0.25)) - y(q(0.75))); g.globalAlpha = 1; g.lineWidth = 1.6; g.strokeRect(cx - bwid / 2, y(q(0.75)), bwid, y(q(0.25)) - y(q(0.75))); g.beginPath(); g.moveTo(cx - bwid / 2, y(q(0.5))); g.lineTo(cx + bwid / 2, y(q(0.5))); g.moveTo(cx, y(q(0.75))); g.lineTo(cx, y(v[v.length - 1])); g.moveTo(cx, y(q(0.25))); g.lineTo(cx, y(v[0])); g.stroke(); g.lineWidth = 1;
      v.forEach((val, k) => { g.beginPath(); g.arc(cx + ((k * 37) % 21 - 10) * (bwid / 50), y(val), 2.6, 0, 6.3); g.fill(); }); g.fillStyle = cssVar('--text-dim'); g.textAlign = 'center'; g.textBaseline = 'top'; g.font = '600 11.5px ' + cssVar('--font'); g.fillText(gn, cx, h - m.b + 8); });
    g.save(); g.translate(11, h / 2); g.rotate(-Math.PI / 2); g.fillStyle = cssVar('--text-dim'); g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(yLabel, 0, 0); g.restore();
  }, [groups, values, colors]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /></div>;
}

/** Labelled square matrix heatmap (identity, ANI, distances). */
export function MatrixHeat({ labels, m, min, max, fmt = (v: number) => v.toFixed(2), cell = 34 }: { labels: string[]; m: number[][]; min: number; max: number; fmt?: (v: number) => string; cell?: number }) {
  const lw = Math.min(150, Math.max(...labels.map((l) => l.length)) * 7 + 10), size = lw + labels.length * cell + 10, H = lw + labels.length * cell + 10;
  const ref = useCanvas(H, (g) => {
    const color = (v: number) => { const t = Math.max(0, Math.min(1, (v - min) / (max - min || 1))); return `hsl(${200 + 60 * t} ${60 + 20 * t}% ${14 + 46 * t}%)`; };
    g.font = '10.5px ' + cssVar('--mono'); g.textBaseline = 'middle';
    labels.forEach((l, i) => { g.fillStyle = cssVar('--text-dim'); g.textAlign = 'right'; g.fillText(l.slice(0, 20), lw - 6, lw + i * cell + cell / 2); g.save(); g.translate(lw + i * cell + cell / 2, lw - 6); g.rotate(-Math.PI / 2); g.textAlign = 'left'; g.fillText(l.slice(0, 20), 0, 0); g.restore(); });
    m.forEach((row, i) => row.forEach((v, j) => { g.fillStyle = color(v); g.fillRect(lw + j * cell, lw + i * cell, cell - 1, cell - 1); if (cell >= 30) { g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(fmt(v), lw + j * cell + cell / 2, lw + i * cell + cell / 2); } }));
  }, [labels, m, min, max]);
  return <div className="chart" style={{ overflow: 'auto' }}><canvas ref={ref} style={{ height: H, width: size, minWidth: size }} /></div>;
}

export interface Series { name: string; ys: number[]; color: string; band?: [number[], number[]] }
export function MultiLine({ xs, series, xLabel, yLabel, height = 240, yMin, yMax }: { xs: number[]; series: Series[]; xLabel: string; yLabel: string; height?: number; yMin?: number; yMax?: number }) {
  const ref = useCanvas(height, (g, w, h) => {
    const m = { l: 46, r: 10, t: 10, b: 34 }, all = series.flatMap((s) => [...s.ys, ...(s.band?.[0] ?? []), ...(s.band?.[1] ?? [])]), y0 = yMin ?? Math.min(...all), y1 = yMax ?? Math.max(...all), x0 = xs[0], x1 = xs[xs.length - 1];
    const sx = (v: number) => m.l + ((v - x0) / (x1 - x0 || 1)) * (w - m.l - m.r), sy = (v: number) => h - m.b - ((v - y0) / (y1 - y0 || 1)) * (h - m.t - m.b);
    g.font = '10.5px ' + cssVar('--mono'); g.fillStyle = cssVar('--text-faint'); g.strokeStyle = cssVar('--border'); g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) { const v = y0 + ((y1 - y0) * i) / 4; g.beginPath(); g.moveTo(m.l, sy(v)); g.lineTo(w - m.r, sy(v)); g.stroke(); g.fillText(+v.toFixed(2) + '', m.l - 5, sy(v)); }
    g.textAlign = 'center'; g.textBaseline = 'top'; for (let i = 0; i <= 5; i++) { const v = x0 + ((x1 - x0) * i) / 5; g.fillText(String(Math.round(v)), sx(v), h - m.b + 6); }
    for (const s of series) { if (s.band) { g.beginPath(); xs.forEach((x, i) => (i ? g.lineTo(sx(x), sy(s.band![1][i])) : g.moveTo(sx(x), sy(s.band![1][i])))); for (let i = xs.length - 1; i >= 0; i--) g.lineTo(sx(xs[i]), sy(s.band[0][i])); g.closePath(); g.fillStyle = s.color; g.globalAlpha = 0.16; g.fill(); g.globalAlpha = 1; } g.beginPath(); xs.forEach((x, i) => (i ? g.lineTo(sx(x), sy(s.ys[i])) : g.moveTo(sx(x), sy(s.ys[i])))); g.strokeStyle = s.color; g.lineWidth = 1.8; g.stroke(); g.lineWidth = 1; }
    g.fillStyle = cssVar('--text-dim'); g.font = '600 11.5px ' + cssVar('--font'); g.textBaseline = 'bottom'; g.textAlign = 'center'; g.fillText(xLabel, (w + m.l) / 2, h - 1); g.save(); g.translate(11, h / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'top'; g.fillText(yLabel, 0, 0); g.restore();
  }, [xs, series, yMin, yMax]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /><div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div></div>;
}

const SBS_COLORS = ['#22bfef', '#1f2937', '#ef4444', '#cbd5e1', '#84cc16', '#f0abfc'];
/** 96-channel trinucleotide signature / spectrum plot, coloured by substitution class. */
export function SigBars({ values, height = 150, label }: { values: number[]; height?: number; label?: string }) {
  const ref = useCanvas(height, (g, w, h) => {
    const m = { l: 40, r: 6, t: 18, b: 22 }, bw = (w - m.l - m.r) / 96, mx = Math.max(...values, 1e-12); g.font = '10px ' + cssVar('--mono'); g.fillStyle = cssVar('--text-faint'); g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const t of [0, 0.5, 1]) { const v = mx * t; g.fillText(v < 1 ? v.toFixed(3) : v.toFixed(0), m.l - 4, h - m.b - t * (h - m.t - m.b)); }
    values.forEach((v, i) => { const cls = Math.floor(i / 16), bh = (v / mx) * (h - m.t - m.b); g.fillStyle = SBS_COLORS[cls]; g.fillRect(m.l + i * bw + 0.5, h - m.b - bh, Math.max(1, bw - 1), bh); });
    ['C>A', 'C>G', 'C>T', 'T>A', 'T>C', 'T>G'].forEach((c, i) => { g.fillStyle = SBS_COLORS[i]; g.fillRect(m.l + i * 16 * bw, h - m.b + 4, 16 * bw - 2, 4); g.fillStyle = cssVar('--text-dim'); g.textAlign = 'center'; g.fillText(c, m.l + (i * 16 + 8) * bw, h - 6); });
    if (label) { g.fillStyle = cssVar('--text'); g.font = '600 11.5px ' + cssVar('--font'); g.textAlign = 'left'; g.fillText(label, m.l + 4, 9); }
  }, [values, label]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /></div>;
}

/** Sequence logo from a position frequency matrix (information content, bits). */
export function SeqLogo({ pfm, height = 110 }: { pfm: { A: number[]; C: number[]; G: number[]; T: number[] }; height?: number }) {
  const L = pfm.A.length, ref = useCanvas(height, (g, w, h) => {
    const colors: Record<string, string> = { A: '#3fb97a', C: '#5b8def', G: '#e3a63a', T: '#e5584f' }, cw = Math.min(46, (w - 34) / L), m = { l: 30, b: 16, t: 4 };
    g.font = '10px ' + cssVar('--mono'); g.fillStyle = cssVar('--text-faint'); g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText('2', m.l - 4, m.t + 4); g.fillText('0', m.l - 4, h - m.b);
    for (let i = 0; i < L; i++) {
      const col = { A: pfm.A[i], C: pfm.C[i], G: pfm.G[i], T: pfm.T[i] }, tot = col.A + col.C + col.G + col.T || 1, p = Object.entries(col).map(([b, v]) => [b, v / tot] as const), H = -p.reduce((s, [, x]) => s + (x > 0 ? x * Math.log2(x) : 0), 0), ic = Math.max(0, 2 - H), scale = (h - m.t - m.b) / 2;
      let y = h - m.b; for (const [b, f] of [...p].sort((a, c) => a[1] - c[1])) { const bh = f * ic * scale; if (bh < 1) continue; g.save(); g.translate(m.l + i * cw, y); g.scale(1, bh / 12); g.fillStyle = colors[b]; g.font = `700 ${Math.round(cw * 1.1)}px ` + cssVar('--font'); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(b, 0, 0); g.restore(); y -= bh; }
    }
  }, [pfm]);
  return <div className="chart"><canvas ref={ref} style={{ height }} /></div>;
}

/** Scrollable Sanger chromatogram: four channels, base calls, per-base quality bars, trimmed region shading. */
export function Chromatogram({ channels, order, bases, peaks, quals, trim, pxPerSample = 1.8, height = 230 }: { channels: Int16Array[]; order: string; bases: string; peaks: number[]; quals: number[]; trim?: { start: number; end: number }; pxPerSample?: number; height?: number }) {
  const len = channels[0].length, width = Math.min(30000, Math.ceil(len * pxPerSample)), COLORS: Record<string, string> = { A: '#3fb97a', C: '#5b8def', G: '#e3a63a', T: '#e5584f' };
  const mx = Math.max(1, ...channels.map((c) => { let m = 0; for (let i = 0; i < c.length; i += 3) if (c[i] > m) m = c[i]; return m; })) * 0.95;
  const ref = useCanvas(height, (g, _w, h) => {
    const top = 34, base = h - 8, hh = base - top, x = (i: number) => i * pxPerSample;
    if (trim) { g.fillStyle = 'rgba(120,130,160,.16)'; const a = x(peaks[trim.start] ?? 0), b = x(peaks[Math.max(0, trim.end - 1)] ?? 0); g.fillRect(0, 0, a, h); g.fillRect(b, 0, width - b, h); }
    channels.forEach((c, ci) => { g.beginPath(); g.strokeStyle = COLORS[order[ci]] ?? '#999'; g.lineWidth = 1.3; for (let i = 0; i < c.length; i++) { const px = x(i), py = base - (Math.max(0, c[i]) / mx) * hh; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); });
    g.font = '10px ' + cssVar('--mono'); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (let i = 0; i < bases.length; i++) { const px = x(peaks[i]), q = quals[i] ?? 0; g.fillStyle = COLORS[bases[i]] ?? '#999'; g.fillText(bases[i], px, 22); g.fillStyle = q >= 30 ? 'rgba(63,185,122,.85)' : q >= 20 ? 'rgba(227,166,58,.85)' : 'rgba(229,88,79,.85)'; g.fillRect(px - 1.5, 27 - Math.min(14, q / 4), 3, Math.min(14, q / 4)); if (i % 10 === 9) { g.fillStyle = cssVar('--text-faint'); g.fillText(String(i + 1), px, 8); } }
  }, [channels, order, bases, peaks, quals, trim, pxPerSample]);
  return <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--code-bg)' }}><canvas ref={ref} style={{ height, width }} /></div>;
}
