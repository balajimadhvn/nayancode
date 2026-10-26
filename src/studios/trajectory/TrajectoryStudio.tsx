import { useEffect, useMemo, useRef, useState } from 'react';
import { clearHandoffSoon, useHandoff } from '@/core/handoff';
import { Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, toCsv } from '@/ui/kit';
import { CurvePlot, Heatmap, Scatter, cssVar } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { convertTimeUnit, describeSeries, parseXvg, type XvgData, type SeriesStats } from './xvg';
import { freeEnergy2D, pca, parsePdbTrajectory, radiusOfGyration, rmsd, rmsfByResidue, type Frame, type PcaResult, type ResidueRmsf, type Selection } from './traj';

type Tab = 'xvg' | 'traj' | 'landscape';

const COLORS = () => [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d'), '#3fb97a', '#b45fd1', '#e0a13a', '#4aa3df'];

// ---------------------------------------------------------------- demo data
const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

function demoXvg(): string {
  const r = mulberry32(5);
  const lines = ['# synthetic GROMACS-style output for the demonstration', '@    title "Backbone RMSD and radius of gyration"', '@    xaxis  label "Time (ps)"', '@    yaxis  label "nm"', '@ s0 legend "Backbone RMSD"', '@ s1 legend "Rg"'];
  for (let t = 0; t <= 5000; t += 10) {
    const rmsdN = 0.08 + 0.5 * Math.exp(-t / 900) + 0.012 * gauss(r);
    const rg = 1.42 + 0.03 * Math.exp(-t / 1500) + 0.008 * gauss(r);
    lines.push(`${t} ${rmsdN.toFixed(5)} ${rg.toFixed(5)}`);
  }
  return lines.join('\n');
}

function demoFrames(): Frame[] {
  const r = mulberry32(17);
  const residues = 18;
  const base = Array.from({ length: residues }, (_, i) => ({ name: 'CA', res: 'ALA', chain: 'A', seq: i + 1, x: i * 3.6, y: 2.4 * Math.sin(i * 0.7), z: 0, el: 'C' }));
  const v = base.map((_, i) => (i % 2 === 0 ? 1 : -1));
  const vn = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return Array.from({ length: 80 }, (_, f) => {
    const amp = 1.1 * Math.sin((2 * Math.PI * f) / 40) + 0.25 * gauss(r);
    const twist = 0.05 * Math.sin((2 * Math.PI * f) / 13);
    return base.map((a, i) => ({
      ...a,
      x: a.x + (amp * v[i]) / vn + 0.08 * gauss(r),
      y: a.y + twist * (i - residues / 2) + 0.08 * gauss(r),
      z: 0.08 * gauss(r),
    }));
  });
}

interface TrajResult {
  frames: Frame[];
  sel: string;
  rmsd: number[];
  residues: ResidueRmsf[];
  rg: number[];
  pca: PcaResult | null;
  pcaError: string;
}

const analyse = (frames: Frame[], sel: Selection): TrajResult => {
  let pcaRes: PcaResult | null = null;
  let pcaError = '';
  try { pcaRes = pca(frames, sel, 3); } catch (e) { pcaError = (e as Error).message; }
  return {
    frames,
    sel: typeof sel === 'string' ? sel : 'custom',
    rmsd: rmsd(frames, sel),
    residues: rmsfByResidue(frames, sel),
    rg: frames.map((f) => radiusOfGyration(f)),
    pca: pcaRes,
    pcaError,
  };
};

export default function TrajectoryStudio() {
  const [tab, setTab] = useState<Tab>('traj');
  const [files, setFiles] = useState<{ name: string; data?: XvgData; error?: string }[]>([]);
  const [unit, setUnit] = useState<'native' | 'ns' | 'us'>('native');
  const [trajName, setTrajName] = useState('');
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [sel, setSel] = useState<'ca' | 'backbone' | 'heavy' | 'all'>('ca');
  const [result, setResult] = useState<TrajResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [trajError, setTrajError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const mdHand = useHandoff((s) => s.mdTrajectory);

  const addXvg = (items: { name: string; text: string }[]) => {
    setFiles((prev) => {
      const next = [...prev];
      for (const it of items) {
        try { next.push({ name: it.name, data: parseXvg(it.text) }); } catch (e) { next.push({ name: it.name, error: (e as Error).message }); }
      }
      return next;
    });
  };

  const loadTrajectory = (text: string, name: string) => {
    try {
      const fr = parsePdbTrajectory(text);
      if (!fr.length) throw new Error('No ATOM records found in the file.');
      if (fr.length > 5000) throw new Error(`The file has ${fr.length} frames; this viewer is limited to 5,000.`);
      if (!fr[0].length) throw new Error('The first frame has no atoms.');
      setFrames(fr); setTrajName(name); setTrajError(''); setResult(null); setTab('traj');
    } catch (e) { setFrames(null); setResult(null); setTrajError((e as Error).message); }
  };

  useEffect(() => {
    if (!mdHand) return;
    if (mdHand.xvg.length) addXvg(mdHand.xvg);
    loadTrajectory(mdHand.pdb, mdHand.label);
    clearHandoffSoon('mdTrajectory');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mdHand]);

  const runAnalysis = (fr: Frame[] = frames ?? [], selection: Selection = sel) => {
    if (!fr.length) return;
    setBusy(true); setTrajError('');
    setTimeout(() => {
      try { setResult(analyse(fr, selection)); } catch (e) { setResult(null); setTrajError((e as Error).message); } finally { setBusy(false); }
    }, 25);
  };

  const loadDemo = () => {
    const fr = demoFrames();
    setFrames(fr); setTrajName('synthetic planted-motion trajectory (80 frames)'); setTrajError(''); setTab('traj'); setSel('ca');
    runAnalysis(fr, 'ca');
  };

  const unitFactor = unit === 'native' ? 1 : unit === 'ns' ? convertTimeUnit(1, 'ps', 'ns') : convertTimeUnit(1, 'ps', 'us');

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Trajectory Studio</h1><p>Read GROMACS time series and multi-model PDB trajectories from simulations you ran elsewhere, then compute convergence statistics, RMSD, RMSF, radius of gyration, essential dynamics and free-energy landscapes in your browser.</p></div>
        <div className="row"><button className="btn primary" onClick={loadDemo}>Load demo trajectory</button></div></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'xvg', label: 'Time series (XVG)' }, { id: 'traj', label: 'Trajectory (PDB models)' }, { id: 'landscape', label: 'Energy landscape' }]} />

      {tab === 'xvg' && (
        <div className="stack">
          <div className="split">
            <div className="stack">
              <Card title="1 · GROMACS .xvg files"><div className="stack" style={{ gap: 10 }}>
                <div className="dropzone" role="button" tabIndex={0} onClick={() => fileInput.current?.click()} onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const fs = [...e.dataTransfer.files]; void readAll(fs).then(addXvg); }}>
                  <div>Drop one or several .xvg files, or click to browse</div>
                  <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Read locally. Never uploaded.</div>
                  <input ref={fileInput} type="file" accept=".xvg,.txt,.dat" multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; void readAll(fs).then(addXvg); e.target.value = ''; }} />
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={() => addXvg([{ name: 'demo-rmsd.xvg', text: demoXvg() }])}>Load demo</button>
                  <button className="btn ghost" disabled={!files.length} onClick={() => setFiles([])}>Clear</button>
                </div>
                <Field label="Time axis"><select className="select" value={unit} onChange={(e) => setUnit(e.target.value as 'native' | 'ns' | 'us')}>
                  <option value="native">As in the file (assumed ps)</option><option value="ns">Convert ps → ns</option><option value="us">Convert ps → µs</option>
                </select></Field>
                {files.map((f) => <div key={f.name} className="faint" style={{ fontSize: 12 }}>{f.name}{f.data ? ` · ${f.data.series.length} series · ${f.data.x.length} rows` : ''}{f.error ? ` · error: ${f.error}` : ''}</div>)}
              </div></Card>
              <Callout>Statistics follow Flyvbjerg &amp; Petersen: the block-averaged standard error uses five blocks, and the integrated autocorrelation time is ½ + Σρ<sub>k</sub>, summed until the first negative autocorrelation. The final-quarter mean is the converged-value estimate.</Callout>
            </div>
            <XvgStats files={files} factor={unitFactor} />
          </div>
          <XvgPlots files={files} factor={unitFactor} />
        </div>
      )}

      {tab === 'traj' && (
        <div className="split">
          <div className="stack">
            <Card title="1 · Multi-model PDB"><div className="stack" style={{ gap: 10 }}>
              <FileDrop accept=".pdb,.ent,.txt" label={trajName || 'Drop a multi-model PDB (MODEL / ENDMDL blocks)'} onText={(t, n) => loadTrajectory(t, n)} />
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn" onClick={loadDemo}>Load demo</button>
                <button className="btn primary" disabled={!frames?.length || busy} onClick={() => runAnalysis()}>{busy ? 'Analysing…' : 'Analyse'}</button>
              </div>
              <Field label="Selection for the fit and PCA"><select className="select" value={sel} onChange={(e) => { const s = e.target.value as typeof sel; setSel(s); if (frames) runAnalysis(frames, s); }}>
                <option value="ca">Cα atoms</option><option value="backbone">Backbone (N, CA, C, O)</option><option value="heavy">All heavy atoms</option><option value="all">All atoms</option>
              </select></Field>
              <div className="faint" style={{ fontSize: 11.5 }}>Frames are fitted on the selection with the Kabsch algorithm; all atoms receive the same transform. The file must not exceed 200 MB and 5,000 frames.</div>
              {trajError && <Callout kind="err">{trajError}</Callout>}
              {frames && <div className="faint" style={{ fontSize: 12 }}>{frames.length} frames · {frames[0].length} atoms per frame · {frames[0].filter((a) => a.name === 'CA').length} Cα</div>}
              <Callout kind="warn">Analyses of simulations you ran elsewhere. Binary XTC/TRR/DCD files are not read: convert with <code>gmx trjconv -o traj.pdb</code> (or use <code>.xvg</code> outputs). No simulations run in the browser.</Callout>
            </div></Card>
            <Card title="Method notes"><div className="faint" style={{ fontSize: 12 }}>
              RMSD is measured after superposition to the first frame. RMSF is the fluctuation around the mean structure after superposition, corrected for the six global degrees of freedom removed by the fit. The radius of gyration is mass-unweighted. Essential dynamics follows Amadei et al. (1993): principal components of the covariance matrix of the fitted coordinates (limit 300 selected atoms).
            </div></Card>
          </div>
          <TrajResults result={result} busy={busy} />
        </div>
      )}

      {tab === 'landscape' && <Landscape result={result} />}
    </div>
  );
}

