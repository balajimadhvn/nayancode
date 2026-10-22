/** Small-genome assembler worker: reads are streamed, assembled, and reported with the existing contiguity statistics. */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { assetUrl } from '@/core/asset';
import { readSequences, type SeqSource } from '@/core/readstream';
import { assemble, simulateLongReads, type AssembleOpts, type Contig } from './assemble';
import { assemblyStats, type AsmStats } from './kernels';

export interface AssemblyResult { contigs: Contig[]; stats: AsmStats; reads: number; filtered: number; contained: number }

const run = (reads: string[], o: AssembleOpts): AssemblyResult => {
  const asm = assemble(reads, o);
  const stats = assemblyStats(asm.contigs.map((c) => ({ id: c.id, seq: c.seq })));
  return { contigs: asm.contigs, stats, reads: asm.reads, filtered: reads.length - asm.reads, contained: asm.contained };
};

const assembleReads: Kernel<{ reads: SeqSource; maxReads: number; k?: number; w?: number; minOverlap?: number }, AssemblyResult> = async (a, ctx) => {
  const reads: string[] = [];
  for await (const r of readSequences(a.reads, { maxReads: a.maxReads, onProgress: (f, n) => ctx.progress(0.05 + 0.5 * f, `${n.toLocaleString()} reads`) })) reads.push(r);
  if (!reads.length) throw new Error('No reads found. Is this a FASTQ or FASTA file?');
  ctx.progress(0.6, `Assembling ${reads.length.toLocaleString()} reads`);
  return run(reads, { k: a.k, w: a.w, minOverlap: a.minOverlap });
};

const gunzip = async (buf: ArrayBuffer) => { const h = new Uint8Array(buf, 0, 2); return h[0] === 0x1f && h[1] === 0x8b ? new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(buf); };
let lambdaP: Promise<string> | null = null;
const lambda = () => (lambdaP ??= (async () => {
  const r = await fetch(assetUrl('genomes/lambda.fna.gz')); if (!r.ok) throw new Error(`lambda.fna.gz: HTTP ${r.status}`);
  return (await gunzip(await r.arrayBuffer())).split('\n').filter((l) => l && l[0] !== '>').join('').toUpperCase();
})());

/** Demo: 60× simulated phage lambda reads (3–8 kb, 0.3 % substitutions), generated in the worker. */
const demo: Kernel<{ coverage?: number; seed?: number }, AssemblyResult> = async (a, ctx) => {
  ctx.progress(0.05, 'Loading phage lambda');
  const genome = await lambda();
  const reads = simulateLongReads(genome, { coverage: a.coverage ?? 60, seed: a.seed ?? 4 });
  ctx.progress(0.4, `Assembling ${reads.length} simulated reads`);
  return run(reads, {});
};

export type AssembleKernels = { assemble: typeof assembleReads; demo: typeof demo };
exposeKernels({ assemble: assembleReads, demo } as Record<string, Kernel>);
