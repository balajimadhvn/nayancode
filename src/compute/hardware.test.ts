import { describe, expect, it } from 'vitest';
import { classifyDevice, guidance, isIntegratedGpu, recommendedLimits, tierBadge, STRONG_GFLOPS } from './hardware';
import { requestLimits, WANTED_LIMITS } from './gpu';
import type { DeviceInfo, GpuInfo } from './device';

function gpu(over: Partial<GpuInfo> = {}): GpuInfo {
  return {
    vendor: 'nvidia', architecture: 'lovelace', description: 'NVIDIA GeForce RTX 4050', maxBufferMb: 2048,
    maxStorageBindingMb: 1024, maxWorkgroupSize: 256, features: [], fallback: false,
    isFallbackAdapter: false, highPerformance: true, ...over,
  };
}

function dev(over: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    threads: 12, memoryGb: 16, isolated: true, wasmSimd: true, opfs: true,
    webgpu: gpu(), gpuStatus: 'ok', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0', ...over,
  };
}

describe('classifyDevice', () => {
  it('NVIDIA discrete with 8000 GFLOPS -> gpu-strong', () => {
    expect(classifyDevice(dev(), 8000).tier).toBe('gpu-strong');
  });
  it('Intel integrated at 90 GFLOPS -> gpu-basic', () => {
    const d = dev({ webgpu: gpu({ vendor: 'intel', architecture: 'gen-12lp', description: 'Intel Iris Xe Graphics' }) });
    expect(classifyDevice(d, 90).tier).toBe('gpu-basic');
    expect(isIntegratedGpu(d.webgpu!)).toBe(true);
  });
  it('Apple at 1500 GFLOPS -> gpu-strong (the benchmark decides, not the vendor)', () => {
    const d = dev({ webgpu: gpu({ vendor: 'apple', architecture: 'apple-m3', description: 'Apple M3 Pro' }) });
    expect(classifyDevice(d, 1500).tier).toBe('gpu-strong');
    expect(classifyDevice(d, 200).tier).toBe('gpu-basic');
  });
  it('software adapter with 8 threads and isolation -> cpu-threads', () => {
    const d = dev({ webgpu: gpu({ fallback: true, isFallbackAdapter: true, architecture: 'swiftshader' }) });
    expect(classifyDevice(d, 5000).tier).toBe('cpu-threads');
  });
  it('software adapter with 1 thread -> cpu-basic', () => {
    const d = dev({ threads: 1, isolated: false, webgpu: gpu({ fallback: true, isFallbackAdapter: true }) });
    expect(classifyDevice(d).tier).toBe('cpu-basic');
  });
  it('no WebGPU -> CPU tier (threads when isolated + SIMD)', () => {
    expect(classifyDevice(dev({ webgpu: null, gpuStatus: 'unsupported' })).tier).toBe('cpu-threads');
    expect(classifyDevice(dev({ webgpu: null, gpuStatus: 'unsupported', threads: 2 })).tier).toBe('cpu-basic');
  });
  it('an unmeasured GPU is provisional gpu-basic, never claimed strong', () => {
    expect(classifyDevice(dev()).tier).toBe('gpu-basic');
  });
  it('300 GFLOPS is the strong threshold', () => {
    expect(classifyDevice(dev(), STRONG_GFLOPS).tier).toBe('gpu-strong');
    expect(classifyDevice(dev(), STRONG_GFLOPS - 1).tier).toBe('gpu-basic');
  });
  it('reports a reason for every classification', () => {
    expect(classifyDevice(dev(), 8000).reasons.length).toBeGreaterThan(0);
    expect(classifyDevice(dev({ webgpu: null })).reasons.length).toBeGreaterThan(0);
  });
});

describe('recommendedLimits', () => {
  it('gives the smallest sizes to cpu-basic and the largest to gpu-strong', () => {
    const strong = recommendedLimits('gpu-strong');
    const basic = recommendedLimits('gpu-basic');
    const threads = recommendedLimits('cpu-threads');
    const cpu = recommendedLimits('cpu-basic');
    expect(strong.ljAtoms).toBe(8000);
    expect(basic.ljAtoms).toBe(2048);
    expect(threads.ljAtoms).toBe(864);
    expect(cpu.ljAtoms).toBe(256);
    for (const k of ['searchDbSequences', 'knnCells', 'simsearchMolecules'] as const) {
      expect(strong[k]).toBeGreaterThan(basic[k]);
      expect(basic[k]).toBeGreaterThan(threads[k]);
      expect(threads[k]).toBeGreaterThan(cpu[k]);
    }
  });
});

