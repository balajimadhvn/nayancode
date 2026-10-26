/**
 * Hardware capability tiers (RULES.md section 9).
 *
 * These are pure functions of a DeviceInfo plus an optional measured benchmark,
 * so the same logic is unit-tested on fixtures for NVIDIA, AMD, Intel, Apple and
 * software adapters, and used unchanged on the visitor's machine.
 */
import { browserFamily, isMobile, osFamily, type DeviceInfo, type GpuInfo, type Vendor } from './device';

export type Tier = 'gpu-strong' | 'gpu-basic' | 'cpu-threads' | 'cpu-basic';

export interface Classification { tier: Tier; reasons: string[] }

/** Threshold from RULES.md 9.5: a discrete-class GPU measures >= 300 GFLOPS on matmul. */
export const STRONG_GFLOPS = 300;

export function cpuTier(d: DeviceInfo): Tier {
  return d.threads >= 4 && d.isolated && d.wasmSimd ? 'cpu-threads' : 'cpu-basic';
}

export function classifyDevice(d: DeviceInfo, benchGflops?: number): Classification {
  const gpu = d.webgpu;
  if (!gpu) {
    const tier = cpuTier(d);
    return {
      tier,
      reasons: [
        d.gpuStatus === 'no-adapter' ? 'No usable WebGPU adapter; the CPU path is used.'
          : d.gpuStatus === 'error' ? 'WebGPU detection failed; the CPU path is used.'
            : 'This browser does not expose WebGPU; the CPU path is used.',
        tier === 'cpu-threads' ? 'Multi-threaded WebAssembly is available.' : 'Single-threaded WebAssembly is used.',
      ],
    };
  }
  if (gpu.fallback) {
    const tier = cpuTier(d);
    return { tier, reasons: ['Only a software WebGPU renderer is available, which is slower than the CPU.', tier === 'cpu-threads' ? 'Multi-threaded WebAssembly is available.' : 'Single-threaded WebAssembly is used.'] };
  }
  if (benchGflops === undefined || !Number.isFinite(benchGflops) || benchGflops <= 0) {
    return { tier: 'gpu-basic', reasons: ['WebGPU is available; the GPU tier is provisional until the benchmark is run.'] };
  }
  const strong = benchGflops >= STRONG_GFLOPS;
  return {
    tier: strong ? 'gpu-strong' : 'gpu-basic',
    reasons: [`Measured ${benchGflops.toFixed(0)} GFLOPS on a 512x512 single-precision matmul (strong >= ${STRONG_GFLOPS}).`],
  };
}

/** Recommended maximum problem size per tier. Studios import this table. */
export const TIER_LIMITS = {
  ljAtoms: { 'gpu-strong': 8000, 'gpu-basic': 2048, 'cpu-threads': 864, 'cpu-basic': 256 },
  searchDbSequences: { 'gpu-strong': 200_000, 'gpu-basic': 50_000, 'cpu-threads': 20_000, 'cpu-basic': 5_000 },
  knnCells: { 'gpu-strong': 200_000, 'gpu-basic': 50_000, 'cpu-threads': 20_000, 'cpu-basic': 5_000 },
  simsearchMolecules: { 'gpu-strong': 200_000, 'gpu-basic': 50_000, 'cpu-threads': 20_000, 'cpu-basic': 5_000 },
} as const;

export type LimitName = keyof typeof TIER_LIMITS;
export function recommendedLimits(tier: Tier): { ljAtoms: number; searchDbSequences: number; knnCells: number; simsearchMolecules: number } {
  return {
    ljAtoms: TIER_LIMITS.ljAtoms[tier],
    searchDbSequences: TIER_LIMITS.searchDbSequences[tier],
    knnCells: TIER_LIMITS.knnCells[tier],
    simsearchMolecules: TIER_LIMITS.simsearchMolecules[tier],
  };
}

const VENDOR_LABEL: Record<Vendor, string> = {
  nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', apple: 'Apple', qualcomm: 'Qualcomm', arm: 'ARM', other: 'your',
};

/**
 * Apple silicon and Qualcomm Adreno are always integrated. Intel Arc is
 * discrete-class; other Intel parts are integrated. AMD integrated parts are
 * recognised by name (Vega/Radeon Graphics); everything else is discrete.
 */
export function isIntegratedGpu(g: GpuInfo): boolean {
  if (g.vendor === 'apple' || g.vendor === 'qualcomm' || g.vendor === 'arm') return true;
  const s = `${g.architecture} ${g.description}`.toLowerCase();
  if (g.vendor === 'intel') return !/arc/.test(s);
  if (g.vendor === 'amd') return /vega|radeon graphics|integrated/.test(s);
  return /integrated|igpu/.test(s);
}

/** Plain-language messages for the DeviceCard. One branch per hardware case. */
export function guidance(d: DeviceInfo): string[] {
  const out: string[] = [];
  if (d.webgpu) {
    if (d.webgpu.fallback) {
      out.push('Only a software renderer is available, so the CPU path is used.');
    } else if (isIntegratedGpu(d.webgpu)) {
      out.push('Your integrated graphics is used. It is slower than a gaming card but still faster than the CPU for large jobs. Large jobs run in smaller batches.');
    } else {
      out.push(`Your graphics card (${VENDOR_LABEL[d.webgpu.vendor]}) is used through WebGPU. No CUDA or driver toolkit is needed.`);
    }
    if (d.webgpu.description) out.push(`Adapter: ${d.webgpu.description}.`);
  } else if (d.gpuStatus === 'no-adapter' || d.gpuStatus === 'error') {
    out.push('Your browser has disabled GPU compute for this graphics driver. Update the driver, or try another browser. The CPU path is used.');
  } else {
    const b = browserFamily(d.userAgent);
    const os = osFamily(d.userAgent);
    if (b === 'chrome' || b === 'edge') out.push(os === 'linux'
      ? 'Update to the latest version; on Linux enable WebGPU/Vulkan at chrome://flags (search WebGPU) if it is missing.'
      : 'Update to the latest version of Chrome or Edge; WebGPU needs version 113 or later.');
    else if (b === 'firefox') out.push('WebGPU ships in Firefox 141+ on Windows and 145+ on Apple-silicon Macs; on Linux it may still be behind a setting.');
    else if (b === 'safari') out.push('WebGPU needs Safari 26 or later (macOS 26 / iOS 26).');
    else out.push('Use a current Chrome, Edge, Firefox or Safari.');
    out.push('The CPU path is used.');
  }
  if (!d.isolated) out.push('Multi-threaded CPU mode is unavailable here; single-thread mode is used (slower).');
  if (isMobile(d.userAgent)) out.push('Heavy tools run best on a computer.');
  out.push('Want the full power of your own workstation or lab server? Connect the Nayancode Bridge.');
  return out;
}

/** Short label for badges: "GPU: nvidia" or "CPU: 8 threads". */
export function tierBadge(d: DeviceInfo, tier: Tier): string {
  if (tier === 'gpu-strong' || tier === 'gpu-basic') return `GPU: ${d.webgpu?.vendor ?? 'webgpu'}${tier === 'gpu-basic' ? ' (basic)' : ''}`;
  return `CPU: ${d.threads} thread${d.threads === 1 ? '' : 's'}`;
}
