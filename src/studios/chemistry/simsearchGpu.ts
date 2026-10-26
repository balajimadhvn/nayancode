/**
 * WebGPU Tanimoto comparison and Butina neighbour bitmap.
 *
 * Similarity: one invocation per database molecule, 64 words each, f32 output.
 * Butina: one invocation per (row, column) pair writes a bit into an N x words
 * bitmap with atomicOr; the bitmap is read back and the centroid algorithm runs
 * on the CPU. This is the simplest correct approach and keeps the GPU work
 * bounded to row tiles so one submission stays short (ADDENDUM, RULES 9).
 */
import { getGpu, makeBuffer, readBuffer, runCompute, USAGE } from '@/compute/gpu';
import { butinaFromBitmap, FP_WORDS, MAX_BUTINA, type ButinaResult } from './simsearch';

export interface SimPlan { fits: boolean; bytesPerBatch: number; perBatch: number; batches: number; reason?: string }

/** Plan Tanimoto batches from the granted limits, never from one machine's constants. */
export function planSimSearchGpu(
  n: number,
  limits: { maxStorageBufferBindingSize?: number; maxBufferSize?: number } = {},
  opts: { targetPerBatch?: number } = {},
): SimPlan {
  const maxStorage = limits.maxStorageBufferBindingSize ?? 128 * 1024 * 1024;
  const maxBuffer = limits.maxBufferSize ?? 256 * 1024 * 1024;
  const cap = Math.min(maxStorage, maxBuffer);
  const bytesPerMolecule = FP_WORDS * 4 + 4;
  if (n <= 0) return { fits: false, bytesPerBatch: 0, perBatch: 0, batches: 0, reason: 'No molecules to compare.' };
  if (4 * n > cap) return { fits: false, bytesPerBatch: 0, perBatch: 0, batches: 0, reason: `The result buffer (${(4 * n / 1024 / 1024).toFixed(1)} MiB) exceeds this device's ${(cap / 1024 / 1024).toFixed(1)} MiB limit. Use the CPU path.` };
  const perBatch = Math.max(1, Math.min(n, Math.floor((cap - 4096) / bytesPerMolecule), opts.targetPerBatch ?? 8192));
  return { fits: true, bytesPerBatch: perBatch * FP_WORDS * 4 + 4 * perBatch, perBatch, batches: Math.ceil(n / perBatch) };
}

export function tanimotoWgsl(): string {
  return `
struct P { n: u32, outBase: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> query: array<u32>;
@group(0) @binding(1) var<storage, read> db: array<u32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<uniform> p: P;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= p.n) { return; }
  var inter: u32 = 0u;
  var uni: u32 = 0u;
  let base = i * 64u;
  for (var w = 0u; w < 64u; w = w + 1u) {
    let x = query[w];
    let y = db[base + w];
    inter = inter + countOneBits(x & y);
    uni = uni + countOneBits(x | y);
  }
  out[p.outBase + i] = select(0.0, f32(inter) / f32(uni), uni > 0u);
}`;
}

export function butinaBitmapWgsl(): string {
  return `
struct P { n: u32, words: u32, cutoff: f32, baseRow: u32 };
@group(0) @binding(0) var<storage, read> db: array<u32>;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;
@group(0) @binding(2) var<uniform> p: P;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let j = g.x;
  let i = g.y + p.baseRow;
  if (i >= p.n || j >= p.n || i == j) { return; }
  var inter: u32 = 0u;
  var uni: u32 = 0u;
  let ai = i * 64u;
  let bj = j * 64u;
  for (var w = 0u; w < 64u; w = w + 1u) {
    let x = db[ai + w];
    let y = db[bj + w];
    inter = inter + countOneBits(x & y);
    uni = uni + countOneBits(x | y);
  }
  if (uni > 0u) {
    let sim = f32(inter) / f32(uni);
    if (1.0 - sim <= p.cutoff) {
      atomicOr(&out[i * p.words + (j >> 5u)], 1u << (j & 31u));
    }
  }
}`;
}

const simUniform = (n: number, outBase: number) => new Uint32Array([n, outBase, 0, 0]);
const butinaUniform = (n: number, words: number, cutoff: number, baseRow: number) => {
  const b = new ArrayBuffer(16), v = new DataView(b);
  v.setUint32(0, n, true); v.setUint32(4, words, true); v.setFloat32(8, cutoff, true); v.setUint32(12, baseRow, true);
  return b;
};