describe('tierBadge', () => {
  it('names the GPU vendor or the CPU thread count', () => {
    expect(tierBadge(dev(), 'gpu-strong')).toBe('GPU: nvidia');
    expect(tierBadge(dev({ threads: 8, webgpu: null }), 'cpu-threads')).toBe('CPU: 8 threads');
    expect(tierBadge(dev({ threads: 1, webgpu: null }), 'cpu-basic')).toBe('CPU: 1 thread');
  });
});

describe('guidance covers every hardware case', () => {
  const texts = (d: DeviceInfo) => guidance(d).join(' ');
  it('discrete GPU: no CUDA needed', () => {
    expect(texts(dev())).toContain('Your graphics card (NVIDIA) is used through WebGPU. No CUDA or driver toolkit is needed.');
  });
  it('integrated GPU: smaller batches', () => {
    const d = dev({ webgpu: gpu({ vendor: 'intel', description: 'Intel UHD Graphics' }) });
    expect(texts(d)).toContain('Your integrated graphics is used.');
    expect(texts(d)).toContain('Large jobs run in smaller batches.');
  });
  it('Chrome/Edge without WebGPU', () => {
    const d = dev({ webgpu: null, gpuStatus: 'unsupported', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/100.0 Safari/537.36' });
    expect(texts(d)).toContain('Update to the latest version of Chrome or Edge');
  });
  it('Chrome on Linux names chrome://flags', () => {
    const d = dev({ webgpu: null, gpuStatus: 'unsupported', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0 Safari/537.36' });
    expect(texts(d)).toContain('chrome://flags');
  });
  it('Firefox without WebGPU', () => {
    const d = dev({ webgpu: null, gpuStatus: 'unsupported', userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0' });
    expect(texts(d)).toContain('Firefox 141+ on Windows');
  });
  it('Safari without WebGPU', () => {
    const d = dev({ webgpu: null, gpuStatus: 'unsupported', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.1 Safari/605.1.15' });
    expect(texts(d)).toContain('Safari 26');
  });
  it('other browsers', () => {
    const d = dev({ webgpu: null, gpuStatus: 'unsupported', userAgent: 'curl/8.7.1' });
    expect(texts(d)).toContain('Use a current Chrome, Edge, Firefox or Safari');
  });
  it('blocklisted adapter', () => {
    const d = dev({ webgpu: null, gpuStatus: 'no-adapter' });
    expect(texts(d)).toContain('Your browser has disabled GPU compute for this graphics driver.');
  });
  it('software-only adapter', () => {
    const d = dev({ webgpu: gpu({ fallback: true }) });
    expect(texts(d)).toContain('Only a software renderer is available, so the CPU path is used.');
  });
  it('not cross-origin isolated', () => {
    expect(texts(dev({ isolated: false }))).toContain('Multi-threaded CPU mode is unavailable here');
  });
  it('phone/tablet', () => {
    expect(texts(dev({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36' }))).toContain('Heavy tools run best on a computer.');
  });
  it('always ends with the Bridge suggestion', () => {
    for (const d of [dev(), dev({ webgpu: null }), dev({ webgpu: null, gpuStatus: 'no-adapter' })]) {
      expect(guidance(d).at(-1)).toContain('Connect the Nayancode Bridge.');
    }
  });
});

describe('requestLimits', () => {
  it('never exceeds the adapter, and never asks for more than wanted', () => {
    const small = {
      info: {},
      limits: {
        maxStorageBufferBindingSize: 64 * 1024 * 1024,
        maxBufferSize: 100 * 1024 * 1024,
        maxComputeInvocationsPerWorkgroup: 128,
        maxComputeWorkgroupStorageSize: 8192,
      },
    };
    expect(requestLimits(small)).toEqual({
      maxStorageBufferBindingSize: 64 * 1024 * 1024,
      maxBufferSize: 100 * 1024 * 1024,
      maxComputeInvocationsPerWorkgroup: 128,
      maxComputeWorkgroupStorageSize: 8192,
    });
    const big = requestLimits({ limits: { maxStorageBufferBindingSize: 2 ** 30, maxBufferSize: 2 ** 31, maxComputeInvocationsPerWorkgroup: 1024, maxComputeWorkgroupStorageSize: 32768 } });
    for (const [k, v] of Object.entries(WANTED_LIMITS)) expect(big[k]).toBe(v);
  });

  it('falls back to WebGPU defaults when the adapter does not report a limit', () => {
    const r = requestLimits({});
    expect(r.maxStorageBufferBindingSize).toBe(128 * 1024 * 1024);
    expect(r.maxBufferSize).toBe(256 * 1024 * 1024);
    expect(r.maxComputeInvocationsPerWorkgroup).toBe(256);
    expect(r.maxComputeWorkgroupStorageSize).toBe(16384);
  });
});
