import { createRemote } from '@/compute/rpc';
import type { SequenceKernels } from './sequence.worker';
export const remote = createRemote<SequenceKernels>(() => new Worker(new URL('./sequence.worker.ts', import.meta.url), { type: 'module' }));
