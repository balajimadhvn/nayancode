import { exposeKernels, type Kernel } from '@/compute/rpc';
import * as k from './kernels';

export interface RunArgs { dense?: string; mtx?: string; features?: string; barcodes?: string; batches?: string; params: k.ScParams }
/** 10x-style barcode suffixes (-1, -2, …) mark the sample when no table is given. */
const inferBatches = (cells: string[]): string[] | undefined => { const s = cells.map((c) => c.match(/-(\d+)$/)?.[1]); return s.every(Boolean) && new Set(s).size > 1 ? (s as string[]) : undefined; };
const run: Kernel<RunArgs, k.ScResult> = (a, ctx) => {
  ctx.progress(0.01, 'Parsing matrix');
  const m = a.dense !== undefined ? k.parseDenseMatrix(a.dense) : k.parseMtx(a.mtx!, a.features!, a.barcodes!);
  const batch = a.batches ? k.parseBatches(a.batches, m.cells) : a.params.integrate ? inferBatches(m.cells) : undefined;
  if (a.params.integrate && !batch) throw new Error('Batch integration needs batch labels: load a barcode,batch table, or use barcodes that end in -1, -2, … for each sample.');
  return k.runSingleCell(m, a.params, (f, n) => ctx.progress(f, n), batch);
};
const spatial: Kernel<{ coords: [number, number][]; genes: { name: string; v: Float32Array }[] }, ReturnType<typeof k.morans>> = (a) => k.morans(a.coords, a.genes, 6, 199, 3, 15);
export type ScKernels = { run: typeof run; spatial: typeof spatial };
exposeKernels({ run, spatial } as Record<string, Kernel>);
