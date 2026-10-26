/**
 * Small WebGPU helpers shared by every GPU kernel.
 *
 * Only the base WebGPU spec is used: f32/u32, storage buffers, uniform buffers,
 * compute pipelines. No f16, no subgroups, no timestamp queries.
 *
 * Minimal structural types are declared here because the project does not
 * depend on @webgpu/types. Sizes are in bytes unless the name says MiB.
 */
import { detectGpuDetailed, type AdapterLike, type GpuInfo, type PowerPreference } from './device';

export const USAGE = {
  MAP_READ: 0x1,
  MAP_WRITE: 0x2,
  COPY_SRC: 0x4,
  COPY_DST: 0x8,
  UNIFORM: 0x40,
  STORAGE: 0x80,
} as const;

export interface GpuBuffer {
  size: number;
  destroy(): void;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
}

export interface GpuComputePass {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

export interface GpuEncoder {
  beginComputePass(): GpuComputePass;
  copyBufferToBuffer(src: GpuBuffer, srcOffset: number, dst: GpuBuffer, dstOffset: number, size: number): void;
  finish(): unknown;
}

export interface GpuQueue {
  writeBuffer(buffer: GpuBuffer, offset: number, data: ArrayBufferView | ArrayBuffer): void;
  submit(commandBuffers: unknown[]): void;
  onSubmittedWorkDone(): Promise<void>;
}

export interface GpuDevice {
  createBuffer(desc: { size: number; usage: number; mappedAtCreation?: boolean }): GpuBuffer;
  createShaderModule(desc: { code: string }): unknown;
  createComputePipeline(desc: { layout: unknown; compute: { module: unknown; entryPoint: string } }): unknown;
  createBindGroup(desc: unknown): unknown;
  createCommandEncoder(): GpuEncoder;
  queue: GpuQueue;
  limits: Record<string, number>;
  lost: Promise<{ reason: string; message?: string }>;
  destroy(): void;
}

export interface GpuHandle {
  device: GpuDevice;
  adapter: AdapterLike;
  info: GpuInfo;
  /** Limits actually granted by requestDevice, in bytes / counts. */
  limits: Record<string, number>;
}

/** What we would like, from RULES.md section 9. Defaults are 128 MiB / 256 MiB / 256 / 16 KiB. */
export const WANTED_LIMITS = {
  maxStorageBufferBindingSize: 512 * 1024 * 1024,
  maxBufferSize: 512 * 1024 * 1024,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupStorageSize: 16384,
} as const;

const DEFAULT_LIMITS: Record<string, number> = {
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupStorageSize: 16384,
};

/**
 * Request no more than the adapter offers, and no more than we want. Adapters
 * that do not report a limit fall back to the WebGPU default, not to a value
 * measured on the developer's laptop.
 */
export function requestLimits(adapter: AdapterLike, wanted: Record<string, number> = WANTED_LIMITS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, want] of Object.entries(wanted)) {
    const offered = adapter.limits?.[name];
    out[name] = Math.min(want, offered ?? DEFAULT_LIMITS[name] ?? want);
  }
  return out;
}

export function supportsStorage(adapter: AdapterLike, bytes: number): boolean {
  const offered = adapter.limits?.maxStorageBufferBindingSize ?? DEFAULT_LIMITS.maxStorageBufferBindingSize;
  return bytes <= offered;
}

let cached: Promise<GpuHandle | null> | null = null;
let powerPreference: PowerPreference = 'high-performance';
let lostHandlers: ((info: { reason: string; message: string }) => void)[] = [];

/** Forget the cached device (used when the power preference changes or the device is lost). */
export function resetGpu() { cached = null; }

/**
 * Resolve a ready WebGPU device, or null when this browser/machine cannot do
 * GPU compute. Never throws. The same promise is reused, so callers can await
 * this freely.
 */
export function getGpu(): Promise<GpuHandle | null> {
  if (cached) return cached;
  cached = (async (): Promise<GpuHandle | null> => {
    try {
      const det = await detectGpuDetailed(undefined, { powerPreference });
      if (!det.info || det.info.fallback || !det.adapter?.requestDevice) return null;
      const limits = requestLimits(det.adapter);
      let device: GpuDevice;
      try {
        device = (await det.adapter.requestDevice({ requiredLimits: limits })) as GpuDevice;
      } catch {
        // Required limits are a request, not a guarantee on some drivers.
        device = (await det.adapter.requestDevice()) as GpuDevice;
      }
      void device.lost?.then((info) => {
        resetGpu();
        for (const cb of lostHandlers) cb({ reason: info.reason, message: info.message ?? '' });
      });
      return { device, adapter: det.adapter, info: det.info, limits: { ...limits, ...(device.limits ?? {}) } };
    } catch {
      return null;
    }
  })();
  return cached;
}

