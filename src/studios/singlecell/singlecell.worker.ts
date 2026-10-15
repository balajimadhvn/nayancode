import { exposeKernels, type Kernel } from '@/compute/rpc';
import * as k from './kernels';

export interface RunArgs { dense?: string; mtx?: string; features?: string; barcodes?: string; params: k.ScParams }
const run: Kernel<RunArgs, k.ScResult> = (a, ctx) => {
  ctx.progress(0.01, 'Parsing matrix');
  const m = a.dense !== undefined ? k.parseDenseMatrix(a.dense) : k.parseMtx(a.mtx!, a.features!, a.barcodes!);
  return k.runSingleCell(m, a.params, (f, n) => ctx.progress(f, n));
};
const spatial: Kernel<{ coords: [number, number][]; genes: { name: string; v: Float32Array }[] }, ReturnType<typeof k.morans>> = (a) => k.morans(a.coords, a.genes, 6, 199, 3, 15);
export type ScKernels = { run: typeof run; spatial: typeof spatial };
exposeKernels({ run, spatial } as Record<string, Kernel>);
