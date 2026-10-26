/** Worker kernels for the Go-model tab: folding runs and a temperature scan. */
import { exposeKernels, type KernelCtx } from '@/compute/rpc';
import { buildGoModel } from './go';
import { caToPdb, caTrace } from './goParse';
import { initGo, runGo, type GoObserved } from './goSim';

export interface GoRunArgs { pdb: string; chain?: string; T: number; steps: number; seed?: number; dt?: number; gamma?: number; every?: number }
export interface GoFrame { step: number; t: number; Q: number; rmsd: number; rg: number; energy: number; temperature: number }
export interface GoRunResult { frames: GoFrame[]; pdb: string; n: number; contacts: number; ms: number }
export interface GoScanArgs { pdb: string; chain?: string; temps?: number[]; steps?: number; seed?: number; dt?: number; gamma?: number }
export interface GoScanResult { points: { T: number; meanQ: number }[]; ms: number }

export type GoKernels = {
  run(arg: GoRunArgs, ctx: KernelCtx): Promise<GoRunResult>;
  scan(arg: GoScanArgs, ctx: KernelCtx): Promise<GoScanResult>;
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const kernels: GoKernels = {
  async run(arg, ctx) {
    const t0 = now();
    const ca = caTrace(arg.pdb, arg.chain);
    const model = buildGoModel(ca);
    const steps = Math.max(1, Math.min(200_000, Math.floor(arg.steps)));
    const every = Math.max(10, Math.floor(arg.every ?? 100));
    const s = initGo(model, arg.T, arg.seed ?? 1);
    const frames: GoFrame[] = [];
    const models: string[] = [];
    runGo(s, steps, arg.dt ?? 0.005, {
      T: arg.T, gamma: arg.gamma ?? 0.05, every,
      onFrame: (step, o: GoObserved) => {
        frames.push({ step, t: s.t, Q: o.Q, rmsd: o.rmsd, rg: o.rg, energy: o.energy, temperature: o.temperature });
        const coords = { x: Float64Array.from(s.c.x), y: Float64Array.from(s.c.y), z: Float64Array.from(s.c.z) };
        models.push(caToPdb(ca, coords, models.length + 1));
        ctx.progress(Math.min(1, step / steps), `${step} / ${steps} steps · Q ${o.Q.toFixed(2)}`);
      },
    });
    return { frames, pdb: models.join('') + 'END\n', n: ca.n, contacts: model.native.length, ms: now() - t0 };
  },

  async scan(arg, ctx) {
    const t0 = now();
    const ca = caTrace(arg.pdb, arg.chain);
    const model = buildGoModel(ca);
    const temps = arg.temps ?? [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
    const steps = Math.max(1000, Math.min(50_000, Math.floor(arg.steps ?? 20_000)));
    const points: { T: number; meanQ: number }[] = [];
    temps.forEach((T, i) => {
      const s = initGo(model, T, (arg.seed ?? 1) + i);
      let q = 0, n = 0;
      runGo(s, steps, arg.dt ?? 0.005, {
        T, gamma: arg.gamma ?? 0.05, every: 200,
        onFrame: (step, o) => {
          if (step > steps * 0.25) { q += o.Q; n++; }
          ctx.progress((i + step / steps) / temps.length, `T ${T.toFixed(1)} · ${step} / ${steps}`);
        },
      });
      points.push({ T, meanQ: q / Math.max(1, n) });
    });
    return { points, ms: now() - t0 };
  },
};

exposeKernels(kernels);
export default kernels;
