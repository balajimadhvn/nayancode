/** Shared AMR worker handle: the screen and library tabs must not each spawn their own copy of the index. */
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import type { AmrKernels } from './amr.worker';

export const remote = createRemote<AmrKernels>(() => new Worker(new URL('./amr.worker.ts', import.meta.url), { type: 'module' }));

export const TOOL: ToolInfo = {
  id: 'amr.screen', name: 'AMR nucleotide screening', version: '0.1.0',
  engine: 'TypeScript worker (non-canonical 15-mer seeds, diagonal voting, Smith–Waterman confirmation)',
  citations: ['feldgarden2021'],
  describe: (p) => `Assembled contigs were screened against the NCBI AMRFinderPlus reference gene set with forward-only ${p.k}-mer seeds: seeds were mapped to (reference, diagonal) buckets of 32 bp, buckets with at least ${p.minSeeds} votes were merged and each candidate locus was confirmed with a Smith–Waterman local alignment of the reference against the contig window on both strands. Hits were kept at ≥ ${Math.round(Number(p.minIdentity) * 100)} % nucleotide identity and ≥ ${Math.round(Number(p.minCoverage) * 100)} % reference coverage, and overlapping hits on the same contig and strand were resolved by identity·coverage`,
};
