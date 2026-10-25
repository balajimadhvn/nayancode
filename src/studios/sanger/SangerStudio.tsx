import { lazy, Suspense, useMemo, useState } from 'react';
import { Tabs } from '@/ui/kit';
import type { AbifTrace } from './abif';
import { mottTrim, windowTrim } from './trim';
import type { TrimMethod } from './TrimTab';

const TraceTab = lazy(() => import('./TraceTab'));
const TrimTab = lazy(() => import('./TrimTab'));
const CompareTab = lazy(() => import('./CompareTab'));

type Tab = 'trace' | 'trim' | 'compare';

export default function SangerStudio() {
  const [tab, setTab] = useState<Tab>('trace');
  const [trace, setTrace] = useState<AbifTrace | null>(null);
  const [method, setMethod] = useState<TrimMethod>('mott');
  const [cutoff, setCutoff] = useState(0.05);
  const [window, setWindow] = useState(10);
  const [minMean, setMinMean] = useState(20);

  const range = useMemo<[number, number]>(() => {
    if (!trace || !trace.quality.length) return [0, 0];
    return method === 'mott' ? mottTrim(trace.quality, cutoff) : windowTrim(trace.quality, window, minMean);
  }, [trace, method, cutoff, window, minMean]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Sanger Studio</h1><p>Open an Applied Biosystems trace, inspect the electropherogram and mixed peaks, trim by quality, and compare the read with a reference. Files stay in your browser.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'trace', label: 'Trace' }, { id: 'trim', label: 'Trim & export' }, { id: 'compare', label: 'Compare' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'trace' && <TraceTab trace={trace} onTrace={setTrace} />}
        {tab === 'trim' && <TrimTab trace={trace} method={method} setMethod={setMethod} cutoff={cutoff} setCutoff={setCutoff}
          window={window} setWindow={setWindow} minMean={minMean} setMinMean={setMinMean} range={range} />}
        {tab === 'compare' && <CompareTab trace={trace} range={range} />}
      </Suspense>
    </div>
  );
}