async function readAll(files: File[]): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  for (const f of files) out.push({ name: f.name, text: await f.text() });
  return out;
}

// ---------------------------------------------------------------- XVG view
function XvgStats({ files, factor }: { files: { name: string; data?: XvgData; error?: string }[]; factor: number }) {
  const rows = useMemo(() => {
    const out: ({ file: string; series: string } & SeriesStats)[] = [];
    for (const f of files) {
      if (!f.data) continue;
      f.data.series.forEach((ys, i) => {
        const x = f.data!.x.map((v) => v * factor);
        out.push({ file: f.name, series: f.data!.legends[i] ?? `Series ${i + 1}`, ...describeSeries(x, ys) });
      });
    }
    return out;
  }, [files, factor]);

  if (!files.length) return <Card title="2 · Convergence statistics"><div className="faint" style={{ padding: 40, textAlign: 'center' }}>Load one or more .xvg files to see convergence statistics.</div></Card>;
  if (!rows.length) return <Card title="2 · Convergence statistics"><div className="faint" style={{ padding: 24 }}>No readable series yet.</div></Card>;
  return (
    <Card title="2 · Convergence statistics" sub={`${rows.length} series`}>
      <DataTable rowKey={(r) => r.file + r.series} rows={rows} limit={200} cols={[
        { key: 'file', label: 'File' }, { key: 'series', label: 'Series' },
        { key: 'n', label: 'n', num: true },
        { key: 'mean', label: 'Mean', num: true, render: (r) => fmt(r.mean, 4) },
        { key: 'sd', label: 'SD', num: true, render: (r) => fmt(r.sd, 4) },
        { key: 'min', label: 'Min', num: true, render: (r) => fmt(r.min, 4) },
        { key: 'max', label: 'Max', num: true, render: (r) => fmt(r.max, 4) },
        { key: 'conv', label: 'Converged (final quarter)', num: true, render: (r) => fmt(r.finalQuarterMean, 4) },
        { key: 'se', label: 'Block SE', num: true, render: (r) => fmt(r.blockSE, 4) },
        { key: 'drift', label: 'Drift per unit', num: true, render: (r) => fmt(r.drift, 5) },
        { key: 'tau', label: 'τ_int (frames)', num: true, render: (r) => fmt(r.autocorrelationTime, 2) },
        { key: 'eq', label: 'Equilibration', render: (r) => (r.equilibrationTime === null ? 'not reached' : fmt(r.equilibrationTime, 2)) },
      ]} />
      <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => downloadText('xvg_statistics.csv', toCsv(rows), 'text/csv')}>Export CSV</button></div>
    </Card>
  );
}

