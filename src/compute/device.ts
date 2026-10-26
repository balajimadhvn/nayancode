/**
 * Device detection for the "runs on your device" features.
 *
 * Pure and testable: every function takes the `navigator`-like object it should
 * inspect, so unit tests use plain mock objects with no browser at all.
 */

export type Vendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'qualcomm' | 'arm' | 'other';
export type GpuStatus = 'ok' | 'unsupported' | 'no-adapter' | 'error';
export type PowerPreference = 'high-performance' | 'low-power';

export interface GpuInfo {
  vendor: Vendor;
  /** Adapter architecture string, e.g. "lovelace". */
  architecture: string;
  description: string;
  /** maxBufferSize in MiB (integer). */
  maxBufferMb: number;
  /** maxStorageBufferBindingSize in MiB (integer). */
  maxStorageBindingMb: number;
  /** maxComputeWorkgroupSizeX. */
  maxWorkgroupSize: number;
  /** Adapter feature names. */
  features: string[];
  /** True for software renderers (SwiftShader, llvmpipe): never used for compute. */
  fallback: boolean;
  isFallbackAdapter: boolean;
  /** True when the high-performance adapter request succeeded. */
  highPerformance: boolean;
}

export interface DeviceInfo {
  /** navigator.hardwareConcurrency, at least 1. */
  threads: number;
  /** navigator.deviceMemory in GB, or null when the browser does not report it. */
  memoryGb: number | null;
  /** crossOriginIsolated: required for multi-threaded WASM. */
  isolated: boolean;
  wasmSimd: boolean;
  opfs: boolean;
  webgpu: GpuInfo | null;
  /** Why webgpu is null: 'unsupported' (no navigator.gpu), 'no-adapter', 'error'. */
  gpuStatus: GpuStatus;
  userAgent: string;
}

export interface AdapterLike {
  info?: {
    vendor?: string;
    architecture?: string;
    description?: string;
    isFallbackAdapter?: boolean;
    device?: string;
  };
  limits?: Record<string, number>;
  features?: Iterable<string>;
  requestDevice?(opts?: { requiredLimits?: Record<string, number> }): Promise<unknown>;
}

export interface NavLike {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  userAgent?: string;
  gpu?: { requestAdapter(opts?: { powerPreference?: PowerPreference }): Promise<AdapterLike | null> } | null;
  storage?: { getDirectory?: () => Promise<unknown> };
}

const SIMD_WAT = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

/** Vendor buckets: the base WebGPU spec only guarantees a free-form info.vendor string. */
export function vendorFrom(s: string | undefined | null): Vendor {
  const v = (s ?? '').toLowerCase();
  if (/nvidia/.test(v)) return 'nvidia';
  if (/amd|ati|radeon|advanced micro devices/.test(v)) return 'amd';
  if (/intel/.test(v)) return 'intel';
  if (/apple/.test(v)) return 'apple';
  if (/qualcomm|adreno/.test(v)) return 'qualcomm';
  if (/arm|mali/.test(v)) return 'arm';
  return 'other';
}

function isFallback(a: AdapterLike): boolean {
  const i = a.info ?? {};
  const text = `${i.architecture ?? ''} ${i.description ?? ''}`.toLowerCase();
  return i.isFallbackAdapter === true || /swiftshader|llvmpipe|software/.test(text);
}

function toGpuInfo(a: AdapterLike, highPerformance: boolean): GpuInfo {
  const i = a.info ?? {};
  const limits = a.limits ?? {};
  return {
    vendor: vendorFrom(`${i.vendor ?? ''} ${i.description ?? ''}`),
    architecture: i.architecture ?? '',
    description: i.description ?? '',
    maxBufferMb: Math.round((limits.maxBufferSize ?? 0) / (1024 * 1024)),
    maxStorageBindingMb: Math.round((limits.maxStorageBufferBindingSize ?? 0) / (1024 * 1024)),
    maxWorkgroupSize: limits.maxComputeWorkgroupSizeX ?? 0,
    features: a.features ? Array.from(a.features) : [],
    fallback: isFallback(a),
    isFallbackAdapter: i.isFallbackAdapter === true,
    highPerformance,
  };
}

export interface DetectGpuResult { info: GpuInfo | null; status: GpuStatus; adapter?: AdapterLike }

const cache = new Map<string, Promise<DetectGpuResult>>();

/**
 * Ask for a WebGPU adapter. Tries the preferred power profile first, then the
 * default request. Never throws: failures become { info: null, status }.
 */
