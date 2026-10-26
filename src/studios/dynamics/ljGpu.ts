/**
 * Lennard-Jones fluid on WebGPU (f32). Two dispatches per step:
 *   1. half kick + drift + wrap (positions and velocities stay on the GPU)
 *   2. all-pairs force, half kick, per-atom potential energy and virial
 * The CPU twin is lj.ts; ljGpuParity is checked in e2e/gpu/dynamics.spec.ts.
 */
import { makeFcc, maxwell } from './lj';
import { getGpu, makeBuffer, readBuffer, runCompute, USAGE, type GpuBuffer, type GpuDevice } from '@/compute/gpu';

export interface LjPlan {
  fits: boolean;
  bytesPerBuffer: number;
  stepsPerSubmit: number;
  batches: number;
  reason?: string;
}

/**
 * Decide whether all-pairs data fits the visitor's granted limits and how many
 * steps to submit before yielding. Defaults are the WebGPU base-spec limits,
 * not numbers measured on one laptop; a 1 MiB mock limit must fail cleanly.
 */
export function planLjGpu(nAtoms: number, limits: { maxStorageBufferBindingSize?: number; maxBufferSize?: number } = {}, opts: { steps?: number; targetStepsPerSubmit?: number } = {}): LjPlan {
  const maxStorage = limits.maxStorageBufferBindingSize ?? 128 * 1024 * 1024;
  const maxBuffer = limits.maxBufferSize ?? 256 * 1024 * 1024;
  const bytesPerBuffer = Math.max(16, nAtoms * 12);
  const steps = Math.max(1, Math.floor(opts.steps ?? 1000));
  if (bytesPerBuffer > maxStorage || bytesPerBuffer > maxBuffer) {
    return { fits: false, bytesPerBuffer, stepsPerSubmit: 0, batches: 0, reason: `Needs ${(bytesPerBuffer / 1024 / 1024).toFixed(1)} MiB per buffer; this device allows ${(Math.min(maxStorage, maxBuffer) / 1024 / 1024).toFixed(1)} MiB. Use the CPU path or fewer atoms.` };
  }
  const stepsPerSubmit = Math.max(1, Math.min(opts.targetStepsPerSubmit ?? 20, steps));
  return { fits: true, bytesPerBuffer, stepsPerSubmit, batches: Math.ceil(steps / stepsPerSubmit) };
}

const uniform = (L: number, rc: number, dt: number, shift: boolean) => new Float32Array([L, rc, dt, shift ? 1 : 0]);

/** Header binding only the buffers a shader actually reads or writes: auto layouts drop unused bindings. */
const head = (n: number, storage: string[]) => `
const N: u32 = ${n}u;
struct P { L: f32, rc: f32, dt: f32, shift: f32 };
${storage.map((s, i) => `@group(0) @binding(${i}) var<storage, read_write> ${s}: array<f32>;`).join('\n')}
@group(0) @binding(${storage.length}) var<uniform> p: P;
`;

const KICK_BUFFERS = ['pos', 'vel', 'frc'];
const FORCE_BUFFERS = ['pos', 'vel', 'frc', 'pe', 'vir'];
const THERMO_BUFFERS = ['vel'];

export function kickWgsl(n: number): string {
  return `${head(n, KICK_BUFFERS)}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= N) { return; }
  let i3 = i * 3u;
  var v = vec3<f32>(vel[i3], vel[i3 + 1u], vel[i3 + 2u]) + 0.5 * p.dt * vec3<f32>(frc[i3], frc[i3 + 1u], frc[i3 + 2u]);
  var x = vec3<f32>(pos[i3], pos[i3 + 1u], pos[i3 + 2u]) + v * p.dt;
  x = x - p.L * floor(x / p.L);
  vel[i3] = v.x; vel[i3 + 1u] = v.y; vel[i3 + 2u] = v.z;
  pos[i3] = x.x; pos[i3 + 1u] = x.y; pos[i3 + 2u] = x.z;
}`;
}

export function forceWgsl(n: number): string {
  return `${head(n, FORCE_BUFFERS)}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= N) { return; }
  let i3 = i * 3u;
  let xi = vec3<f32>(pos[i3], pos[i3 + 1u], pos[i3 + 2u]);
  var f = vec3<f32>(0.0, 0.0, 0.0);
  var e = 0.0;
  var w = 0.0;
  for (var j = 0u; j < N; j = j + 1u) {
    if (j == i) { continue; }
    let j3 = j * 3u;
    var d = xi - vec3<f32>(pos[j3], pos[j3 + 1u], pos[j3 + 2u]);
    d = d - p.L * round(d / p.L);
    let r2 = dot(d, d);
    if (r2 < p.rc * p.rc && r2 > 1e-12) {
      let inv2 = 1.0 / r2;
      let inv6 = inv2 * inv2 * inv2;
      let inv12 = inv6 * inv6;
      let u = 4.0 * (inv12 - inv6) - select(0.0, 4.0 * (1.0 / pow(p.rc, 12.0) - 1.0 / pow(p.rc, 6.0)), p.shift > 0.5);
      let s = 24.0 * (2.0 * inv12 - inv6) * inv2;
      e = e + 0.5 * u;
      w = w + 0.5 * s * r2;
      f = f + s * d;
    }
  }
  let v = vec3<f32>(vel[i3], vel[i3 + 1u], vel[i3 + 2u]) + 0.5 * p.dt * f;
  frc[i3] = f.x; frc[i3 + 1u] = f.y; frc[i3 + 2u] = f.z;
  vel[i3] = v.x; vel[i3 + 1u] = v.y; vel[i3 + 2u] = v.z;
  pe[i] = e;
  vir[i] = w;
}`;
}

