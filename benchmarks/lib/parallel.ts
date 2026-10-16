// Runs ML bootstrap replicates of the Workbench engine on all CPU cores (Node worker threads), as the browser does with
// Web Workers. The worker entry is bundled once with rolldown (Vite's bundler).
import { mkdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { MlOptions } from '@/studios/phylo/ml';

let bundled: Promise<string> | null = null;
async function bundle(): Promise<string> {
  const { build } = await import('rolldown');
  const dir = new URL('../.cache/worker/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
  await build({ input: new URL('./phylo-worker.ts', import.meta.url).pathname, platform: 'node', output: { dir, format: 'esm', entryFileNames: 'phylo-worker.mjs' }, logLevel: 'silent' });
  return dir + 'phylo-worker.mjs';
}
export async function parallelReplicates(aln: string[], names: string[], opts: MlOptions, reps: number, threads = Math.max(1, availableParallelism() - 1)): Promise<string[]> {
  const file = await (bundled ??= bundle()), n = Math.min(threads, reps);
  const shares = Array.from({ length: n }, (_, i) => Math.floor(reps / n) + (i < reps % n ? 1 : 0));
  const parts = await Promise.all(shares.map((share, i) => new Promise<string[]>((resolve, reject) => {
    const w = new Worker(file, { workerData: { aln, names, opts, reps: share, seed: 1000 + i * 7919 } });
    w.once('message', (m) => { resolve(m as string[]); void w.terminate(); }); w.once('error', reject);
  })));
  return parts.flat();
}
