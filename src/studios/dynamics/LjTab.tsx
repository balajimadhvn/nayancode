import { useCallback, useEffect, useRef, useState } from 'react';
import { Callout, Card, Field, Stat, fmt } from '@/ui/kit';
import { CurvePlot, cssVar, useCanvas } from '@/viz/charts';
import type { CurveSeries } from '@/viz/figure';
import { detectDevice, detectGpuDetailed, rememberGpu } from '@/compute/device';
import { classifyDevice, recommendedLimits, type Tier } from '@/compute/hardware';
import { applyLjGpuThermostat, createLjGpu, disposeLjGpu, readLjGpu, runLjGpu, type LjGpuState } from './ljGpu';
import { initLj, kineticT, pressure, runLj, type LjState } from './lj';

const SIZES = [{ n: 108, cells: 3 }, { n: 256, cells: 4 }, { n: 500, cells: 5 }, { n: 864, cells: 6 }, { n: 2048, cells: 8 }];
type Engine = 'cpu' | 'gpu';
type Thermostat = 'none' | 'berendsen';
interface Snap { step: number; t: number; pos: Float64Array; L: number; temp: number; ke: number; pe: number; total: number; pressure: number; source: Engine; sps: number }
interface Hist { t: number; ke: number; pe: number; total: number; temp: number; pressure: number }

function cpuSnap(s: LjState, step: number, sps: number): Snap {
  const temp = kineticT(s);
  let ke = 0;
  for (let i = 0; i < s.vel.length; i++) ke += 0.5 * s.vel[i] * s.vel[i];
  return { step, t: step * 0.003, pos: Float64Array.from(s.pos), L: s.L, temp, ke, pe: s.pe, total: ke + s.pe, pressure: pressure(s), source: 'cpu', sps };
}

