import { useState } from 'react';
import { downloadBlob, downloadText, toast } from '@/ui/kit';
import { DEFAULT_OPTIONS, sceneToPdf, sceneToPng, sceneToSvg, type FigureOptions, type Scene } from './figure';

const PRESETS: [string, number, number][] = [['1 column (85 mm)', 85, 62], ['1.5 columns (114 mm)', 114, 80], ['2 columns (174 mm)', 174, 110], ['Slide (240 × 135 mm)', 240, 135]];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figure';

/** Small "Export figure" panel for a chart: size, font, palette, theme, editable title/axis labels, SVG / PDF / PNG downloads. */
export function ExportBar({ name, defaults, build, canLabel = false }: { name: string; defaults: { title?: string; xLabel?: string; yLabel?: string; labelTopN?: number }; build(o: FigureOptions): Scene; canLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const [o, setO] = useState<FigureOptions>({ ...DEFAULT_OPTIONS, title: defaults.title ?? '', labelTopN: defaults.labelTopN ?? 0 });
  const set = <K extends keyof FigureOptions>(k: K, v: FigureOptions[K]) => setO((p) => ({ ...p, [k]: v }));
  const num = (k: 'widthMm' | 'heightMm' | 'fontPt' | 'labelTopN', min: number, max: number) => <input className="input" type="number" min={min} max={max} value={o[k]} onChange={(e) => set(k, Math.max(min, Math.min(max, +e.target.value || min)))} style={{ width: 70 }} />;
  const base = slug(o.title || name);
  const go = async (kind: 'svg' | 'pdf' | 'png300' | 'png600') => {
    try {
      const sc = build(o);
      if (kind === 'svg') downloadText(`${base}.svg`, sceneToSvg(sc), 'image/svg+xml');
      else if (kind === 'pdf') downloadText(`${base}.pdf`, sceneToPdf(sc), 'application/pdf');
      else downloadBlob(`${base}-${kind.slice(3)}dpi.png`, await sceneToPng(sc, +kind.slice(3)));
    } catch (e) { toast(`Export failed: ${(e as Error).message}`); }
  };
  return (
    <div className="chart-export">
      <button className="btn ghost sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Export figure ${name}`}>{open ? 'Close export' : 'Export figure'}</button>
      {open && (
        <div className="export-panel" role="group" aria-label="Figure export options">
          <label className="field">Size<select className="select" value="" onChange={(e) => { const p = PRESETS[+e.target.value]; if (p) setO((q) => ({ ...q, widthMm: p[1], heightMm: p[2] })); }}><option value="">Preset…</option>{PRESETS.map((p, i) => <option key={p[0]} value={i}>{p[0]}</option>)}</select></label>
          <label className="field">Width (mm){num('widthMm', 30, 400)}</label>
          <label className="field">Height (mm){num('heightMm', 20, 400)}</label>
          <label className="field">Font (pt){num('fontPt', 4, 24)}</label>
          <label className="field">Palette<select className="select" value={o.palette} onChange={(e) => set('palette', e.target.value as FigureOptions['palette'])}><option value="shown">As shown</option><option value="okabe">Colour-blind safe (Okabe–Ito)</option></select></label>
          <label className="field">Theme<select className="select" value={o.theme} onChange={(e) => set('theme', e.target.value as FigureOptions['theme'])}><option value="light">Light (white)</option><option value="dark">Dark</option><option value="page">Current page</option></select></label>
          <label className="field">Title<input className="input" value={o.title} onChange={(e) => set('title', e.target.value)} /></label>
          <label className="field">X label<input className="input" placeholder={defaults.xLabel} value={o.xLabel} onChange={(e) => set('xLabel', e.target.value)} /></label>
          <label className="field">Y label<input className="input" placeholder={defaults.yLabel} value={o.yLabel} onChange={(e) => set('yLabel', e.target.value)} /></label>
          {canLabel && <label className="field">Label top N genes{num('labelTopN', 0, 100)}</label>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', gridColumn: '1 / -1' }}>
            <button className="btn sm" onClick={() => void go('svg')}>SVG</button>
            <button className="btn sm" onClick={() => void go('pdf')}>PDF</button>
            <button className="btn sm" onClick={() => void go('png300')}>PNG 300 dpi</button>
            <button className="btn sm" onClick={() => void go('png600')}>PNG 600 dpi</button>
          </div>
        </div>
      )}
    </div>
  );
}
