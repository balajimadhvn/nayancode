import { exposeKernels, type Kernel } from '@/compute/rpc';
import { distanceMatrixFromAni } from './helpers';
import * as k from './kernels';
import { parseFasta } from '../sequence/kernels';
import { upgma, toNewick } from '../phylo/kernels';

/** Streams a (possibly gzipped) FASTQ File without ever holding it in memory. */
const fastq: Kernel<{ file?: File; text?: string; maxReads: number }, k.FastqResult & { truncated: boolean; elapsed: number }> = async (a, ctx) => {
  const qc = new k.FastqQC(); let err = ''; const parser = new k.FastqLineParser(qc, (m) => { err ||= m; }); const t0 = performance.now(); let truncated = false;
  if (a.text !== undefined) { parser.push(a.text); parser.end(); }
  else if (a.file) {
    const f = a.file, head = new Uint8Array(await f.slice(0, 2).arrayBuffer()), gz = head[0] === 0x1f && head[1] === 0x8b; let read = 0;
    let stream: ReadableStream<Uint8Array> = f.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, c) { read += chunk.length; c.enqueue(chunk); } }));
    if (gz) stream = stream.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
    const reader = stream.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; parser.push(value as unknown as string); ctx.progress(Math.min(0.98, read / f.size), `${qc.reads.toLocaleString()} reads`); if (err || qc.reads >= a.maxReads) { truncated = qc.reads >= a.maxReads; await reader.cancel(); break; } }
    if (!truncated) parser.end();
  }
  if (err) throw new Error(err); if (!qc.reads) throw new Error('No reads found. Is this a FASTQ file?');
  return { ...qc.result(), truncated, elapsed: performance.now() - t0 };
};
const assembly: Kernel<{ text: string }, k.AsmStats> = (a) => k.assemblyStats(parseFasta(a.text).map((r) => ({ id: r.id, seq: r.seq })));
const intervals: Kernel<{ a: string; b: string; op: 'intersect' | 'subtract' | 'merge' | 'closest'; gap: number }, { rows: { chrom: string; start: number; end: number; name: string; extra?: string }[]; stats: { nA: number; nB: number; bpA: number; bpB: number; bpOut: number; jaccard: number } }> = (a) => {
  const A = k.parseBed(a.a), B = a.b.trim() ? k.parseBed(a.b) : [];
  let out: k.Interval[] = [], rows: { chrom: string; start: number; end: number; name: string; extra?: string }[];
  if (a.op === 'merge') { out = k.mergeIntervals(A, a.gap); rows = out.map((i) => ({ ...i })); }
  else if (a.op === 'closest') { const c = k.closest(A, B); rows = c.map((x) => ({ chrom: x.a.chrom, start: x.a.start, end: x.a.end, name: x.a.name, extra: x.b ? `${x.b.name} (${x.dist} bp)` : 'none' })); out = A; }
  else { if (!B.length) throw new Error('Set B is required for this operation.'); out = a.op === 'intersect' ? k.intersect(A, B) : k.subtract(A, B); rows = out.map((i) => ({ ...i })); }
  return { rows, stats: { nA: A.length, nB: B.length, bpA: k.totalBp(A), bpB: k.totalBp(B), bpOut: a.op === 'closest' ? 0 : k.totalBp(out), jaccard: B.length ? k.jaccard(A, B) : 0 } };
};
const compare: Kernel<{ text: string; k: number; size: number }, { names: string[]; ani: number[][]; newick: string; lengths: number[] }> = (a, ctx) => {
  const recs = parseFasta(a.text); if (recs.length < 2) throw new Error('Need at least two genomes (multi-FASTA; one record per genome).');
  const sk = recs.map((r, i) => { ctx.progress(0.05 + 0.8 * (i / recs.length), `sketching ${r.id}`); return k.sketch(r.seq, a.k, a.size); });
  const n = recs.length, ani = Array.from({ length: n }, () => new Array(n).fill(1));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) ani[i][j] = ani[j][i] = k.mashDistance(sk[i], sk[j], a.k, a.size).ani;
  return { names: recs.map((r) => r.id), ani, newick: toNewick(upgma(distanceMatrixFromAni(ani), recs.map((r) => r.id))), lengths: recs.map((r) => r.seq.length) };
};
const gff: Kernel<{ text: string }, ReturnType<typeof k.summariseGff>> = (a) => k.summariseGff(a.text);
export type GenomeKernels = { fastq: typeof fastq; assembly: typeof assembly; intervals: typeof intervals; compare: typeof compare; gff: typeof gff };
exposeKernels({ fastq, assembly, intervals, compare, gff } as Record<string, Kernel>);
