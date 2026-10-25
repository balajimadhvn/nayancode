import { useEffect, useMemo, useRef, useState } from 'react';
import { Callout, Card, DataTable, Field, downloadBlob, fmt } from '@/ui/kit';
import type { FcsFile } from './fcs';
import type { Gate, GateNode, GateStat } from './gate';
import { DEMO_LYMPH_GATE } from './demo';
import DensityPlot from './DensityPlot';

interface Props {
  parsed: FcsFile | null;
  transformed: Record<string, Float64Array>;
  gates: GateNode[];
  setGates(g: GateNode[]): void;
  gx: string; gy: string;
  setGx(x: string): void; setGy(y: string): void;
  stats: GateStat[];
  demo: boolean;
}

const EMPTY = new Float64Array(0);
const extent = (a: ArrayLike<number>): [number, number] => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
  return Number.isFinite(lo) && hi > lo ? [lo, hi] : [0, 1];
};

export default function GatingTab({ parsed, transformed, gates, setGates, gx, gy, setGx, setGy, stats, demo }: Props) {
  const [kind, setKind] = useState<'rect' | 'ellipse'>('rect');
  const [name, setName] = useState('');
  const [rect, setRect] = useState({ xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
  const [ellipse, setEllipse] = useState({ cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, angle: 0 });
  const [parent, setParent] = useState('');
  const [polygonMode, setPolygonMode] = useState(false);
  const [pending, setPending] = useState<[number, number][]>([]);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const [x0, x1] = extent(transformed[gx] ?? EMPTY), [y0, y1] = extent(transformed[gy] ?? EMPTY);
    setRect({ xmin: x0, xmax: x1, ymin: y0, ymax: y1 });
    setEllipse({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 4, ry: (y1 - y0) / 4, angle: 0 });
  }, [gx, gy, parsed, transformed]);

  const statById = useMemo(() => new Map(stats.map((s) => [s.id, s])), [stats]);
  if (!parsed) return <Card title="Gating"><div className="faint" style={{ padding: 24, textAlign: 'center' }}>Load an FCS file in the Data tab first.</div></Card>;

  const nextId = () => {
    let n = gates.length + 1;
    while (gates.some((g) => g.id === `g${n}`)) n++;
    return `g${n}`;
  };
  const add = (gate: Gate, label: string) => {
    setGates([...gates, { id: nextId(), name: label, gate, parent: parent || null }]);
    setName(''); setError(''); setPolygonMode(false); setPending([]);
  };
  const addNumeric = () => {
    if (kind === 'rect') {
      if (!(rect.xmax > rect.xmin) || !(rect.ymax > rect.ymin)) { setError('The rectangle needs xmax > xmin and ymax > ymin.'); return; }
      add({ type: 'rect', x: gx, y: gy, ...rect }, name.trim() || `Rect ${gates.length + 1}`);
    } else {
      if (!(ellipse.rx > 0) || !(ellipse.ry > 0)) { setError('The ellipse radii must be greater than zero.'); return; }
      add({ type: 'ellipse', x: gx, y: gy, ...ellipse }, name.trim() || `Ellipse ${gates.length + 1}`);
    }
  };
  const finishPolygon = () => {
    if (pending.length < 3) { setError('A polygon needs at least three vertices.'); return; }
    add({ type: 'polygon', x: gx, y: gy, points: pending }, name.trim() || `Polygon ${gates.length + 1}`);
  };
  const remove = (id: string) => setGates(gates.filter((g) => g.id !== id).map((g) => (g.parent === id ? { ...g, parent: null } : g)));
  const descendants = (id: string) => {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of gates) if (g.parent && out.has(g.parent) && !out.has(g.id)) { out.add(g.id); grew = true; }
    }
    return out;
  };
  const setGateParent = (id: string, value: string) => setGates(gates.map((g) => (g.id === id ? { ...g, parent: value || null } : g)));
  const hasDemoAxes = demo && parsed.params.some((p) => p.name === 'FSC-A') && parsed.params.some((p) => p.name === 'SSC-A');

  return (
    <div className="stack">
      <Card title="Density plot" sub="2-D histogram on transformed values; up to 200,000 events are drawn, all events are gated." actions={
        <button className="btn sm" onClick={() => canvas.current?.toBlob((b) => { if (b) downloadBlob('flow-gating.png', b); }, 'image/png')}>Export PNG</button>
      }>
        <div className="grid-2">
          <Field label="X parameter"><select value={gx} onChange={(e) => setGx(e.target.value)}>{parsed.params.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</select></Field>
          <Field label="Y parameter"><select value={gy} onChange={(e) => setGy(e.target.value)}>{parsed.params.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</select></Field>
        </div>
        <div style={{ marginTop: 10 }}>
          <DensityPlot canvasRef={canvas} x={transformed[gx] ?? EMPTY} y={transformed[gy] ?? EMPTY} xLabel={gx} yLabel={gy}
            gates={gates.filter((g) => g.gate.x === gx && g.gate.y === gy).map((g) => ({ name: g.name, gate: g.gate }))}
            pendingPoints={pending} onPick={polygonMode ? (x, y) => setPending((p) => [...p, [x, y]]) : undefined} />
        </div>
        {polygonMode && <Callout>Click the plot to add polygon vertices ({pending.length} so far). Then finish or cancel below.</Callout>}
      </Card>

      <Card title="Add a gate" sub="Coordinates are in the transformed space of the chosen axes.">
        <div className="grid-3">
          <Field label="Type"><select value={kind} onChange={(e) => setKind(e.target.value as 'rect' | 'ellipse')}><option value="rect">Rectangle</option><option value="ellipse">Ellipse</option></select></Field>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Gate ${gates.length + 1}`} /></Field>
          <Field label="Nest under"><select value={parent} onChange={(e) => setParent(e.target.value)}><option value="">(root)</option>{gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        </div>
        {kind === 'rect' ? <div className="grid-4" style={{ marginTop: 10 }}>
          <Field label="x min"><input type="number" step="any" value={rect.xmin} onChange={(e) => setRect({ ...rect, xmin: Number(e.target.value) })} /></Field>
          <Field label="x max"><input type="number" step="any" value={rect.xmax} onChange={(e) => setRect({ ...rect, xmax: Number(e.target.value) })} /></Field>
          <Field label="y min"><input type="number" step="any" value={rect.ymin} onChange={(e) => setRect({ ...rect, ymin: Number(e.target.value) })} /></Field>
          <Field label="y max"><input type="number" step="any" value={rect.ymax} onChange={(e) => setRect({ ...rect, ymax: Number(e.target.value) })} /></Field>
        </div> : <div className="grid-4" style={{ marginTop: 10 }}>
          <Field label="Centre x"><input type="number" step="any" value={ellipse.cx} onChange={(e) => setEllipse({ ...ellipse, cx: Number(e.target.value) })} /></Field>
          <Field label="Centre y"><input type="number" step="any" value={ellipse.cy} onChange={(e) => setEllipse({ ...ellipse, cy: Number(e.target.value) })} /></Field>
          <Field label="Radius x"><input type="number" min={0} step="any" value={ellipse.rx} onChange={(e) => setEllipse({ ...ellipse, rx: Number(e.target.value) })} /></Field>
          <Field label="Radius y"><input type="number" min={0} step="any" value={ellipse.ry} onChange={(e) => setEllipse({ ...ellipse, ry: Number(e.target.value) })} /></Field>
          <Field label="Angle (degrees)"><input type="number" step="any" value={ellipse.angle} onChange={(e) => setEllipse({ ...ellipse, angle: Number(e.target.value) })} /></Field>
        </div>}
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={addNumeric}>Add {kind}</button>
          <button className="btn sm" onClick={() => { setPolygonMode(true); setPending([]); setError(''); }}>Draw polygon</button>
          {polygonMode && <>
            <button className="btn sm" onClick={finishPolygon}>Finish polygon</button>
            <button className="btn sm" onClick={() => { setPolygonMode(false); setPending([]); }}>Cancel polygon</button>
          </>}
          {hasDemoAxes && <button className="btn sm" onClick={() => { setGx('FSC-A'); setGy('SSC-A'); setParent(''); add(DEMO_LYMPH_GATE, 'Lymphocytes (demo)'); }}>Add lymphocyte gate (demo)</button>}
        </div>
        {error && <Callout kind="err">{error}</Callout>}
      </Card>

      <Card title="Gates" sub={`${gates.length} gate${gates.length === 1 ? '' : 's'} · counts from all events`} pad={false}>
        {!gates.length ? <div className="faint" style={{ padding: 20, textAlign: 'center' }}>No gates yet. Add a rectangle, an ellipse or a polygon.</div> : (
          <DataTable rows={gates} rowKey={(g) => g.id} cols={[
            { key: 'name', label: 'Gate', render: (g) => g.name },
            { key: 'type', label: 'Type', render: (g) => g.gate.type },
            { key: 'parent', label: 'Nested under', render: (g) => (
              <select value={g.parent ?? ''} onChange={(e) => setGateParent(g.id, e.target.value)} aria-label={`Parent of ${g.name}`}>
                <option value="">(root)</option>
                {gates.filter((o) => !descendants(g.id).has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) },
            { key: 'count', label: 'Events', num: true, sort: (g) => statById.get(g.id)?.count ?? 0, render: (g) => fmt(statById.get(g.id)?.count ?? 0, 0) },
            { key: 'pct', label: '% parent', num: true, render: (g) => `${fmt(statById.get(g.id)?.percentParent ?? 0, 1)} %` },
            { key: 'remove', label: '', render: (g) => <button className="btn sm" onClick={() => remove(g.id)}>Remove</button> },
          ]} />
        )}
      </Card>
    </div>
  );
}
