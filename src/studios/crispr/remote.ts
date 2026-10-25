/** Shared CRISPR worker handle and the provenance records for its two analyses. */
import { createRemote } from '@/compute/rpc';
import type { ToolInfo } from '@/core/provenance';
import type { CrisprKernels } from './crispr.worker';

export const remote = createRemote<CrisprKernels>(() => new Worker(new URL('./crispr.worker.ts', import.meta.url), { type: 'module' }));

export const DESIGN_TOOL: ToolInfo = {
  id: 'crispr.design', name: 'CRISPR guide design', version: '0.1.0',
  engine: 'TypeScript worker (exact PAM enumeration; rule-based on-target heuristic)',
  citations: ['hsu2013'],
  describe: (p) => `${p.nuclease} protospacers were enumerated on both strands of ${p.length} bp with the canonical PAM (SpCas9 NGG; Cas12a TTTV) and ranked with a transparent penalty score, not a trained efficiency model.`,
};

export const OFF_TARGET_TOOL: ToolInfo = {
  id: 'crispr.offtarget', name: 'CRISPR off-target scan', version: '0.1.0',
  engine: 'TypeScript worker (ungapped NGG scan, MIT position-weighted score)',
  citations: ['hsu2013'],
  describe: (p) => `Both strands of ${p.background} (${Number(p.length).toLocaleString()} bp) were scanned for NGG PAM sites differing from the guide at up to ${p.maxMm} positions; guide specificity is 100 / (1 + Σ MIT site scores).`,
};