export function detectGpuDetailed(nav: NavLike = navigator as unknown as NavLike, opts: { powerPreference?: PowerPreference } = {}): Promise<DetectGpuResult> {
  const pref = opts.powerPreference ?? 'high-performance';
  const hit = cache.get(pref);
  if (hit) return hit;
  const run = (async (): Promise<DetectGpuResult> => {
    const gpu = nav.gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') return { info: null, status: 'unsupported' };
    try {
      let adapter = await gpu.requestAdapter({ powerPreference: pref });
      let highPerformance = adapter !== null;
      if (!adapter && pref !== 'low-power') adapter = await gpu.requestAdapter();
      if (!adapter) return { info: null, status: 'no-adapter' };
      if (pref === 'low-power') highPerformance = false;
      return { info: toGpuInfo(adapter, highPerformance), status: 'ok', adapter };
    } catch {
      return { info: null, status: 'error' };
    }
  })();
  cache.set(pref, run);
  return run;
}

/** Cached convenience wrapper: GpuInfo or null. */
export async function detectGpu(nav: NavLike = navigator as unknown as NavLike, opts: { powerPreference?: PowerPreference } = {}): Promise<GpuInfo | null> {
  return (await detectGpuDetailed(nav, opts)).info;
}

/** Test / re-detect hook: clears the cached adapter promises. */
export function clearGpuCache() { cache.clear(); }

/** Remember the last resolved detection so the synchronous detectDevice can report it. */
let last: DetectGpuResult = { info: null, status: 'unsupported' };
export function rememberGpu(r: DetectGpuResult) { last = r; }
export function lastGpuStatus(): GpuStatus { return last.status; }

export function detectDevice(nav: NavLike = navigator as unknown as NavLike, g: { crossOriginIsolated?: boolean } = globalThis as { crossOriginIsolated?: boolean }, gpu: DetectGpuResult = last): DeviceInfo {
  let wasmSimd = false;
  try { wasmSimd = typeof WebAssembly !== 'undefined' && WebAssembly.validate(SIMD_WAT); } catch { wasmSimd = false; }
  let opfs = false;
  try { opfs = typeof nav.storage?.getDirectory === 'function'; } catch { opfs = false; }
  return {
    threads: Math.max(1, Math.floor(nav.hardwareConcurrency ?? 1) || 1),
    memoryGb: typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : null,
    isolated: g?.crossOriginIsolated === true,
    wasmSimd,
    opfs,
    webgpu: gpu.info,
    gpuStatus: gpu.status,
    userAgent: nav.userAgent ?? '',
  };
}

/** One readable line, e.g. "12 threads, 16 GB, WebGPU: nvidia lovelace". */
export function formatDevice(d: DeviceInfo): string {
  const parts = [`${d.threads} thread${d.threads === 1 ? '' : 's'}`];
  if (d.memoryGb !== null) parts.push(`${d.memoryGb} GB`);
  if (d.webgpu) parts.push(`WebGPU: ${d.webgpu.vendor}${d.webgpu.architecture ? ` ${d.webgpu.architecture}` : ''}${d.webgpu.fallback ? ' (software)' : ''}`);
  else parts.push('no WebGPU');
  return parts.join(', ');
}

export type BrowserFamily = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
export type OsFamily = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'other';

/** Classify a user-agent string (pure; fixtures in the tests are real UA strings). */
export function browserFamily(ua: string): BrowserFamily {
  const s = ua.toLowerCase();
  if (/edg\//.test(s)) return 'edge';
  if (/firefox|fxios/.test(s)) return 'firefox';
  if (/samsungbrowser/.test(s)) return 'chrome';
  if (/chrome|crios/.test(s)) return 'chrome';
  if (/safari/.test(s)) return 'safari';
  return 'other';
}

export function osFamily(ua: string): OsFamily {
  const s = ua.toLowerCase();
  if (/android/.test(s)) return 'android';
  if (/iphone|ipad|ipod/.test(s)) return 'ios';
  if (/windows|win32|win64/.test(s)) return 'windows';
  if (/mac os x|macintosh/.test(s)) return 'macos';
  if (/linux|x11/.test(s)) return 'linux';
  return 'other';
}

/** Phones and tablets get a gentle banner, never a block. */
export function isMobile(ua: string): boolean {
  return /android|iphone|ipad|ipod|mobile|tablet/.test(ua.toLowerCase());
}
