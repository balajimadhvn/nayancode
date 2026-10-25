import { lazy, Suspense, useMemo, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';
import { DEFAULT_SETTINGS, analyse, type ImageSettings, type SourceImage } from './analyse';

const ImageTab = lazy(() => import('./ImageTab'));
const ResultsTab = lazy(() => import('./ResultsTab'));

type Tab = 'image' | 'results';
const NOTE = 'Automatic counts are approximate. Check the overlay; touching or very faint objects are the main source of error. Not for diagnostic use.';

export default function ImageCountStudio() {
  const [tab, setTab] = useState<Tab>('image');
  const [image, setImage] = useState<SourceImage | null>(null);
  const [settings, setSettings] = useState<ImageSettings>(DEFAULT_SETTINGS);
  const [expected, setExpected] = useState<number | null>(null);
  const analysis = useMemo(() => (image ? analyse(image, settings) : null), [image, settings]);

  const takeImage = (next: SourceImage | null, nextExpected: number | null) => {
    setImage(next); setExpected(nextExpected); setSettings(DEFAULT_SETTINGS);
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Image Counter Studio</h1><p>Count colonies, cells or particles with Otsu thresholding, area filters and watershed splitting. Images are decoded in your browser and never uploaded.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'image', label: 'Image' }, { id: 'results', label: 'Results' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'image' && <ImageTab image={image} settings={settings} analysis={analysis} expected={expected} setSettings={setSettings} onImage={takeImage} />}
        {tab === 'results' && <ResultsTab analysis={analysis} expected={expected} />}
      </Suspense>
      <Callout kind="warn">{NOTE}</Callout>
    </div>
  );
}
