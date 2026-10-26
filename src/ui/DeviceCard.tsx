import { useCallback, useEffect, useState } from 'react';
import { detectDevice, detectGpuDetailed, formatDevice, rememberGpu, type DeviceInfo, type GpuInfo } from '@/compute/device';
import { classifyDevice, guidance, recommendedLimits, tierBadge, type Tier } from '@/compute/hardware';
import { benchmark, type BenchResult } from '@/compute/gpuBench';
import { getGpu, setPowerPreference } from '@/compute/gpu';
import { Card, Busy, toast } from '@/ui/kit';
import ComputeBadge from './ComputeBadge';

interface Profile { tier: Tier; gflops: number; adapter: string; at: number }
const PROFILE_KEY = 'nc-device-profile';
const POWER_KEY = 'nc-gpu-power';
const THIRTY_DAYS = 30 * 24 * 3600 * 1000;

const adapterKey = (g: GpuInfo | null) => (g ? `${g.vendor}|${g.architecture}|${g.description}` : 'cpu');

function readProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    return typeof p.gflops === 'number' && typeof p.at === 'number' && typeof p.tier === 'string' ? p : null;
  } catch { return null; }
}
function writeProfile(p: Profile) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* private mode: keep it in memory */ } }
function readLowPower(): boolean { try { return localStorage.getItem(POWER_KEY) === 'low'; } catch { return false; } }
function writeLowPower(v: boolean) { try { localStorage.setItem(POWER_KEY, v ? 'low' : 'high'); } catch { /* ignore */ } }

const mib = (bytes: number | undefined) => (bytes ? Math.round(bytes / (1024 * 1024)) : 0);

