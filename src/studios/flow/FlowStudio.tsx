import { lazy, Suspense, useMemo, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';
import type { FcsFile } from './fcs';
import { gateStats, type GateNode } from './gate';
import { applyTransform, type TransformSpec } from './transform';

const DataTab = lazy(() => import('./DataTab'));
const CompensationTab = lazy(() => import('./CompensationTab'));
const GatingTab = lazy(() => import('./GatingTab'));
const StatisticsTab = lazy(() => import('./StatisticsTab'));

export type FlowTab = 'data' | 'compensation' | 'gating' | 'statistics';
const NOTE = 'Research use only. Gates are drawn on transformed data; compensation is only as good as the spillover matrix. Biexponential/logicle scaling is not included (arcsinh is used instead).';

export default function FlowStudio() {
  const [tab, setTab] = useState<FlowTab>('data');
  const [parsed, setParsed] = useState<FcsFile | null>(null);
  const [columns, setColumns] = useState<Float64Array[]>([]);
  const [transforms, setTransforms] = useState<Record<string, TransformSpec>>({});
  const [gates, setGates] = useState<GateNode[]>([]);
  const [gx, setGx] = useState('');
  const [gy, setGy] = useState('');
  const [channels, setChannels] = useState<string[]>([]);
  const [demo, setDemo] = useState(false);

  const takeFile = (file: FcsFile, isDemo: boolean) => {
    setParsed(file);
    setColumns(file.events.map((c) => Float64Array.from(c)));
    const next: Record<string, TransformSpec> = {};
    for (const p of file.params) next[p.name] = { kind: /^(FSC|SSC)/i.test(p.name) ? 'none' : 'arcsinh', cofactor: 150 };
    setTransforms(next);
    setGates([]);
    setGx(file.params[0]?.name ?? '');
    setGy(file.params[1]?.name ?? '');
    setChannels(file.params.slice(0, 3).map((p) => p.name));
    setDemo(isDemo);
  };

  const transformed = useMemo(() => {
    const out: Record<string, Float64Array> = {};
    parsed?.params.forEach((p, i) => { out[p.name] = applyTransform(columns[i] ?? new Float64Array(0), transforms[p.name] ?? { kind: 'none' }); });
    return out;
  }, [parsed, columns, transforms]);
  const raw = useMemo(() => {
    const out: Record<string, Float64Array> = {};
    parsed?.params.forEach((p, i) => { out[p.name] = columns[i] ?? new Float64Array(0); });
    return out;
  }, [parsed, columns]);
  const stats = useMemo(() => (parsed ? gateStats(gates, transformed, raw, channels) : []), [parsed, gates, transformed, raw, channels]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Flow Studio</h1><p>Open an FCS 3.0/3.1 file, apply spillover compensation, draw rect, polygon or ellipse gates, and summarise populations. Files stay in your browser.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'data', label: 'Data' }, { id: 'compensation', label: 'Compensation' }, { id: 'gating', label: 'Gating' }, { id: 'statistics', label: 'Statistics' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'data' && <DataTab parsed={parsed} transforms={transforms} setTransforms={setTransforms} onFile={takeFile} />}
        {tab === 'compensation' && <CompensationTab parsed={parsed} columns={columns} setColumns={setColumns} />}
        {tab === 'gating' && <GatingTab parsed={parsed} transformed={transformed} gates={gates} setGates={setGates} gx={gx} gy={gy} setGx={setGx} setGy={setGy} stats={stats} demo={demo} />}
        {tab === 'statistics' && <StatisticsTab parsed={parsed} transformed={transformed} gates={gates} stats={stats} channels={channels} setChannels={setChannels} gx={gx} gy={gy} />}
      </Suspense>
      <Callout kind="warn">{NOTE}</Callout>
      <div className="faint" style={{ fontSize: 11.5 }}>Format: Spidlen J, et al. (2010) Data File Standard for Flow Cytometry, version FCS 3.1. Cytometry A 77:97–100.</div>
    </div>
  );
}