function XvgPlots({ files, factor }: { files: { name: string; data?: XvgData; error?: string }[]; factor: number }) {
  const cols = COLORS();
  const series: CurveSeries[] = [];
  for (const f of files) {
    if (!f.data) continue;
    f.data.series.forEach((ys, i) => {
      const x = f.data!.x.map((v) => v * factor);
      series.push({ name: `${f.name} · ${f.data!.legends[i] ?? i + 1}`, color: cols[series.length % cols.length], curve: x.map((xv, k) => ({ x: xv, y: ys[k] })) });
    });
  }
  if (!series.length) return null;
  const title = files.find((f) => f.data)?.data?.title || 'Time series';
  const xLabel = files.find((f) => f.data)?.data?.xLabel || 'Time';
  const yLabel = files.find((f) => f.data)?.data?.yLabel || 'Value';
  return <Card title={title} sub="overlay of every loaded series"><CurvePlot spec={{ series, xLabel, yLabel }} height={360} exportName="xvg-series" /></Card>;
}

// ---------------------------------------------------------------- trajectory view
function TrajResults({ result, busy }: { result: TrajResult | null; busy: boolean }) {
  if (busy && !result) return <Card><div className="faint" style={{ padding: 40, textAlign: 'center' }}>Analysing the trajectory…</div></Card>;
  if (!result) return <Card><div className="faint" style={{ padding: 40, textAlign: 'center' }}>Load a multi-model PDB (or the demo) and press Analyse.</div></Card>;
  const cols = COLORS();
  const rmsdSeries: CurveSeries = { name: 'RMSD to frame 1', color: cols[0], curve: result.rmsd.map((v, i) => ({ x: i + 1, y: v })) };
  const rgSeries: CurveSeries = { name: 'Rg (all atoms)', color: cols[1], curve: result.rg.map((v, i) => ({ x: i + 1, y: v })) };
  const rmsfSeries: CurveSeries = { name: 'RMSF per residue', color: cols[2], curve: result.residues.map((r, i) => ({ x: i + 1, y: r.rmsf })) };
  const meanRmsd = result.rmsd.reduce((s, v) => s + v, 0) / Math.max(1, result.rmsd.length);
  const pc = result.pca;
  const scatter = pc ? pc.projections.map((p, i) => ({ x: p[0] ?? 0, y: p[1] ?? 0, cat: Math.min(5, Math.floor((i / Math.max(1, pc.projections.length)) * 6)), label: `Frame ${i + 1}` })) : [];
  const names = Array.from({ length: 6 }, (_, k) => {
    const from = Math.floor((k / 6) * result.frames.length) + 1;
    const to = Math.max(from, Math.floor(((k + 1) / 6) * result.frames.length));
    return `frames ${from}–${to}`;
  });
  return (
    <div className="stack">
      <div className="cols-3">
        <Stat label="Frames" value={String(result.frames.length)} />
        <Stat label="Mean RMSD" value={`${fmt(meanRmsd, 3)} Å`} hint="after superposition to frame 1" />
        <Stat label="Mean Rg" value={`${fmt(result.rg.reduce((s, v) => s + v, 0) / Math.max(1, result.rg.length), 2)} Å`} hint="mass-unweighted" />
      </div>
      <Card title="RMSD after superposition to frame 1"><CurvePlot spec={{ series: [rmsdSeries], xLabel: 'Frame', yLabel: 'RMSD (Å)', yMin: 0 }} height={280} exportName="trajectory-rmsd" /></Card>
      <Card title="RMSF per residue" sub="fluctuation around the mean structure"><CurvePlot spec={{ series: [rmsfSeries], xLabel: 'Residue index', yLabel: 'RMSF (Å)', yMin: 0 }} height={280} exportName="trajectory-rmsf" /></Card>
      <Card title="Radius of gyration"><CurvePlot spec={{ series: [rgSeries], xLabel: 'Frame', yLabel: 'Rg (Å)' }} height={240} exportName="trajectory-rg" /></Card>
      <Card title="Essential dynamics: PC1 vs PC2" sub={pc ? `PC1 ${fmt(pc.explained[0] * 100, 1)} % of variance` : undefined}>
        {pc ? <Scatter points={scatter} colors={cols} names={names} xLabel={`PC1 (${fmt(pc.explained[0] * 100, 1)} %)`} yLabel={`PC2 (${fmt((pc.explained[1] ?? 0) * 100, 1)} %)`} height={340} exportName="trajectory-pca" /> : <Callout kind="warn">{result.pcaError || 'PCA is not available for this selection.'}</Callout>}
      </Card>
      {pc && <Card title="Principal components" pad={false}><DataTable rowKey={(r) => r.pc} rows={pc.eigenvalues.map((e, i) => ({ pc: `PC${i + 1}`, eigen: e, explained: pc.explained[i] }))} cols={[
        { key: 'pc', label: 'Component' }, { key: 'eigen', label: 'Eigenvalue (Å²)', num: true, render: (r) => fmt(r.eigen, 3) }, { key: 'explained', label: 'Variance explained', num: true, render: (r) => `${fmt(r.explained * 100, 2)} %` },
      ]} /></Card>}
      <div className="row"><button className="btn sm" onClick={() => downloadText('trajectory_analysis.csv', toCsv([
        ...result.rmsd.map((v, i) => ({ quantity: 'rmsd_A', frame: i + 1, value: v })),
        ...result.rg.map((v, i) => ({ quantity: 'rg_A', frame: i + 1, value: v })),
        ...result.residues.map((r) => ({ quantity: 'rmsf_A', frame: r.label, value: r.rmsf })),
        ...(pc ? pc.projections.flatMap((p, i) => p.map((v, k) => ({ quantity: `PC${k + 1}`, frame: i + 1, value: v }))) : []),
      ]), 'text/csv')}>Export CSV</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- landscape
function Landscape({ result }: { result: TrajResult | null }) {
  const land = useMemo(() => {
    if (!result?.pca || result.pca.projections.length < 2) return null;
    const x = result.pca.projections.map((p) => p[0]);
    const y = result.pca.projections.map((p) => p[1]);
    const fe = freeEnergy2D(x, y, 40, 300);
    let lo = Infinity, hi = -Infinity;
    for (const row of fe) for (const v of row) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) return null;
    const span = hi - lo || 1;
    const z = fe.map((row) => row.map((v) => (Number.isFinite(v) ? ((v - lo) / span) * 4 - 2 : 0)));
    const [xMin, xMax] = [Math.min(...x), Math.max(...x)];
    const [yMin, yMax] = [Math.min(...y), Math.max(...y)];
    const axis = (a: number, b: number) => Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? fmt(a + ((b - a) * i) / 39, 1) : ''));
    return { z, rows: axis(xMin, xMax), cols: axis(yMin, yMax), min: lo, max: hi };
  }, [result]);
  if (!result) return <Card><div className="faint" style={{ padding: 40, textAlign: 'center' }}>Analyse a trajectory first; the landscape is built from its first two principal components.</div></Card>;
  if (!land) return <Callout kind="warn">The free-energy landscape needs at least two frames and two principal components. {result.pcaError}</Callout>;
  return (
    <div className="stack">
      <Callout>Free energy is F = −kT ln(P/P<sub>max</sub>) with kT = 2.494 kJ mol⁻¹ at 300 K on a 40 × 40 grid of PC1 and PC2. Empty bins are shown neutral. The landscape is a projection: slow coordinates not captured by PC1/PC2 are invisible.</Callout>
      <Card title="Free-energy landscape (PC1 × PC2)" sub={`range ${fmt(land.min, 2)}–${fmt(land.max, 2)} kJ/mol`}>
        <Heatmap rows={land.rows} cols={land.cols} z={land.z} height={480} />
        <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Rows: PC1; columns: PC2. Colours span the sampled free-energy range (blue low, red high); empty bins are neutral.</div>
      </Card>
    </div>
  );
}
