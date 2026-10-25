import { useEffect, useRef, useState } from 'react';
import { Callout, Card, Field, Stat, fmt } from '@/ui/kit';
import type { Analysis, ImageSettings, SourceImage } from './analyse';
import { drawAnnotated } from './draw';
import { DEMO_COLONIES, demoPlate } from './demo';

interface Props {
  image: SourceImage | null;
  settings: ImageSettings;
  analysis: Analysis | null;
  expected: number | null;
  setSettings(s: ImageSettings): void;
  onImage(image: SourceImage | null, expected: number | null): void;
}

export default function ImageTab({ image, settings, analysis, expected, setSettings, onImage }: Props) {
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => { if (canvas.current && analysis) drawAnnotated(canvas.current, analysis); }, [analysis]);

  const update = (patch: Partial<ImageSettings>) => setSettings({ ...settings, ...patch });

  const loadFile = (file: File) => {
    setError('');
    if (!file.type.startsWith('image/')) { setError('Choose an image file (PNG, JPEG or TIFF converted by the browser).'); return; }
    if (file.size > 30 * 1024 * 1024) { setError('The image is larger than 30 MB.'); return; }
    const reader = new FileReader();
    reader.onerror = () => setError('The image could not be read.');
    reader.onload = () => {
      const el = new Image();
      el.onerror = () => setError('The browser could not decode this image.');
      el.onload = () => {
        const scale = Math.min(1, 2000 / Math.max(el.width, el.height));
        const width = Math.max(1, Math.round(el.width * scale));
        const height = Math.max(1, Math.round(el.height * scale));
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d');
        if (!ctx) { setError('The browser could not create a canvas.'); return; }
        ctx.drawImage(el, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        onImage({ width, height, data, name: file.name, original: { width: el.width, height: el.height } }, null);
      };
      el.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const demo = () => {
    setError('');
    const d = demoPlate();
    onImage({ width: d.width, height: d.height, data: d.data, name: 'Synthetic plate' }, d.expected);
  };

  const toggleRoi = (on: boolean) => update(image && on && settings.roiR <= 0
    ? { roiEnabled: on, roiX: image.width / 2, roiY: image.height / 2, roiR: Math.min(image.width, image.height) * 0.45 }
    : { roiEnabled: on });

  return (
    <div className="stack">
      <Card title="Image" sub={image ? `${image.name} · ${image.width} × ${image.height} px${image.original && (image.original.width !== image.width || image.original.height !== image.height) ? ` (scaled from ${image.original.width} × ${image.original.height})` : ''}` : 'Load a plate photo or microscope field. It never leaves the browser.'} actions={
        image ? <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => input.current?.click()}>Open another…</button>
          <button className="btn sm" onClick={() => { onImage(null, null); setError(''); }}>Clear</button>
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
        </div> : undefined
      }>
        {!image && <>
          <div className={`dropzone ${over ? 'over' : ''}`} role="button" tabIndex={0} onClick={() => input.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}>
            <div>Drop an image or click to browse</div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Scaled to at most 2000 px on the long side. Read locally, never uploaded.</div>
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={demo}>Load demo ({DEMO_COLONIES} colonies)</button>
          </div>
        </>}
        {image && <div className="cols-4">
          <Stat label="Count" value={analysis ? fmt(analysis.components.length, 0) : '–'} hint={expected !== null ? `demo expects ${expected}` : 'after size filtering'} />
          <Stat label="Threshold" value={analysis ? fmt(analysis.threshold, 0) : '–'} hint={analysis ? (analysis.invert ? 'inverted image' : 'grey image') : 'auto Otsu'} />
          <Stat label="Polarity" value={analysis ? (analysis.invert ? 'dark objects' : 'light objects') : '–'} hint={settings.polarity === 'auto' ? 'from the border' : 'set by hand'} />
          <Stat label="Working size" value={`${image.width} × ${image.height}`} hint="pixels" />
        </div>}
        {error && <Callout kind="err">{error}</Callout>}
      </Card>

      {image && <>
        <Card title="Segmentation" sub="Changes preview live; the same settings drive the Results tab.">
          <div className="grid-3">
            <Field label="Blur sigma (px)"><input type="number" min={0} max={10} step={0.5} value={settings.sigma} onChange={(e) => update({ sigma: Math.max(0, Number(e.target.value)) })} /></Field>
            <Field label="Polarity">
              <select value={settings.polarity} onChange={(e) => update({ polarity: e.target.value as ImageSettings['polarity'] })}>
                <option value="auto">Auto (from the border)</option>
                <option value="light">Light objects on dark background</option>
                <option value="dark">Dark objects on light background</option>
              </select>
            </Field>
            <Field label="Minimum area (px)"><input type="number" min={0} step={1} value={settings.minArea} onChange={(e) => update({ minArea: Math.max(0, Number(e.target.value)) })} /></Field>
            <Field label="Maximum area (px)"><input type="number" min={0} step={1} value={settings.maxArea} onChange={(e) => update({ maxArea: Math.max(1, Number(e.target.value)) })} /></Field>
            <Field label="Scale (pixels per mm; 0 = unset)"><input type="number" min={0} step={0.1} value={settings.pxPerMm} onChange={(e) => update({ pxPerMm: Math.max(0, Number(e.target.value)) })} /></Field>
            <Field label="Minimum marker distance (px)"><input type="number" min={2} max={100} step={1} value={settings.minDistance} disabled={!settings.split} onChange={(e) => update({ minDistance: Math.max(2, Number(e.target.value)) })} /></Field>
          </div>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
            <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={settings.autoThreshold} onChange={(e) => update({ autoThreshold: e.target.checked })} /> Auto threshold (Otsu)</label>
            <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={settings.split} onChange={(e) => update({ split: e.target.checked })} /> Split touching objects (watershed)</label>
            <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={settings.fillHoles} onChange={(e) => update({ fillHoles: e.target.checked })} /> Fill holes</label>
            <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={settings.roiEnabled} onChange={(e) => toggleRoi(e.target.checked)} /> Circular region of interest</label>
          </div>
          <div className="row" style={{ gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="faint" style={{ fontSize: 12 }}>Threshold {analysis ? fmt(analysis.threshold, 0) : '–'} (0–255)</span>
            <input type="range" min={0} max={255} step={1} value={settings.autoThreshold ? (analysis?.threshold ?? 128) : settings.threshold} disabled={settings.autoThreshold}
              onChange={(e) => update({ threshold: Number(e.target.value) })} aria-label="Threshold" style={{ flex: 1, minWidth: 180 }} />
            {!settings.autoThreshold && <input type="number" min={0} max={255} value={settings.threshold} onChange={(e) => update({ threshold: Math.max(0, Math.min(255, Number(e.target.value))) })} style={{ width: 74 }} />}
          </div>
          {settings.roiEnabled && <div className="grid-3" style={{ marginTop: 10 }}>
            <Field label="Centre x (px)"><input type="number" step={1} value={settings.roiX} onChange={(e) => update({ roiX: Number(e.target.value) })} /></Field>
            <Field label="Centre y (px)"><input type="number" step={1} value={settings.roiY} onChange={(e) => update({ roiY: Number(e.target.value) })} /></Field>
            <Field label="Radius (px)"><input type="number" min={1} step={1} value={settings.roiR} onChange={(e) => update({ roiR: Math.max(1, Number(e.target.value)) })} /></Field>
          </div>}
        </Card>

        <Card title="Overlay" sub={`${analysis ? analysis.components.length : 0} objects after filtering · red outlines and numbered centroids`}>
          <div className="table-wrap" style={{ overflow: 'auto' }}>
            <canvas ref={canvas} style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 640, objectFit: 'contain' }} />
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Numbers are component ids. Unnumbered outlines were removed by the area filter. Zoom by opening the saved PNG.</div>
        </Card>
      </>}
    </div>
  );
}
