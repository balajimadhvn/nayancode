import { describe, expect, it, beforeEach } from 'vitest';
import {
  browserFamily, clearGpuCache, detectDevice, detectGpu, detectGpuDetailed, formatDevice,
  isMobile, osFamily, vendorFrom, type AdapterLike, type NavLike,
} from './device';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  curl: 'curl/8.7.1',
};

function navOf(adapter: AdapterLike | null | 'throw', extra: Partial<NavLike> = {}): NavLike {
  return {
    hardwareConcurrency: 8,
    deviceMemory: 16,
    userAgent: UA.chromeWin,
    gpu: {
      requestAdapter: async () => {
        if (adapter === 'throw') throw new Error('GPU process crashed');
        return adapter;
      },
    },
    ...extra,
  };
}

const nvidia: AdapterLike = {
  info: { vendor: 'nvidia', architecture: 'lovelace', description: 'NVIDIA GeForce RTX 4050 Laptop GPU' },
  limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 30, maxComputeWorkgroupSizeX: 256 },
  features: new Set(['f16']),
};

beforeEach(() => clearGpuCache());

describe('detectGpu', () => {
  it('returns null when navigator.gpu is missing', async () => {
    const d = detectDevice({ hardwareConcurrency: 4 }, {}, { info: null, status: 'unsupported' });
    expect(d.webgpu).toBeNull();
    expect(d.gpuStatus).toBe('unsupported');
    expect(await detectGpu({ hardwareConcurrency: 4 })).toBeNull();
  });

  it('maps adapter info and limits into MiB (2 GiB buffer -> 2048, 1 GiB binding -> 1024)', async () => {
    const g = await detectGpu(navOf(nvidia));
    expect(g).not.toBeNull();
    expect(g!.vendor).toBe('nvidia');
    expect(g!.architecture).toBe('lovelace');
    expect(g!.maxBufferMb).toBe(2048);
    expect(g!.maxStorageBindingMb).toBe(1024);
    expect(g!.maxWorkgroupSize).toBe(256);
    expect(g!.features).toContain('f16');
    expect(g!.fallback).toBe(false);
  });

  it('returns null (never throws) when requestAdapter throws', async () => {
    const r = await detectGpuDetailed(navOf('throw'));
    expect(r.info).toBeNull();
    expect(r.status).toBe('error');
    expect(await detectGpu(navOf('throw'))).toBeNull();
  });

  it('reports no-adapter when the browser returns null for both requests', async () => {
    const r = await detectGpuDetailed(navOf(null));
    expect(r.status).toBe('no-adapter');
  });

  it('flags software adapters', async () => {
    const sw: AdapterLike = { info: { vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader' }, limits: {}, features: [] };
    const g = await detectGpu(navOf(sw));
    expect(g!.fallback).toBe(true);
    expect(g!.isFallbackAdapter).toBe(false);
    expect(g!.vendor).toBe('other');
  });

  it('caches the adapter promise', async () => {
    let calls = 0;
    const nav = navOf(nvidia);
    nav.gpu = { requestAdapter: async () => { calls++; return nvidia; } };
    await detectGpu(nav); await detectGpu(nav);
    expect(calls).toBe(1);
  });
});

describe('detectDevice and formatDevice', () => {
  it('uses 1 thread when hardwareConcurrency is missing', () => {
    const d = detectDevice({}, {}, { info: null, status: 'unsupported' });
    expect(d.threads).toBe(1);
    expect(d.memoryGb).toBeNull();
  });

  it('reads threads, memory, isolation and SIMD', () => {
    const d = detectDevice({ hardwareConcurrency: 12, deviceMemory: 16 }, { crossOriginIsolated: true }, { info: null, status: 'unsupported' });
    expect(d.threads).toBe(12);
    expect(d.memoryGb).toBe(16);
    expect(d.isolated).toBe(true);
    expect(d.wasmSimd).toBe(true);
  });

  it('formatDevice contains the thread count and the GPU name', async () => {
    const gpu = await detectGpuDetailed(navOf(nvidia));
    const d = detectDevice({ hardwareConcurrency: 12, deviceMemory: 16 }, {}, gpu);
    const line = formatDevice(d);
    expect(line).toContain('12 threads');
    expect(line).toContain('16 GB');
    expect(line).toContain('nvidia lovelace');
    expect(line).not.toContain('no WebGPU');
  });

  it('formatDevice says no WebGPU when there is none', () => {
    expect(formatDevice(detectDevice({ hardwareConcurrency: 2 }, {}, { info: null, status: 'unsupported' }))).toContain('no WebGPU');
  });
});

describe('vendorFrom', () => {
  it('normalises the free-form vendor strings', () => {
    expect(vendorFrom('nvidia')).toBe('nvidia');
    expect(vendorFrom('Advanced Micro Devices, Inc.')).toBe('amd');
    expect(vendorFrom('ATI Technologies Inc.')).toBe('amd');
    expect(vendorFrom('Intel Inc.')).toBe('intel');
    expect(vendorFrom('intel')).toBe('intel');
    expect(vendorFrom('apple')).toBe('apple');
    expect(vendorFrom('qualcomm')).toBe('qualcomm');
    expect(vendorFrom('ARM')).toBe('arm');
    expect(vendorFrom('')).toBe('other');
    expect(vendorFrom(undefined)).toBe('other');
  });
});

describe('browserFamily and osFamily', () => {
  it('classifies eight real user-agent strings', () => {
    expect(browserFamily(UA.chromeWin)).toBe('chrome');
    expect(browserFamily(UA.edgeWin)).toBe('edge');
    expect(browserFamily(UA.firefoxLinux)).toBe('firefox');
    expect(browserFamily(UA.safariMac)).toBe('safari');
    expect(browserFamily(UA.safariIphone)).toBe('safari');
    expect(browserFamily(UA.chromeAndroid)).toBe('chrome');
    expect(browserFamily(UA.samsung)).toBe('chrome');
    expect(browserFamily(UA.curl)).toBe('other');
  });

  it('maps operating systems', () => {
    expect(osFamily(UA.chromeWin)).toBe('windows');
    expect(osFamily(UA.firefoxLinux)).toBe('linux');
    expect(osFamily(UA.safariMac)).toBe('macos');
    expect(osFamily(UA.safariIphone)).toBe('ios');
    expect(osFamily(UA.chromeAndroid)).toBe('android');
    expect(osFamily(UA.curl)).toBe('other');
  });

  it('spots phones and tablets only', () => {
    expect(isMobile(UA.chromeAndroid)).toBe(true);
    expect(isMobile(UA.safariIphone)).toBe(true);
    expect(isMobile(UA.chromeWin)).toBe(false);
    expect(isMobile(UA.safariMac)).toBe(false);
  });
});
