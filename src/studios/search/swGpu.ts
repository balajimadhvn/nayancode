/**
 * Exhaustive Smith-Waterman (affine Gotoh) on WebGPU.
 * One invocation per database sequence; the query, BLOSUM62 and the database
 * live in storage buffers. Each thread keeps H[1025] and E[1025] in private
 * memory, so queries longer than 1024 residues go to the CPU path.
 * Scores are integers, so GPU and CPU results can be compared exactly.
 */
import { getGpu, makeBuffer, readBuffer, runCompute, USAGE, type GpuBuffer, type GpuDevice } from '@/compute/gpu';
import { BLOSUM62_MATRIX } from './sw';

export interface SearchPlan {
  fits: boolean;
  bytesPerSeq: number;
  bytesPerBatch: number;
  seqsPerBatch: number;
  batches: number;
  reason?: string;
}

/**
 * Split the database so that one codes buffer, one offsets buffer and one
 * scores buffer all fit the limits WebGPU actually granted. Defaults are the
 * base WebGPU limits (128 MiB storage binding / 256 MiB buffer), never a
 * number measured on the developer's machine.
 */
export function planSearchGpu(
  nSeq: number,
  residues: number,
  queryLen: number,
  limits: { maxStorageBufferBindingSize?: number; maxBufferSize?: number } = {},
  opts: { targetSeqsPerBatch?: number; longest?: number } = {},
): SearchPlan {
  const maxStorage = limits.maxStorageBufferBindingSize ?? 128 * 1024 * 1024;
  const maxBuffer = limits.maxBufferSize ?? 256 * 1024 * 1024;
  const cap = Math.min(maxStorage, maxBuffer);
  const n = Math.max(1, nSeq);
  const bytesPerSeq = residues / n;
  const longest = Math.max(1, opts.longest ?? bytesPerSeq);
  const fixed = 4 * queryLen + BLOSUM62_MATRIX.length * 4 + 4 * n;
  if (nSeq <= 0 || residues <= 0) {
    return { fits: false, bytesPerSeq, bytesPerBatch: 0, seqsPerBatch: 0, batches: 0, reason: 'The database is empty.' };
  }
  if (fixed > cap) {
    return { fits: false, bytesPerSeq, bytesPerBatch: 0, seqsPerBatch: 0, batches: 0, reason: `Even one batch needs ${(fixed / 1024 / 1024).toFixed(1)} MiB; this device allows ${(cap / 1024 / 1024).toFixed(1)} MiB. Use the CPU path.` };
  }
  const margin = 4096;
  const byBytes = Math.floor(Math.max(0, cap - margin) / (4 * (longest + 1)));
  const seqsPerBatch = Math.max(1, Math.min(nSeq, byBytes, opts.targetSeqsPerBatch ?? 4096));
  // Worst case: every sequence in the batch is as long as the longest one.
  const bytesPerBatch = 4 * (longest * seqsPerBatch + seqsPerBatch + 1);
  const batches = Math.ceil(nSeq / seqsPerBatch);
  return { fits: true, bytesPerSeq, bytesPerBatch, seqsPerBatch, batches };
}

const MAX_QUERY = 1024;

export function swWgsl(): string {
  return `
struct P { m: u32, n: u32, base: u32, pad: u32 };
@group(0) @binding(0) var<storage, read> query: array<u32>;
@group(0) @binding(1) var<storage, read> mat: array<i32>;
@group(0) @binding(2) var<storage, read> db: array<u32>;
@group(0) @binding(3) var<storage, read> offs: array<u32>;
@group(0) @binding(4) var<storage, read_write> scores: array<i32>;
@group(0) @binding(5) var<uniform> p: P;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let seq = gid.x;
  if (seq >= p.n) { return; }
  let m = p.m;
  var H: array<i32, 1025>;
  var E: array<i32, 1025>;
  for (var j = 0u; j <= m; j = j + 1u) { H[j] = 0; E[j] = -1000000000; }
  let start = offs[seq];
  let end = offs[seq + 1u];
  var best: i32 = 0;
  for (var i = start; i < end; i = i + 1u) {
    let sc = i32(db[i]);
    var hDiag: i32 = 0;
    var hLeft: i32 = 0;
    var eLeft: i32 = -1000000000;
    for (var j = 1u; j <= m; j = j + 1u) {
      let hPrev = H[j];
      let v = max(hPrev - 12, E[j] - 1);
      E[j] = v;
      eLeft = max(hLeft - 12, eLeft - 1);
      let qc = i32(query[j - 1u]);
      var pair: i32 = -1;
      if (qc < 24 && sc < 24) { pair = mat[qc * 24 + sc]; }
      let d = hDiag + pair;
      let h = max(0, max(d, max(v, eLeft)));
      H[j] = h;
      hDiag = hPrev;
      hLeft = h;
      best = max(best, h);
    }
  }
  scores[p.base + seq] = best;
}`;
}