/** Change the power preference (hybrid laptops). Returns a fresh device next time. */
export function setPowerPreference(p: PowerPreference) {
  if (p === powerPreference) return;
  powerPreference = p;
  resetGpu();
}

export function getPowerPreference(): PowerPreference { return powerPreference; }

/** Subscribe to device loss. Returns an unsubscribe function. */
export function onLost(cb: (info: { reason: string; message: string }) => void): () => void {
  lostHandlers.push(cb);
  return () => { lostHandlers = lostHandlers.filter((x) => x !== cb); };
}

/** Copy any view (possibly on a SharedArrayBuffer) into a plain ArrayBuffer. */
function toArrayBuffer(data: ArrayBufferView | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const out = new ArrayBuffer(data.byteLength);
  new Uint8Array(out).set(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
  return out;
}

/** Create a storage buffer from data, or a zeroed buffer of `size` bytes. */
export function makeBuffer(dev: GpuDevice, data: ArrayBufferView | ArrayBuffer | number, usage: number = USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC): GpuBuffer {
  if (typeof data === 'number') return dev.createBuffer({ size: Math.max(4, data), usage });
  const bytes = toArrayBuffer(data);
  const buf = dev.createBuffer({ size: Math.max(4, bytes.byteLength), usage: usage | USAGE.COPY_DST });
  dev.queue.writeBuffer(buf, 0, bytes);
  return buf;
}

const pipelines = new Map<string, unknown>();

export interface RunComputeOpts {
  /** WGSL source. Bindings must be @group(0) in the same order as `buffers`, uniform last. */
  code: string;
  entry?: string;
  /** Storage buffers, bound at @binding(0..n-1). */
  buffers: GpuBuffer[];
  /** Optional uniform data, bound at @binding(n). */
  uniforms?: ArrayBuffer | ArrayBufferView;
  /** Dispatch dimensions; use ceil(n / workgroup_size) for one-dimensional kernels. */
  workgroups: [number, number?, number?];
}

/**
 * Run a compute shader once. The pipeline is cached by shader source + entry
 * point; a fresh bind group is made per call because buffers change.
 * Returns the shader module's device object so callers can read back buffers.
 */
export function runCompute(dev: GpuDevice, opts: RunComputeOpts): void {
  const key = `${opts.entry ?? 'main'}\u0000${opts.code}`;
  let pipeline = pipelines.get(key);
  if (!pipeline) {
    const module = dev.createShaderModule({ code: opts.code });
    pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: opts.entry ?? 'main' } });
    pipelines.set(key, pipeline);
  }
  const entries = opts.buffers.map((buffer, binding) => ({ binding, resource: { buffer } }));
  let uniformBuf: GpuBuffer | null = null;
  if (opts.uniforms) {
    const src = toArrayBuffer(opts.uniforms);
    const size = Math.max(16, Math.ceil(src.byteLength / 16) * 16);
    uniformBuf = dev.createBuffer({ size, usage: USAGE.UNIFORM | USAGE.COPY_DST });
    dev.queue.writeBuffer(uniformBuf, 0, src);
    entries.push({ binding: opts.buffers.length, resource: { buffer: uniformBuf } });
  }
  const bindGroup = dev.createBindGroup({ layout: (pipeline as { getBindGroupLayout?(i: number): unknown }).getBindGroupLayout?.(0) ?? 'auto', entries });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.max(1, opts.workgroups[0]), Math.max(1, opts.workgroups[1] ?? 1), Math.max(1, opts.workgroups[2] ?? 1));
  pass.end();
  dev.queue.submit([enc.finish()]);
  uniformBuf?.destroy();
}

/**
 * Read `size` bytes back through a MAP_READ staging buffer. Await the promise;
 * the source buffer is left intact (it is destroyed by the caller or by GC).
 */
export async function readBuffer(dev: GpuDevice, buf: GpuBuffer, size: number = buf.size): Promise<ArrayBuffer> {
  const staging = dev.createBuffer({ size: Math.max(4, size), usage: USAGE.MAP_READ | USAGE.COPY_DST });
  const enc = dev.createCommandEncoder();
  enc.copyBufferToBuffer(buf, 0, staging, 0, size);
  dev.queue.submit([enc.finish()]);
  await staging.mapAsync(USAGE.MAP_READ);
  const copy = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return copy;
}

export function chunkCount(n: number, size: number): number { return Math.ceil(n / size); }

/** Bytes in a Float32Array of `n` elements. */
export const f32Bytes = (n: number) => n * 4;