export default function LjTab() {
  const [size, setSize] = useState(108), [rho, setRho] = useState(0.8442), [temp, setTemp] = useState(1.2);
  const [thermostat, setThermostat] = useState<Thermostat>('berendsen'), [engine, setEngine] = useState<Engine>('cpu');
  const [running, setRunning] = useState(false), [snap, setSnap] = useState<Snap | null>(null), [hist, setHist] = useState<Hist[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier>('cpu-threads');
  const cpuRef = useRef<LjState | null>(null), gpuRef = useRef<LjGpuState | null>(null), stepRef = useRef(0);
  const cells = SIZES.find((s) => s.n === size)?.cells ?? 3;
  const recommend = recommendedLimits(tier).ljAtoms;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const det = await detectGpuDetailed();
      rememberGpu(det);
      if (alive) setTier(classifyDevice(detectDevice(undefined, undefined, det)).tier);
    })();
    return () => { alive = false; };
  }, []);

  const reset = useCallback(async () => {
    setRunning(false);
    disposeLjGpu(gpuRef.current); gpuRef.current = null;
    cpuRef.current = null; stepRef.current = 0; setHist([]); setNote(null);
    if (engine === 'gpu') {
      const g = await createLjGpu(cells, rho, temp, 42, 2.5, true);
      if (g) gpuRef.current = g;
      else setNote('WebGPU is unavailable for this size on this device, so the CPU path is used.');
    }
    if (!gpuRef.current) cpuRef.current = initLj(cells, rho, temp, 42, 2.5, true);
    const s = cpuRef.current;
    if (s) setSnap(cpuSnap(s, 0, 0));
    else {
      const g = gpuRef.current!;
      const r = await readLjGpu(g);
      setSnap({ step: 0, t: 0, pos: r.pos, L: g.L, temp: r.temperature, ke: 0.5 * r.vel.reduce((a, b) => a + b * b, 0), pe: r.pe, total: r.pe + 0.5 * r.vel.reduce((a, b) => a + b * b, 0), pressure: g.rho * r.temperature + r.virial / (3 * g.L ** 3), source: 'gpu', sps: 0 });
    }
  }, [cells, rho, temp, engine]);

  useEffect(() => { void reset(); }, [reset]);
  useEffect(() => () => { disposeLjGpu(gpuRef.current); gpuRef.current = null; }, []);

  useEffect(() => {
    if (!running) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      const t0 = performance.now();
      let next: Snap | null = null;
      const steps = 20, dt = 0.003;
      const g = gpuRef.current;
      if (engine === 'gpu' && g) {
        await runLjGpu(g, steps, dt);
        const r = await readLjGpu(g);
        if (thermostat === 'berendsen') applyLjGpuThermostat(g, temp, r.temperature, steps * dt, 0.5);
        let ke = 0;
        for (let i = 0; i < r.vel.length; i++) ke += 0.5 * r.vel[i] * r.vel[i];
        stepRef.current += steps;
        next = { step: stepRef.current, t: stepRef.current * dt, pos: r.pos, L: g.L, temp: r.temperature, ke, pe: r.pe, total: ke + r.pe, pressure: g.rho * r.temperature + r.virial / (3 * g.L ** 3), source: 'gpu', sps: steps / Math.max((performance.now() - t0) / 1000, 1e-9) };
      } else if (cpuRef.current) {
        const s = cpuRef.current;
        runLj(s, steps, dt, { thermostat, targetT: temp, tau: 0.5 });
        stepRef.current += steps;
        next = cpuSnap(s, stepRef.current, steps / Math.max((performance.now() - t0) / 1000, 1e-9));
      }
      if (!cancelled && next) {
        setSnap(next);
        setHist((h) => [...h.slice(-299), { t: next!.t, ke: next!.ke, pe: next!.pe, total: next!.total, temp: next!.temp, pressure: next!.pressure }]);
      }
      if (!cancelled) timer = setTimeout(() => void tick(), 40);
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [running, engine, thermostat, temp]);


  // Diagnostic hook for e2e/gpu/dynamics.spec.ts. Installed only with ?gpuParity=1.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('gpuParity')) return;
    type Win = { __ncLjParity?: () => Promise<{ gpu: boolean; maxPosDiff: number; nveDrift: number }> };
    const w = window as unknown as Win;
    w.__ncLjParity = async () => {
      const dt = 0.003, steps = 20;
      const cpu = initLj(3, 0.8442, 1.2, 42, 2.5, true);
      runLj(cpu, steps, dt);
      const g = await createLjGpu(3, 0.8442, 1.2, 42, 2.5, true);
      if (!g) return { gpu: false, maxPosDiff: NaN, nveDrift: NaN };
      await runLjGpu(g, steps, dt);
      const after = await readLjGpu(g);
      let maxPosDiff = 0;
      for (let i = 0; i < cpu.pos.length; i += 3) {
        let dx = cpu.pos[i] - after.pos[i], dy = cpu.pos[i + 1] - after.pos[i + 1], dz = cpu.pos[i + 2] - after.pos[i + 2];
        dx -= g.L * Math.round(dx / g.L); dy -= g.L * Math.round(dy / g.L); dz -= g.L * Math.round(dz / g.L);
        maxPosDiff = Math.max(maxPosDiff, Math.hypot(dx, dy, dz));
      }
      disposeLjGpu(g);
      const g2 = await createLjGpu(4, 0.8442, 1.2, 42, 2.5, true);
      if (!g2) return { gpu: true, maxPosDiff, nveDrift: NaN };
      const a = await readLjGpu(g2);
      const e = (x: typeof a) => x.pe + 0.5 * x.vel.reduce((q, v) => q + v * v, 0);
      await runLjGpu(g2, 1000, dt);
      const b = await readLjGpu(g2);
      const nveDrift = Math.abs(e(b) - e(a)) / Math.abs(e(a));
      disposeLjGpu(g2);
      return { gpu: true, maxPosDiff, nveDrift };
    };
    return () => { delete w.__ncLjParity; };
  }, []);

  const ref = useCanvas(300, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const pts = snap;
    if (!pts) return;
    const pad = 18, side = Math.min(w, h) - 2 * pad, s = side / pts.L, ox = (w - side) / 2, oy = (h - side) / 2;
    g.strokeStyle = cssVar('--border-hi'); g.strokeRect(ox, oy, side, side);
    g.fillStyle = cssVar('--chart-a');
    for (let i = 0; i < pts.pos.length; i += 3) {
      g.beginPath(); g.arc(ox + pts.pos[i] * s, oy + pts.pos[i + 1] * s, 2.2, 0, 2 * Math.PI); g.fill();
    }
  }, [snap]);

  const energySeries: CurveSeries[] = hist.length ? [
    { name: 'Kinetic', color: cssVar('--chart-a'), curve: hist.map((p) => ({ x: p.t, y: p.ke })) },
    { name: 'Potential', color: cssVar('--chart-b'), curve: hist.map((p) => ({ x: p.t, y: p.pe })) },
    { name: 'Total', color: cssVar('--chart-c'), curve: hist.map((p) => ({ x: p.t, y: p.total })) },
  ] : [];
  const stateSeries: CurveSeries[] = hist.length ? [
    { name: 'Temperature', color: cssVar('--chart-a'), curve: hist.map((p) => ({ x: p.t, y: p.temp })) },
    { name: 'Pressure', color: cssVar('--chart-b'), curve: hist.map((p) => ({ x: p.t, y: p.pressure })) },
  ] : [];

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Fluid"><div className="stack" style={{ gap: 10 }}>
        <Field label="Atoms"><select className="select" value={size} onChange={(e) => setSize(Number(e.target.value))}>{SIZES.map((s) => <option key={s.n} value={s.n}>{s.n} atoms (fcc {s.cells}³)</option>)}</select></Field>
        <div className="cols-2" style={{ gap: 8 }}>
          <Field label="Density ρ"><input className="input" type="number" min="0.1" max="1.2" step="0.05" value={rho} onChange={(e) => setRho(Math.max(0.1, Math.min(1.2, Number(e.target.value))))} /></Field>
          <Field label="Temperature T"><input className="input" type="number" min="0.1" max="3" step="0.1" value={temp} onChange={(e) => setTemp(Math.max(0.1, Math.min(3, Number(e.target.value))))} /></Field>
        </div>
        <Field label="Thermostat"><select className="select" value={thermostat} onChange={(e) => setThermostat(e.target.value as Thermostat)}><option value="berendsen">Berendsen (equilibration)</option><option value="none">None (NVE)</option></select></Field>
        <Field label="Engine"><select className="select" value={engine} onChange={(e) => setEngine(e.target.value as Engine)}><option value="cpu">CPU (WebAssembly/JavaScript)</option><option value="gpu">GPU (WebGPU)</option></select></Field>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Run'}</button>
          <button className="btn" onClick={() => void reset()}>Reset</button>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>Device tier: {tier}. Recommended maximum for this tier: {recommend} atoms.</div>
        {size > recommend && <Callout kind="warn">This run ({size} atoms) is above the recommended {recommend} for your device tier. It will still work, but may be slow. Reduce the size or use a GPU tier if available.</Callout>}
        {note && <Callout kind="warn">{note}</Callout>}
      </div></Card>
      <Card title="State"><div className="cols-2" style={{ gap: 10 }}>
        <Stat label="Temperature" value={snap ? fmt(snap.temp, 3) : '–'} />
        <Stat label="Pressure" value={snap ? fmt(snap.pressure, 2) : '–'} />
        <Stat label="Steps/s" value={snap ? `${fmt(snap.sps, 0)} (${snap.source.toUpperCase()})` : '–'} />
        <Stat label="Time" value={snap ? `${fmt(snap.t, 2)} τ` : '–'} />
      </div></Card>
    </div>
    <div className="stack">
      <Card title="Positions (xy projection)" sub={snap ? `${snap.step} steps` : undefined}><canvas ref={ref} style={{ height: 300, width: '100%' }} /></Card>
      <Card title="Energy"><CurvePlot spec={{ series: energySeries, xLabel: 'Time τ', yLabel: 'Energy ε' }} height={230} exportName="lj-energy" /></Card>
      <Card title="Temperature and pressure"><CurvePlot spec={{ series: stateSeries, xLabel: 'Time τ', yLabel: 'Reduced units' }} height={230} exportName="lj-state" /></Card>
      <div className="faint" style={{ fontSize: 12 }}>Reduced units. For argon use sigma = 3.405 Å, epsilon/kB = 119.8 K. Minimum-image forces with a cut-and-shifted potential at 2.5 sigma; velocity Verlet with dt = 0.003 τ. The GPU path uses f32 and yields to the graphics queue between small batches so Windows watchdogs do not cancel long runs.</div>
      <div className="faint" style={{ fontSize: 12 }}>Runs in your browser, on your own processor or graphics card. Your files are not uploaded. Results are research-grade and not clinical.</div>
    </div></div>
  );
}