export interface SearchGpuState {
  dev: GpuDevice;
  nSeq: number;
  m: number;
  queryBuf: GpuBuffer;
  matBuf: GpuBuffer;
  dbBuf: GpuBuffer;
  offBuf: GpuBuffer;
  scoreBuf: GpuBuffer;
  seqs: { codes: Uint8Array }[];
  plan: SearchPlan;
}

export interface SearchGpuResult { scores: Int32Array; cells: number; ms: number; gcups: number }

/** Build a device-resident search state; null when WebGPU is unavailable or the plan does not fit. */
export async function createSearchGpu(query: Uint8Array, seqs: { codes: Uint8Array }[], limitsHint: Record<string, number> = {}): Promise<SearchGpuState | null> {
  const m = query.length;
  if (m === 0 || m > MAX_QUERY || seqs.length === 0) return null;
  const gpu = await getGpu();
  if (!gpu) return null;
  let residues = 0;
  for (const s of seqs) residues += s.codes.length;
  let longest = 1;
  for (const s of seqs) longest = Math.max(longest, s.codes.length);
  const plan = planSearchGpu(seqs.length, residues, m, { ...gpu.limits, ...limitsHint }, { longest });
  if (!plan.fits) return null;
  const dev = gpu.device;
  const q = new Uint32Array(m);
  for (let i = 0; i < m; i++) q[i] = query[i];
  const mat = new Int32Array(BLOSUM62_MATRIX);
  return {
    dev, nSeq: seqs.length, m, seqs, plan,
    queryBuf: makeBuffer(dev, q, USAGE.STORAGE | USAGE.COPY_DST),
    matBuf: makeBuffer(dev, mat, USAGE.STORAGE | USAGE.COPY_DST),
    dbBuf: makeBuffer(dev, Math.max(16, plan.bytesPerBatch), USAGE.STORAGE | USAGE.COPY_DST),
    offBuf: makeBuffer(dev, 4 * (plan.seqsPerBatch + 1), USAGE.STORAGE | USAGE.COPY_DST),
    scoreBuf: makeBuffer(dev, 4 * seqs.length, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC),
  };
}

export async function runSearchGpu(s: SearchGpuState, onProgress?: (fraction: number) => void): Promise<SearchGpuResult> {
  const t0 = performance.now();
  const code = swWgsl();
  const per = s.plan.seqsPerBatch;
  let cells = 0;
  for (let base = 0; base < s.nSeq; base += per) {
    const count = Math.min(per, s.nSeq - base);
    let total = 0;
    for (let i = 0; i < count; i++) total += s.seqs[base + i].codes.length;
    const codes = new Uint32Array(total);
    const offs = new Uint32Array(count + 1);
    let k = 0;
    for (let i = 0; i < count; i++) {
      const seq = s.seqs[base + i].codes;
      offs[i] = k;
      for (let j = 0; j < seq.length; j++) codes[k++] = seq[j];
    }
    offs[count] = k;
    cells += k * s.m;
    s.dev.queue.writeBuffer(s.dbBuf, 0, codes);
    s.dev.queue.writeBuffer(s.offBuf, 0, offs);
    runCompute(s.dev, {
      code,
      buffers: [s.queryBuf, s.matBuf, s.dbBuf, s.offBuf, s.scoreBuf],
      uniforms: new Uint32Array([s.m, count, base, 0]),
      workgroups: [Math.ceil(count / 64)],
    });
    await s.dev.queue.onSubmittedWorkDone();
    onProgress?.((base + count) / s.nSeq);
  }
  const raw = await readBuffer(s.dev, s.scoreBuf, 4 * s.nSeq);
  const scores = Int32Array.from(new Int32Array(raw));
  const ms = performance.now() - t0;
  return { scores, cells, ms, gcups: cells / Math.max(ms, 1e-9) / 1e6 };
}

export function disposeSearchGpu(s: SearchGpuState | null) {
  if (!s) return;
  s.queryBuf.destroy(); s.matBuf.destroy(); s.dbBuf.destroy(); s.offBuf.destroy(); s.scoreBuf.destroy();
}