export default function DeviceCard() {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [granted, setGranted] = useState<Record<string, number> | null>(null);
  const [lowPower, setLowPower] = useState(readLowPower);
  const [gflops, setGflops] = useState<number | undefined>(undefined);
  const [bench, setBench] = useState<BenchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileNote, setProfileNote] = useState<string | null>(null);

  // Detect on mount and whenever the power preference changes.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const pref = lowPower ? 'low-power' : 'high-performance';
      setPowerPreference(pref);
      const det = await detectGpuDetailed(undefined, { powerPreference: pref });
      rememberGpu(det);
      const d = detectDevice(undefined, undefined, det);
      if (!alive) return;
      setDevice(d);
      if (d.webgpu && !d.webgpu.fallback) {
        const gpu = await getGpu();
        if (alive) setGranted(gpu?.limits ?? null);
      }
      const stored = readProfile();
      if (stored) {
        const matches = stored.adapter === adapterKey(d.webgpu);
        if (matches && Date.now() - stored.at < THIRTY_DAYS) setGflops(stored.gflops);
        else setProfileNote(matches
          ? 'The stored benchmark is more than 30 days old; run it again to re-check this device.'
          : 'The graphics adapter changed since the last calibration; run the benchmark again.');
      }
    })();
    return () => { alive = false; };
  }, [lowPower]);

  const runBench = useCallback(async (calibrate: boolean) => {
    setBusy(true); setError(null);
    try {
      const r = await benchmark(512);
      setBench(r);
      if (r.gpu) setGflops(r.gflopsGpu);
      if (calibrate && device) {
        const tier = classifyDevice(device, r.gpu ? r.gflopsGpu : undefined).tier;
        writeProfile({ tier, gflops: r.gpu ? r.gflopsGpu : 0, adapter: adapterKey(device.webgpu), at: Date.now() });
        setProfileNote(`Calibrated ${new Date().toLocaleDateString()} and stored in this browser.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The benchmark could not run. The CPU path still works.');
    } finally { setBusy(false); }
  }, [device]);

  const copyReport = useCallback(async () => {
    if (!device) return;
    const tier = classifyDevice(device, gflops).tier;
    const lines = [
      'Nayancode device report',
      new Date().toISOString(),
      formatDevice(device),
      `Tier: ${tier}`,
      `Threads: ${device.threads}; memory: ${device.memoryGb ?? 'not reported'} GB; cross-origin isolated: ${device.isolated}; WASM SIMD: ${device.wasmSimd}; OPFS: ${device.opfs}`,
      device.webgpu ? `WebGPU: ${device.webgpu.vendor} ${device.webgpu.architecture}; ${device.webgpu.description}; fallback=${device.webgpu.fallback}; max buffer=${device.webgpu.maxBufferMb} MiB; max storage binding=${device.webgpu.maxStorageBindingMb} MiB` : `WebGPU: unavailable (${device.gpuStatus})`,
      granted ? `Granted limits: max buffer ${mib(granted.maxBufferSize)} MiB, storage binding ${mib(granted.maxStorageBufferBindingSize)} MiB, ${granted.maxComputeInvocationsPerWorkgroup} invocations/workgroup, ${granted.maxComputeWorkgroupStorageSize} bytes workgroup storage` : '',
      bench ? `Benchmark 512x512: CPU ${bench.cpuMs.toFixed(1)} ms (${bench.gflopsCpu.toFixed(1)} GFLOPS); GPU ${bench.gpuMs.toFixed(1)} ms (${bench.gflopsGpu.toFixed(1)} GFLOPS); max |difference| ${Number.isFinite(bench.maxAbsDiff) ? bench.maxAbsDiff.toExponential(2) : 'n/a'}; identity ${bench.gpu ? (bench.identityExact ? 'exact' : 'differs') : 'not run'}` : 'Benchmark: not run',
      `Recommended sizes: ${JSON.stringify(recommendedLimits(tier))}`,
      '',
      'Runs in your browser, on your own processor. Your files are not uploaded.',
    ];
    const text = lines.filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Device report copied');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        toast('Device report copied');
      } catch { toast('Copying is blocked by this browser'); }
    }
  }, [device, gflops, granted, bench]);

  const tier = device ? classifyDevice(device, gflops).tier : null;
  const notes = device ? guidance(device) : [];

  return (
    <Card title="This device" sub={tier ? tierBadge(device!, tier) : 'detecting'}
      actions={<div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={() => void runBench(false)} disabled={busy || !device} data-testid="bench-button">Benchmark my device</button>
        <button className="btn sm" onClick={() => void runBench(true)} disabled={busy || !device} data-testid="calibrate-button">Calibrate</button>
        <button className="btn sm" onClick={() => void copyReport()} disabled={!device}>Copy report</button>
      </div>}>
      {!device ? <div className="faint"><span className="spinner" /> Detecting this device…</div> : (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <ComputeBadge device={device} />
            <label className="row faint" style={{ gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={lowPower} onChange={(e) => { setLowPower(e.target.checked); writeLowPower(e.target.checked); setBench(null); setGflops(undefined); }} />
              Use low-power GPU (battery)
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '6px 18px', fontSize: 13 }}>
            <Row k="Processor threads" v={String(device.threads)} />
            <Row k="Memory reported" v={device.memoryGb ? `${device.memoryGb} GB` : 'not reported by this browser'} />
            <Row k="Multi-threaded WASM" v={device.isolated ? 'available' : 'single-thread only'} />
            <Row k="WASM SIMD" v={device.wasmSimd ? 'yes' : 'no'} />
            <Row k="WebGPU" v={device.webgpu ? `${device.webgpu.vendor} ${device.webgpu.architecture || ''}`.trim() : 'not available'} />
            {device.webgpu && <Row k="Adapter" v={`${device.webgpu.description || device.webgpu.vendor} · ${device.webgpu.highPerformance ? 'high-performance' : 'low-power'}${device.webgpu.fallback ? ' · software' : ''}`} />}
            {device.webgpu && <Row k="Limits" v={`${device.webgpu.maxBufferMb} MiB buffer, ${device.webgpu.maxStorageBindingMb} MiB binding, ${device.webgpu.maxWorkgroupSize} threads/workgroup`} />}
            {granted && <Row k="Granted" v={`${mib(granted.maxBufferSize)} MiB buffer, ${mib(granted.maxStorageBufferBindingSize)} MiB binding`} />}
          </div>

          {busy && <Busy progress={0.5} note="Timing the CPU and GPU on a 512×512 matrix multiply (a few seconds)…" />}
          {error && <div className="callout err">{error}</div>}
          {bench && !busy && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
              <Stat k="CPU time" v={`${bench.cpuMs.toFixed(0)} ms`} />
              <Stat k="CPU speed" v={`${bench.gflopsCpu.toFixed(0)} GFLOPS`} />
              <Stat k="GPU time" v={bench.gpu ? `${bench.gpuMs.toFixed(0)} ms` : 'not run'} />
              <Stat k="GPU speed" v={bench.gpu ? `${bench.gflopsGpu.toFixed(0)} GFLOPS` : '–'} testId="bench-gflops" />
              <Stat k="Max difference" v={Number.isFinite(bench.maxAbsDiff) ? bench.maxAbsDiff.toExponential(1) : '–'} testId="bench-diff" />
              <Stat k="Identity check" v={bench.gpu ? (bench.identityExact ? 'exact' : 'differs') : 'not run'} testId="bench-identity" />
            </div>
          )}
          {profileNote && <div className="faint" style={{ fontSize: 12.5 }}>{profileNote}</div>}
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5, color: 'var(--text-dim)', fontSize: 12.5 }}>
            {notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
          <div className="faint" style={{ fontSize: 12 }}>
            WebGPU is built into Chrome and Edge 113+, Firefox 141+ on Windows and Safari 26+; elsewhere the CPU path runs instead. The benchmark compares two 512×512 matrix multiplies and is a rough guide, not a warranty of speed. Results are research-grade and not clinical.
          </div>
        </div>
      )}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}><span className="faint">{k}</span><span style={{ textAlign: 'right' }}>{v}</span></div>;
}
function Stat({ k, v, testId }: { k: string; v: string; testId?: string }) {
  return <div className="card stat" data-testid={testId}><div className="v" style={{ fontSize: 17 }}>{v}</div><div className="l">{k}</div></div>;
}
