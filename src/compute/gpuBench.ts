/**
 * Dense single-precision matrix multiply: CPU reference and WebGPU twin.
 * Used to place a visitor's machine in a hardware tier (RULES.md 9.5).
 * All matrices are row-major, n x n, Float32Array.
 */
import { getGpu, makeBuffer, readBuffer, runCompute, USAGE, type GpuDevice } from './gpu';

/** Plain triple loop. This is the reference answer, deliberately not optimised. */
export function matmulCpu(a: Float32Array, b: Float32Array, n: number): Float32Array {
  const c = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = a[i * n + k];
      if (aik === 0) continue;
      for (let j = 0; j < n; j++) c[i * n + j] += aik * b[k * n + j];
    }
  }
  return c;
}

/** Pad an n x n matrix up to the next multiple of 16 (zeros elsewhere). */
export function pad16(a: Float32Array, n: number): { data: Float32Array; size: number } {
  const size = Math.ceil(n / 16) * 16;
  if (size === n) return { data: a, size };
  const out = new Float32Array(size * size);
  for (let i = 0; i < n; i++) out.set(a.subarray(i * n, i * n + n), i * size);
  return { data: out, size };
}

/** 16x16 shared-memory tiled matmul. As many tiles as needed, so any pad size works. */
export function matmulWgsl(size: number): string {
  return `
const N: u32 = ${size}u;
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> c: array<f32>;

var<workgroup> ta: array<f32, 256>;
var<workgroup> tb: array<f32, 256>;

@compute @workgroup_size(16, 16)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let row = wid.y * 16u + lid.y;
  let col = wid.x * 16u + lid.x;
  var acc = 0.0;
  let tiles = (N + 15u) / 16u;
  for (var t = 0u; t < tiles; t = t + 1u) {
    ta[lid.y * 16u + lid.x] = a[row * N + (t * 16u + lid.x)];
    tb[lid.y * 16u + lid.x] = b[(t * 16u + lid.y) * N + col];
    workgroupBarrier();
    for (var k = 0u; k < 16u; k = k + 1u) {
      acc = acc + ta[lid.y * 16u + k] * tb[k * 16u + lid.x];
    }
    workgroupBarrier();
  }
  c[row * N + col] = acc;
}`;
}

async function matmulOnDevice(dev: GpuDevice, a: Float32Array, b: Float32Array, n: number): Promise<Float32Array> {
  const { data: ap, size } = pad16(a, n);
  const { data: bp } = pad16(b, n);
  const ab = makeBuffer(dev, ap, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC);
  const bb = makeBuffer(dev, bp, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC);
  const cb = makeBuffer(dev, size * size * 4, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC);
  runCompute(dev, { code: matmulWgsl(size), buffers: [ab, bb, cb], workgroups: [size / 16, size / 16] });
  const raw = await readBuffer(dev, cb, size * size * 4);
  ab.destroy(); bb.destroy(); cb.destroy();
  const full = new Float32Array(raw);
  if (size === n) return full;
  const out = new Float32Array(n * n);
  for (let i = 0; i < n; i++) out.set(full.subarray(i * size, i * size + n), i * n);
  return out;
}

/**
 * GPU matmul. Pads to a multiple of 16, times the GPU dispatch including the
 * readback, and returns only the n x n answer. Throws when WebGPU is unavailable
 * (callers show the CPU path instead).
 */
export async function matmulGpu(a: Float32Array, b: Float32Array, n: number): Promise<Float32Array> {
  const gpu = await getGpu();
  if (!gpu) throw new Error('WebGPU is not available on this device');
  return matmulOnDevice(gpu.device, a, b, n);
}

/** Deterministic seeded uniform values in [0, 1): no external RNG library. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BenchResult {
  n: number;
  cpuMs: number;
  gpuMs: number;
  gflopsCpu: number;
  gflopsGpu: number;
  maxAbsDiff: number;
  gpu: boolean;
  /** True when a small identity multiply on the GPU reproduced its input bit-exactly. */
  identityExact: boolean;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Time both paths on two seeded random n x n matrices. One GPU warm-up run is
 * discarded. GPU time includes buffer upload, dispatch and readback.
 * gflopsGpu is 0 when no WebGPU device is available; maxAbsDiff is then NaN.
 */
export async function benchmark(n: number = 512): Promise<BenchResult> {
  const rnd = mulberry32(0x5eed);
  const a = new Float32Array(n * n), b = new Float32Array(n * n);
  for (let i = 0; i < a.length; i++) { a[i] = rnd(); b[i] = rnd(); }
  const t0 = now();
  const c = matmulCpu(a, b, n);
  const cpuMs = now() - t0;

  const gpu = await getGpu();
  if (!gpu) {
    return { n, cpuMs, gpuMs: 0, gflopsCpu: 2 * n ** 3 / (cpuMs / 1000) / 1e9, gflopsGpu: 0, maxAbsDiff: NaN, gpu: false, identityExact: false };
  }
  // Exactness check on a small identity product (exercises the same kernel).
  const idSize = 32;
  const ident = new Float32Array(idSize * idSize);
  for (let i = 0; i < idSize; i++) ident[i * idSize + i] = 1;
  const probe = new Float32Array(idSize * idSize);
  const prnd = mulberry32(7);
  for (let i = 0; i < probe.length; i++) probe[i] = prnd();
  const probeOut = await matmulOnDevice(gpu.device, ident, probe, idSize);
  const identityExact = probeOut.every((v, i) => v === probe[i]);

  await matmulOnDevice(gpu.device, a, b, n); // warm-up: pipeline + shader compilation
  const t1 = now();
  const g = await matmulOnDevice(gpu.device, a, b, n);
  const gpuMs = now() - t1;
  let maxAbsDiff = 0;
  for (let i = 0; i < c.length; i++) maxAbsDiff = Math.max(maxAbsDiff, Math.abs(c[i] - g[i]));
  const flops = 2 * n ** 3;
  return {
    n,
    cpuMs,
    gpuMs,
    gflopsCpu: flops / (cpuMs / 1000) / 1e9,
    gflopsGpu: flops / (gpuMs / 1000) / 1e9,
    maxAbsDiff,
    gpu: true,
    identityExact,
  };
}
