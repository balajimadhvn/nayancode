/**
 * Exact Euclidean k-nearest-neighbour search on WebGPU.
 *
 * One invocation owns one query cell and keeps a k-sized insertion-sorted list
 * in private memory (k <= 50). Queries are processed in batches so that one
 * submission stays short on integrated GPUs / Windows watchdogs. The CPU
 * reference below uses the same selection rule, so the two paths can be compared
 * on identical input.
 */
import { getGpu, makeBuffer, readBuffer, runCompute, USAGE } from '@/compute/gpu';

export const MAX_K = 50;
export const MAX_DIMS = 100;
const DEFAULT_TARGET = 512;

export interface KnnResult { idx: Int32Array; dist: Float32Array }
export interface KnnGpuResult extends KnnResult { ms: number; plan: KnnPlan }
export interface KnnPlan {
  fits: boolean; cells: number; dims: number; k: number;
  perBatch: number; batches: number; bytesPerBatch: number; xBytes: number; reason?: string;
}

/** Plan batches from the granted limits, never from one machine's constants. */
export function planKnnGpu(
  cells: number, dims: number, k: number,
  limits: { maxStorageBufferBindingSize?: number; maxBufferSize?: number } = {},
): KnnPlan {
  const kk = Math.min(k, Math.max(0, cells - 1));
  const empty = { fits: false, cells, dims, k: kk, perBatch: 0, batches: 0, bytesPerBatch: 0, xBytes: 0 };
  if (cells <= 1 || dims <= 0 || kk <= 0) return { ...empty, reason: 'Need at least two cells, one dimension and one neighbour.' };
  if (dims > MAX_DIMS || kk > MAX_K) return { ...empty, reason: `This GPU kernel supports at most ${MAX_DIMS} dimensions and ${MAX_K} neighbours.` };
  const cap = Math.min(limits.maxStorageBufferBindingSize ?? 128 * 1024 * 1024, limits.maxBufferSize ?? 256 * 1024 * 1024);
  const xBytes = cells * dims * 4;
  if (xBytes > cap) return { ...empty, reason: `The coordinate matrix (${(xBytes / 1024 / 1024).toFixed(1)} MiB) exceeds this device's ${(cap / 1024 / 1024).toFixed(1)} MiB binding limit; use the CPU path.` };
  const perQuery = kk * 8;
  const perBatch = Math.max(1, Math.min(cells, Math.floor((cap - 4096) / perQuery), DEFAULT_TARGET));
  return { fits: true, cells, dims, k: kk, perBatch, batches: Math.ceil(cells / perBatch), bytesPerBatch: perBatch * perQuery, xBytes };
}

/** CPU reference: exact Euclidean k-NN, self excluded, nearest first. */
export function knnCpu(X: Float32Array, cells: number, dims: number, k: number, onProgress?: (fraction: number) => void): KnnResult {
  if (cells <= 1 || dims <= 0) throw new Error('kNN needs at least two cells and one dimension.');
  const kk = Math.min(k, cells - 1);
  if (kk <= 0) throw new Error('k must be at least 1.');
  const idx = new Int32Array(cells * kk), dist = new Float32Array(cells * kk);
  const bi = new Int32Array(kk), bd = new Float64Array(kk);
  for (let i = 0; i < cells; i++) {
    bd.fill(Infinity); bi.fill(-1);
    const off = i * dims;
    for (let j = 0; j < cells; j++) {
      if (j === i) continue;
      const oj = j * dims;
      let s = 0;
      for (let c = 0; c < dims; c++) { const t = X[off + c] - X[oj + c]; s += t * t; }
      if (s < bd[kk - 1]) {
        let pos = kk - 1;
        while (pos > 0 && bd[pos - 1] > s) { bd[pos] = bd[pos - 1]; bi[pos] = bi[pos - 1]; pos--; }
        bd[pos] = s; bi[pos] = j;
      }
    }
    for (let t = 0; t < kk; t++) { idx[i * kk + t] = bi[t]; dist[i * kk + t] = Math.sqrt(bd[t]); }
    if (onProgress && (i % 128 === 0 || i === cells - 1)) onProgress((i + 1) / cells);
  }
  return { idx, dist };
}

export function knnWgsl(): string {
  return `
struct P { cells: u32, dims: u32, k: u32, base: u32 };
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> outIdx: array<u32>;
@group(0) @binding(2) var<storage, read_write> outDist: array<f32>;
@group(0) @binding(3) var<uniform> p: P;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let qi = p.base + gid.x;
  if (qi >= p.cells) { return; }
  var bi: array<u32, 50>;
  var bd: array<f32, 50>;
  for (var t = 0u; t < 50u; t++) { bi[t] = 0u; bd[t] = 1e30; }
  let off = qi * p.dims;
  for (var j = 0u; j < p.cells; j++) {
    if (j == qi) { continue; }
    let oj = j * p.dims;
    var s = 0.0;
    for (var c = 0u; c < p.dims; c++) { let t = X[off + c] - X[oj + c]; s = s + t * t; }
    if (s < bd[p.k - 1u]) {
      var pos = p.k - 1u;
      loop {
        if (pos == 0u) { break; }
        if (bd[pos - 1u] <= s) { break; }
        bd[pos] = bd[pos - 1u]; bi[pos] = bi[pos - 1u]; pos = pos - 1u;
      }
      bd[pos] = s; bi[pos] = j;
    }
  }
  let o = gid.x * p.k;
  for (var t = 0u; t < p.k; t = t + 1u) { outIdx[o + t] = bi[t]; outDist[o + t] = sqrt(bd[t]); }
}`;
}

const uniform = (cells: number, dims: number, k: number, base: number) => new Uint32Array([cells, dims, k, base]);

/** Run exact kNN on the GPU; returns null when WebGPU is unavailable or cannot fit. */
export async function knnGpu(
  X: Float32Array, cells: number, dims: number, k: number,
  onProgress?: (fraction: number) => void,
): Promise<KnnGpuResult | null> {
  const gpu = await getGpu();
  if (!gpu) return null;
  const plan = planKnnGpu(cells, dims, k, gpu.limits);
  if (!plan.fits) return null;
  const dev = gpu.device, kk = plan.k;
  const idx = new Int32Array(cells * kk), dist = new Float32Array(cells * kk);
  const t0 = performance.now();
  const xBuf = makeBuffer(dev, X.subarray(0, cells * dims), USAGE.STORAGE | USAGE.COPY_DST);
  const outIdx = makeBuffer(dev, plan.perBatch * kk * 4, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC);
  const outDist = makeBuffer(dev, plan.perBatch * kk * 4, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC);
  try {
    for (let base = 0; base < cells; base += plan.perBatch) {
      const count = Math.min(plan.perBatch, cells - base);
      runCompute(dev, { code: knnWgsl(), buffers: [xBuf, outIdx, outDist], uniforms: uniform(cells, dims, kk, base), workgroups: [Math.ceil(count / 64)] });
      const ib = await readBuffer(dev, outIdx, count * kk * 4);
      const db = await readBuffer(dev, outDist, count * kk * 4);
      idx.set(new Int32Array(ib), base * kk);
      dist.set(new Float32Array(db), base * kk);
      onProgress?.((base + count) / cells);
    }
    return { idx, dist, ms: performance.now() - t0, plan };
  } catch {
    return null;
  } finally {
    xBuf.destroy(); outIdx.destroy(); outDist.destroy();
  }
}
