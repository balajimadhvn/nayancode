import { createRemote } from '@/compute/rpc';
import type { EnrichKernels } from './enrich.worker';

export const remote = createRemote<EnrichKernels>(() => new Worker(new URL('./enrich.worker.ts', import.meta.url), { type: 'module' }));
