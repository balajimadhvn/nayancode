import { useMemo, useState } from 'react';
import { Callout, Card, DataTable, Field, Stat, downloadBlob, downloadText, fmt, toCsv } from '@/ui/kit';
import { Histogram } from '@/viz/charts';
import type { Analysis } from './analyse';
import { areaMm2, cfuPerMl, countableRangeFlag, summary } from './calc';
import { drawAnnotated } from './draw';

interface Props { analysis: Analysis | null; expected: number | null }

export default function ResultsTab({ analysis, expected }: Props) {
  const [exponent, setExponent] = useState(4);
  const [volume, setVolume] = useState(0.1);

  const rows = useMemo(() => (analysis?.components ?? []).map((c) => ({
    id: c.id,
    area_px: c.area,
    area_mm2: analysis && analysis.settings.pxPerMm > 0 ? areaMm2(c.area, analysis.settings.pxPerMm) : undefined,
    cx: c.cx,
    cy: c.cy,
    bbox_x: c.bbox.x,
    bbox_y: c.bbox.y,
    bbox_w: c.bbox.w,
    bbox_h: c.bbox.h,
  })), [analysis]);

  if (!analysis) return (
    <Card title="Results">
      <div className="faint" style={{ padding: 24, textAlign: 'center' }}>Load an image in the Image tab first.</div>
    </Card>
  );

  const sizes = analysis.components.map((c) => c.area);
  const s = summary(sizes);
  const count = analysis.components.length;
  const cfu = volume > 0 ? cfuPerMl(count, 10 ** exponent, volume) : NaN;
  const flag = countableRangeFlag(count);
  const scale = analysis.settings.pxPerMm;
  const csv = () => downloadText('image_counts.csv', toCsv(rows.map((r) => ({
    id: r.id, area_px: r.area_px, area_mm2: r.area_mm2 === undefined ? '' : r.area_mm2.toFixed(4),
    cx: r.cx.toFixed(2), cy: r.cy.toFixed(2), bbox_x: r.bbox_x, bbox_y: r.bbox_y, bbox_w: r.bbox_w, bbox_h: r.bbox_h,
  }))), 'text/csv');
  const savePng = () => {
    const c = document.createElement('canvas');
    drawAnnotated(c, analysis);
    c.toBlob((b) => { if (b) downloadBlob('image_annotated.png', b); }, 'image/png');
  };

  return (
    <div className="stack">
      <div className="cols-4">
        <Stat label="Count" value={fmt(count, 0)} hint={`threshold ${fmt(analysis.threshold, 0)}`} />
        <Stat label="Mean area" value={`${fmt(s.mean, 1)} px`} hint={scale > 0 ? `${fmt(areaMm2(s.mean, scale), 3)} mm²` : 'set a scale for mm²'} />
        <Stat label="Median area" value={`${fmt(s.median, 1)} px`} hint={`sd ${fmt(s.sd, 1)} px`} />
        <Stat label="Size range" value={`${fmt(s.min, 0)}–${fmt(s.max, 0)} px`} hint={`n = ${s.n}`} />
      </div>

      {expected !== null && <Callout>{`Demo check: ${count} of ${expected} expected objects.`}</Callout>}
      {flag && <Callout kind="warn">{`Count ${flag}.`}</Callout>}

      <Card title="Objects" sub={scale > 0 ? `Areas in mm² use ${fmt(scale, 2)} px/mm.` : 'Set pixels per mm in the Image tab to show mm².'} pad={false} actions={
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={csv} disabled={!count}>Download CSV</button>
          <button className="btn sm" onClick={savePng}>Save annotated PNG</button>
        </div>}>
        {!count ? <div className="faint" style={{ padding: 20, textAlign: 'center' }}>No objects pass the current size filter.</div> : (
          <DataTable rows={rows} rowKey={(r) => String(r.id)} limit={400} cols={[
            { key: 'id', label: 'ID', num: true, sort: (r) => r.id },
            { key: 'area_px', label: 'Area (px)', num: true, sort: (r) => r.area_px, render: (r) => fmt(r.area_px, 0) },
            ...(scale > 0 ? [{ key: 'area_mm2', label: 'Area (mm²)', num: true, sort: (r: typeof rows[number]) => r.area_mm2 ?? 0, render: (r: typeof rows[number]) => fmt(r.area_mm2 ?? 0, 3) }] : []),
            { key: 'cx', label: 'Centroid x', num: true, sort: (r) => r.cx, render: (r) => fmt(r.cx, 1) },
            { key: 'cy', label: 'Centroid y', num: true, sort: (r) => r.cy, render: (r) => fmt(r.cy, 1) },
            { key: 'bbox', label: 'Bounding box', render: (r) => `${r.bbox_x}, ${r.bbox_y} · ${r.bbox_w} × ${r.bbox_h}` },
          ]} />
        )}
      </Card>

      <Card title="Size distribution" sub="Filtered object area in pixels">
        <Histogram values={sizes} label="Object area (px)" bins={Math.min(40, Math.max(6, Math.ceil(Math.sqrt(Math.max(1, sizes.length))))) } height={230} />
      </Card>

      <Card title="CFU/mL" sub="count × dilution factor / volume plated">
        <div className="grid-3">
          <Field label="Count"><input value={count.toLocaleString()} readOnly /></Field>
          <Field label="Dilution (10^-x plated)"><input type="number" min={0} max={12} step={1} value={exponent} onChange={(e) => setExponent(Math.max(0, Number(e.target.value)))} /></Field>
          <Field label="Volume plated (mL)"><input type="number" min={0.001} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></Field>
        </div>
        <div className="row" style={{ gap: 18, marginTop: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div><span className="faint" style={{ fontSize: 12 }}>CFU/mL</span><div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{Number.isFinite(cfu) ? fmt(cfu, 0) : '–'}</div></div>
          <div className="faint" style={{ fontSize: 12 }}>Dilution factor {fmt(10 ** exponent, 0)}; plated {fmt(volume, 3)} mL. Confirm the dilution on your plate record.</div>
        </div>
      </Card>
    </div>
  );
}
