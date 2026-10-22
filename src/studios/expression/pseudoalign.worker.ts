/** Pseudoalignment worker: keeps the k-mer index in memory between calls so several FASTQ files reuse it. */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { readSequences, type SeqSource } from '@/core/readstream';
import { parseFasta } from '../sequence/kernels';
import { buildIndex, classify, quantify, syntheticExperiment, type PseudoIndex, type Quant } from './pseudoalign';

let ix: PseudoIndex | null = null;
export interface IndexInfo { transcripts: number; kmers: number; ecs: number; totalLength: number; k: number }
const index: Kernel<{ fasta: SeqSource; k: number }, IndexInfo> = async (a, ctx) => {
  ctx.progress(0.05, 'Reading transcriptome');
  const text = a.fasta.text ?? (await a.fasta.file!.text()); const recs = parseFasta(text).map((r) => ({ id: r.id, seq: r.seq }));
  if (!recs.length) throw new Error('No transcripts found. Provide a nucleotide FASTA (cDNA / transcript sequences).');
  ctx.progress(0.2, `Indexing ${recs.length.toLocaleString()} transcripts`); ix = buildIndex(recs, a.k);
  return { transcripts: recs.length, kmers: ix.nKmers, ecs: ix.ecs.length, totalLength: ix.lengths.reduce((s, x) => s + x, 0), k: a.k };
};
export interface QuantResult { reads: number; mapped: number; iterations: number; quant: Quant[]; fragLen: number }
const quant: Kernel<{ reads: SeqSource; mate2?: SeqSource; fragLen: number; maxReads: number }, QuantResult> = async (a, ctx) => {
  if (!ix) throw new Error('Build the index first.');
  async function* gen(): AsyncGenerator<string | [string, string]> {
    const o = { maxReads: a.maxReads, onProgress: (f: number, n: number) => ctx.progress(0.05 + 0.8 * f, `${n.toLocaleString()} reads`) };
    if (!a.mate2) { yield* readSequences(a.reads, o); return; }
    const m2 = readSequences(a.mate2, { maxReads: a.maxReads }); for await (const r1 of readSequences(a.reads, o)) { const r2 = await m2.next(); if (r2.done) return; yield [r1, r2.value]; }
  }
  const map = new Map<string, number>(), sets: number[][] = [], counts: number[] = []; let n = 0, mapped = 0;
  for await (const r of gen()) {
    n++; const inter = (x: number[], y: number[]) => x.filter((v) => y.includes(v));
    const set = typeof r === 'string' ? classify(ix, r) : (() => { const x = classify(ix, r[0]), y = classify(ix, r[1]); return x.length && y.length ? inter(x, y) : x.length ? x : y; })();
    if (!set.length) continue; mapped++; const key = set.join(','), id = map.get(key); if (id === undefined) { map.set(key, sets.length); sets.push(set); counts.push(1); } else counts[id]++;
  }
  if (!n) throw new Error('No reads found. Is this a FASTQ or FASTA file?');
  ctx.progress(0.9, 'EM');
  const q = quantify(ix, { sets, counts, reads: n, mapped, kmersSeen: 0 }, { fragLen: a.fragLen });
  return { reads: n, mapped, iterations: q.iterations, quant: q.quant, fragLen: a.fragLen };
};
const demo: Kernel<{ seed: number }, { fasta: string; sheet: string; up: string[]; samples: { name: string; group: string; fastq: string }[] }> = (a) => syntheticExperiment(a.seed);
export type PseudoKernels = { index: typeof index; quant: typeof quant; demo: typeof demo };
exposeKernels({ index, quant, demo } as Record<string, Kernel>);
