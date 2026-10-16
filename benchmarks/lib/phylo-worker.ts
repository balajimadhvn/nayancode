// Worker-thread entry for the phylogenetics benchmark: one share of ML bootstrap replicates, using the Workbench's code.
import { parentPort, workerData } from 'node:worker_threads';
import { toNewick } from '../../src/studios/phylo/kernels';
import { mlReplicateTrees, type MlOptions } from '../../src/studios/phylo/ml';

const { aln, names, opts, reps, seed } = workerData as { aln: string[]; names: string[]; opts: MlOptions; reps: number; seed: number };
parentPort!.postMessage(mlReplicateTrees(aln, names, opts, reps, undefined, seed).map((t) => toNewick(t)));
