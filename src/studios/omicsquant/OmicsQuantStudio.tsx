import { lazy, Suspense, useMemo, useState } from 'react';
import { Callout, Tabs } from '@/ui/kit';
import { parseGroups } from '@/studios/expression/kernels';
import {
  filterFeatures, impute, log2Transform, normalise, parseMatrix, simulateQuantDemo,
  type ImputeMethod, type NormMethod, type QuantMatrix,
} from './prep';

const DataTab = lazy(() => import('./DataTab'));
const NormaliseTab = lazy(() => import('./NormaliseTab'));
const DiffTab = lazy(() => import('./DiffTab'));
const ClusterTab = lazy(() => import('./ClusterTab'));

type Tab = 'data' | 'normalise' | 'diff' | 'cluster';

export interface OmicsView {
  raw: QuantMatrix | null;
  logged: QuantMatrix | null;
  normalised: QuantMatrix | null;
  prepared: QuantMatrix | null;
  mask: Uint8Array | null;
  groups: string[] | null;
  error: string | null;
  sheetError: string | null;
}

export interface OmicsOptions {
  minValid: number;
  norm: NormMethod;
  method: ImputeMethod;
  seed: number;
  pseudocount: boolean;
}

export default function OmicsQuantStudio() {
  const [tab, setTab] = useState<Tab>('data');
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState('');
  const [truth, setTruth] = useState<Set<string> | null>(null);
  const [minValid, setMinValid] = useState(2);
  const [norm, setNorm] = useState<NormMethod>('median');
  const [method, setMethod] = useState<ImputeMethod>('minprob');
  const [seed, setSeed] = useState(1);
  const [pseudocount, setPseudocount] = useState(false);

  const parsed = useMemo(() => {
    if (!text.trim()) return { raw: null, error: null };
    try { return { raw: parseMatrix(text), error: null }; } catch (e) { return { raw: null, error: (e as Error).message }; }
  }, [text]);
  const raw = parsed.raw;
  const groups = useMemo(() => {
    if (!raw || !sheet.trim()) return { groups: null, error: null };
    try { return { groups: parseGroups(sheet, raw.samples), error: null }; } catch (e) { return { groups: null, error: (e as Error).message }; }
  }, [raw, sheet]);
  const logged = useMemo(() => (raw ? log2Transform(raw, { addPseudocount: pseudocount }) : null), [raw, pseudocount]);
  const filtered = useMemo(() => (logged && groups.groups ? filterFeatures(logged, groups.groups, minValid) : logged), [logged, groups.groups, minValid]);
  const normalised = useMemo(() => (filtered ? normalise(filtered, norm) : null), [filtered, norm]);
  const imputed = useMemo(() => (normalised ? impute(normalised, method, { seed }) : null), [normalised, method, seed]);
  const view: OmicsView = {
    raw, logged, normalised, prepared: imputed?.matrix ?? null, mask: imputed?.mask ?? null,
    groups: groups.groups, error: parsed.error, sheetError: groups.error,
  };
  const options: OmicsOptions = { minValid, norm, method, seed, pseudocount };

  const demo = () => {
    const d = simulateQuantDemo();
    setText(d.matrix); setSheet(d.sheet); setTruth(d.planted);
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Omics Quant Studio</h1><p>Normalisation, missing-value imputation and moderated differential abundance for proteomics and metabolomics intensity matrices. Analysis runs in your browser; no data leaves the page.</p></div></div>
      <Tabs value={tab} onChange={setTab} items={[
        { id: 'data', label: 'Data & QC' },
        { id: 'normalise', label: 'Normalise & impute' },
        { id: 'diff', label: 'Differential abundance' },
        { id: 'cluster', label: 'Clustering & PCA' },
      ]} />
      <Suspense fallback={<div className="faint" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
        {tab === 'data' && <DataTab view={view} matrixText={text} sheetText={sheet} onMatrix={(t) => { setText(t); setTruth(null); }} onSheet={setSheet} demo={demo} />}
        {tab === 'normalise' && <NormaliseTab view={view} options={options} setMinValid={setMinValid} setNorm={setNorm} setMethod={setMethod} setSeed={setSeed} setPseudocount={setPseudocount} />}
        {tab === 'diff' && <DiffTab view={view} options={options} matrixText={text} sheetText={sheet} truth={truth} />}
        {tab === 'cluster' && <ClusterTab view={view} />}
      </Suspense>
      <Callout kind="warn">Imputation and normalisation choices change results; report them. For label-free DIA/DDA pipelines use the vendor/DIA-NN output as input.</Callout>
    </div>
  );
}
