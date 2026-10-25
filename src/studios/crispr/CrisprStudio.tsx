import { lazy, Suspense, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';
import type { DesignResult, ScanResult } from './crispr.worker';
import type { NucleaseId } from './guides';

const Design = lazy(() => import('./Design'));
const Offtargets = lazy(() => import('./Offtargets'));
const Oligos = lazy(() => import('./Oligos'));

type Tab = 'design' | 'offtargets' | 'oligos';
const WARNING = 'Rule-based scores are for ranking only; they are not validated predictors of cutting efficiency. Off-target search covers substitutions only (no bulges) and NGG PAM sites. Confirm guides experimentally.';

export default function CrisprStudio() {
  const [tab, setTab] = useState<Tab>('design');
  const [nuclease, setNuclease] = useState<NucleaseId>('SpCas9');
  const [design, setDesign] = useState<DesignResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [scans, setScans] = useState<Record<string, ScanResult>>({});
  const [text, setText] = useState('');
  const [bgSource, setBgSource] = useState('none');
  const [bgText, setBgText] = useState('');
  const [maxMm, setMaxMm] = useState(4);

  const apply = (r: DesignResult | null) => { setDesign(r); setSelected(r?.guides[0]?.id ?? null); setScans({}); };
  const addScan = (r: ScanResult) => setScans((prev) => ({ ...prev, [r.guideId]: r }));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>CRISPR Studio</h1><p>Find SpCas9 and Cas12a guides on both strands, rank them with a transparent rule-based score, scan a genome or your own sequence for NGG off-targets with an MIT position-weighted specificity, and turn a guide into cloning oligos. Everything runs in your browser.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'design', label: 'Design' }, { id: 'offtargets', label: 'Off-targets' }, { id: 'oligos', label: 'Oligos' }]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'design' && <Design design={design} onResult={apply} text={text} setText={setText} nuclease={nuclease} setNuclease={setNuclease} selected={selected} setSelected={setSelected} scans={scans} />}
        {tab === 'offtargets' && <Offtargets design={design} nuclease={nuclease} selected={selected} setSelected={setSelected} scans={scans} onScan={addScan} source={bgSource} setSource={setBgSource} bgText={bgText} setBgText={setBgText} maxMm={maxMm} setMaxMm={setMaxMm} />}
        {tab === 'oligos' && <Oligos design={design} selected={selected} setSelected={setSelected} />}
      </Suspense>
      <Callout kind="warn">{WARNING}</Callout>
    </div>
  );
}
