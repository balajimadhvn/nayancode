import { useEffect, useState } from 'react';
import { detectDevice, detectGpuDetailed, rememberGpu, type DeviceInfo } from '@/compute/device';
import { classifyDevice, tierBadge } from '@/compute/hardware';

/**
 * Small pill for a studio header: says where the tool runs and which processor
 * is used. Honest wording from RULES.md sections 7 and 9; the full sentence is
 * in the tooltip, which also lists threads, memory and the adapter name.
 */
export default function ComputeBadge({ device: given }: { device?: DeviceInfo }) {
  const [device, setDevice] = useState<DeviceInfo | null>(given ?? null);

  useEffect(() => {
    if (given) { setDevice(given); return; }
    let alive = true;
    void (async () => {
      const det = await detectGpuDetailed();
      rememberGpu(det);
      if (alive) setDevice(detectDevice(undefined, undefined, det));
    })();
    return () => { alive = false; };
  }, [given]);

  const tier = device ? classifyDevice(device).tier : null;
  const label = device && tier ? tierBadge(device, tier) : 'detecting…';
  const gpuReady = !!device?.webgpu && !device.webgpu.fallback;
  const text = given
    ? `Runs in your browser, on your own processor. Your files are not uploaded. · ${label}`
    : `Runs in your browser · ${label}${gpuReady ? ' · GPU ready' : ''}`;
  const title = device
    ? `Runs in your browser, on your own processor. Your files are not uploaded.\n${device.threads} threads${device.memoryGb ? `, ${device.memoryGb} GB memory` : ''}${device.webgpu ? `\nGPU: ${device.webgpu.vendor} ${device.webgpu.architecture} — ${device.webgpu.description || 'WebGPU adapter'}` : '\nNo WebGPU: the CPU path is used.'}`
    : 'Detecting this device…';

  return (
    <span className="badge" title={title} style={{ fontWeight: 500, letterSpacing: 0.1 }} data-tier={tier ?? 'unknown'}>
      <span className="dot" style={{ background: gpuReady ? 'var(--accent-3)' : 'var(--text-dim)' }} />
      {text}
    </span>
  );
}