export interface TanimotoGpuResult { sims: Float32Array; ms: number }

/** Compare one query fingerprint with every row of the packed database. */
export async function gpuTanimoto(fps: Uint32Array, queryFp: Uint32Array, onProgress?: (fraction: number) => void): Promise<TanimotoGpuResult | null> {
  const n = Math.floor(fps.length / FP_WORDS);
  if (n <= 0 || queryFp.length < FP_WORDS) return null;
  const gpu = await getGpu();
  if (!gpu) return null;
  const plan = planSimSearchGpu(n, gpu.limits);
  if (!plan.fits) return null;
  const dev = gpu.device;
  const t0 = performance.now();
  const qBuf = makeBuffer(dev, new Uint32Array(queryFp.subarray(0, FP_WORDS)), USAGE.STORAGE | USAGE.COPY_DST);
  const dbBuf = makeBuffer(dev, Math.max(16, plan.perBatch * FP_WORDS * 4), USAGE.STORAGE | USAGE.COPY_DST);
  const outBuf = makeBuffer(dev, 4 * n, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC);
  try {
    for (let base = 0; base < n; base += plan.perBatch) {
      const count = Math.min(plan.perBatch, n - base);
      dev.queue.writeBuffer(dbBuf, 0, fps.subarray(base * FP_WORDS, (base + count) * FP_WORDS));
      runCompute(dev, { code: tanimotoWgsl(), buffers: [qBuf, dbBuf, outBuf], uniforms: simUniform(count, base), workgroups: [Math.ceil(count / 64)] });
      onProgress?.((base + count) / n);
    }
    await dev.queue.onSubmittedWorkDone();
    const raw = await readBuffer(dev, outBuf, 4 * n);
    return { sims: Float32Array.from(new Float32Array(raw)), ms: performance.now() - t0 };
  } finally {
    qBuf.destroy(); dbBuf.destroy(); outBuf.destroy();
  }
}

/** Build the full neighbour bitmap on the GPU, then cluster from it on the CPU. */
export async function gpuButina(fps: Uint32Array, n: number, cutoff: number, onProgress?: (fraction: number) => void): Promise<ButinaResult | null> {
  if (n <= 0 || n > MAX_BUTINA) return null;
  const gpu = await getGpu();
  if (!gpu) return null;
  const words = Math.ceil(n / 32);
  const bitmapBytes = 4 * n * words;
  if (bitmapBytes > Math.min(gpu.limits.maxStorageBufferBindingSize ?? 0, gpu.limits.maxBufferSize ?? 0)) return null;
  const dev = gpu.device;
  const dbBuf = makeBuffer(dev, fps.subarray(0, n * FP_WORDS), USAGE.STORAGE | USAGE.COPY_DST);
  const out = makeBuffer(dev, bitmapBytes, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC);
  const tile = 512;
  try {
    for (let baseRow = 0; baseRow < n; baseRow += tile) {
      runCompute(dev, {
        code: butinaBitmapWgsl(), buffers: [dbBuf, out],
        uniforms: butinaUniform(n, words, cutoff, baseRow),
        workgroups: [Math.ceil(n / 16), Math.ceil(Math.min(tile, n - baseRow) / 16)],
      });
      await dev.queue.onSubmittedWorkDone();
      onProgress?.(Math.min(1, (baseRow + tile) / n));
    }
    const raw = await readBuffer(dev, out, bitmapBytes);
    return butinaFromBitmap(new Uint32Array(raw), n);
  } finally {
    dbBuf.destroy(); out.destroy();
  }
}

/** True when the granted limits can hold the full N x N/32 bitmap. */
export function butinaFitsGpu(n: number, limits: { maxStorageBufferBindingSize?: number; maxBufferSize?: number } = {}): boolean {
  if (n <= 0 || n > MAX_BUTINA) return false;
  const bytes = 4 * n * Math.ceil(n / 32);
  const cap = Math.min(limits.maxStorageBufferBindingSize ?? 128 * 1024 * 1024, limits.maxBufferSize ?? 256 * 1024 * 1024);
  return bytes <= cap;
}