export function thermostatWgsl(n: number): string {
  return `${head(n, THERMO_BUFFERS)}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= N) { return; }
  let i3 = i * 3u;
  vel[i3] = vel[i3] * p.dt;
  vel[i3 + 1u] = vel[i3 + 1u] * p.dt;
  vel[i3 + 2u] = vel[i3 + 2u] * p.dt;
}`;
}

/** Multiply every velocity by sqrt(1 + (dt/tau)(T0/T - 1)); clamp as Berendsen does. */
export function applyLjGpuThermostat(s: LjGpuState, targetT: number, T: number, dt: number, tau = 0.5) {
  const lam = Math.sqrt(Math.max(0.01, 1 + (dt / tau) * (targetT / Math.max(T, 1e-9) - 1)));
  const c = Math.min(1.25, Math.max(0.8, lam));
  if (Math.abs(c - 1) < 1e-6) return;
  runCompute(s.dev, { code: thermostatWgsl(s.n), buffers: [s.vel], uniforms: uniform(0, 0, c, false), workgroups: [Math.ceil(s.n / 64)] });
}

export interface LjGpuState {
  n: number; L: number; rho: number; rc: number; shift: boolean;
  dev: GpuDevice;
  pos: GpuBuffer; vel: GpuBuffer; frc: GpuBuffer; peBuf: GpuBuffer; virBuf: GpuBuffer;
  stepsDone: number;
}

export interface LjGpuSnapshot { pos: Float64Array; vel: Float64Array; temperature: number; pe: number; virial: number }

/** Create a device-resident state from the same fcc + Maxwell initial state as the CPU. */
export async function createLjGpu(nCells: number, rho: number, T: number, seed: number, rc = 2.5, shift = true): Promise<LjGpuState | null> {
  const gpu = await getGpu();
  if (!gpu) return null;
  const { pos, L, n } = makeFcc(nCells, rho);
  const plan = planLjGpu(n, gpu.limits);
  if (!plan.fits) return null;
  const vel = maxwell(n, T, seed);
  const toF32 = (a: Float64Array) => new Float32Array(a);
  const dev = gpu.device;
  const state: LjGpuState = {
    n, L, rho, rc, shift, dev,
    pos: makeBuffer(dev, toF32(pos), USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC),
    vel: makeBuffer(dev, toF32(vel), USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC),
    frc: makeBuffer(dev, 12 * n, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC),
    peBuf: makeBuffer(dev, 4 * n, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC),
    virBuf: makeBuffer(dev, 4 * n, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC),
    stepsDone: 0,
  };
  // Initial forces: dt = 0 makes the kick a no-op.
  runCompute(dev, { code: forceWgsl(n), buffers: [state.pos, state.vel, state.frc, state.peBuf, state.virBuf], uniforms: uniform(L, rc, 0, shift), workgroups: [Math.ceil(n / 64)] });
  return state;
}

export interface LjRunResult { steps: number; ms: number; stepsPerSecond: number }

/** Run `steps` velocity-Verlet steps, yielding to the queue between small batches. */
export async function runLjGpu(s: LjGpuState, steps: number, dt: number, opts: { batch?: number } = {}): Promise<LjRunResult> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const plan = planLjGpu(s.n, {}, { steps, targetStepsPerSubmit: opts.batch ?? 20 });
  const batch = Math.max(1, plan.stepsPerSubmit);
  const u = uniform(s.L, s.rc, dt, s.shift);
  for (let done = 0; done < steps; done += batch) {
    const k = Math.min(batch, steps - done);
    for (let q = 0; q < k; q++) {
      runCompute(s.dev, { code: kickWgsl(s.n), buffers: [s.pos, s.vel, s.frc], uniforms: u, workgroups: [Math.ceil(s.n / 64)] });
      runCompute(s.dev, { code: forceWgsl(s.n), buffers: [s.pos, s.vel, s.frc, s.peBuf, s.virBuf], uniforms: u, workgroups: [Math.ceil(s.n / 64)] });
    }
    await s.dev.queue.onSubmittedWorkDone();
  }
  s.stepsDone += steps;
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { steps, ms, stepsPerSecond: steps / Math.max(ms / 1000, 1e-9) };
}

/** Read positions, velocities, potential energy and virial back to the CPU (for drawing and checks). */
export async function readLjGpu(s: LjGpuState): Promise<LjGpuSnapshot> {
  const [p, v, pe, vir] = await Promise.all([
    readBuffer(s.dev, s.pos, 12 * s.n),
    readBuffer(s.dev, s.vel, 12 * s.n),
    readBuffer(s.dev, s.peBuf, 4 * s.n),
    readBuffer(s.dev, s.virBuf, 4 * s.n),
  ]);
  const pos = Float64Array.from(new Float32Array(p));
  const vel = Float64Array.from(new Float32Array(v));
  const peArr = new Float32Array(pe), virArr = new Float32Array(vir);
  let peSum = 0, virSum = 0, kin = 0;
  for (let i = 0; i < s.n; i++) { peSum += peArr[i]; virSum += virArr[i]; }
  for (let i = 0; i < 3 * s.n; i++) kin += 0.5 * vel[i] * vel[i];
  return { pos, vel, temperature: (2 * kin) / (3 * (s.n - 1)), pe: peSum, virial: virSum };
}

export function disposeLjGpu(s: LjGpuState | null) {
  if (!s) return;
  s.pos.destroy(); s.vel.destroy(); s.frc.destroy(); s.peBuf.destroy(); s.virBuf.destroy();
}
