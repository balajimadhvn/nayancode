import { exposeKernels, type Kernel } from '@/compute/rpc';
import { readFastq, readPairs, type FastqRecord } from './fastq';
import { addRecord, newStats, statsSummary, type StatsSummary } from './stats';
import { newCounters, processRecord, tally, type TrimCounters, type TrimOpts } from './trim';
import { estimateGenomeSize, kmerSpectrum, spectrumHistogram } from './kmer';
import { dedupExact, demultiplex, parseBarcodes, reservoirSample } from './tools';
import { mergePair } from './merge';

export interface SourceArg { file?: File; file2?: File; demo?: FastqRecord[] }

async function* singles(a: SourceArg): AsyncGenerator<FastqRecord> {
  if (a.demo) { for (const r of a.demo) yield r; return; }
  if (a.file) for await (const r of readFastq(a.file)) yield r;
}

async function* pairs(a: SourceArg): AsyncGenerator<[FastqRecord, FastqRecord]> {
  if (!a.file || !a.file2) throw new Error('Load two FASTQ files (R1 and R2) for paired-end work.');
  for await (const p of readPairs(a.file, a.file2)) yield p;
}

const capped = async (it: AsyncIterable<FastqRecord>, max: number): Promise<FastqRecord[]> => {
  const out: FastqRecord[] = [];
  for await (const r of it) { out.push(r); if (out.length >= max) break; }
  return out;
};

const MAX_INSPECT = 100_000;

const inspect: Kernel<SourceArg & { maxReads?: number }, StatsSummary> = async (a, ctx) => {
  const max = a.maxReads ?? MAX_INSPECT, s = newStats();
  let n = 0;
  for await (const r of singles(a)) {
    addRecord(s, r); n++;
    if (n % 2000 === 0) ctx.progress(Math.min(0.95, n / max), `Inspecting ${n.toLocaleString()} reads`);
    if (n >= max) break;
  }
  ctx.progress(1, `${n.toLocaleString()} reads profiled`);
  return statsSummary(s);
};

export interface TrimRunResult { counters: TrimCounters; before: StatsSummary; after: StatsSummary; paired: boolean }

const trim: Kernel<SourceArg & { params: TrimOpts }, TrimRunResult> = async (a, ctx) => {
  const counters = newCounters(), before = newStats(), after = newStats();
  const paired = !!a.file2;
  let done = 0;
  if (paired) {
    for await (const [r1, r2] of pairs(a)) {
      addRecord(before, r1);
      const o1 = processRecord(r1, a.params), o2 = processRecord(r2, a.params);
      done++; counters.in++;
      const reason = o1.reason ?? o2.reason;
      // Pair rule: a pair is kept only if both mates pass; the first failing mate names the reason.
      if (!reason) { counters.kept++; addRecord(after, o1.rec!); } else counters[reason]++;
      if (done % 2000 === 0) ctx.progress(Math.min(0.95, done / (done + 20_000)), `${done.toLocaleString()} pairs · ${counters.kept.toLocaleString()} kept`);
    }
  } else {
    for await (const r of singles(a)) {
      addRecord(before, r);
      const o = processRecord(r, a.params);
      done++; tally(counters, o); if (o.rec) addRecord(after, o.rec);
      if (done % 2000 === 0) ctx.progress(Math.min(0.95, done / (done + 20_000)), `${done.toLocaleString()} reads · ${counters.kept.toLocaleString()} kept`);
    }
  }
  ctx.progress(1, `${done.toLocaleString()} reads processed`);
  return { counters, before: statsSummary(before), after: statsSummary(after), paired };
};

export interface SpectrumResult { hist: [number, number][]; distinct: number; totalKmers: number; truncated: boolean; estimate: ReturnType<typeof estimateGenomeSize> }

const spectrum: Kernel<SourceArg & { k?: number; maxReads?: number }, SpectrumResult> = async (a, ctx) => {
  const max = a.maxReads ?? 20_000, seqs: string[] = [];
  let n = 0;
  for await (const r of singles(a)) {
    seqs.push(r.seq); n++;
    if (n >= max) break;
    if (n % 2000 === 0) ctx.progress(Math.min(0.85, n / max), `Reading ${n.toLocaleString()} reads`);
  }
  ctx.progress(0.9, 'Counting canonical k-mers');
  const s = kmerSpectrum(seqs, a.k ?? 21), hist = spectrumHistogram(s);
  return { hist: [...hist.entries()].sort((x, y) => x[0] - y[0]), distinct: s.distinct, totalKmers: s.totalKmers, truncated: s.truncated, estimate: estimateGenomeSize(hist) };
};

export interface MergeResult { pairs: number; merged: number; meanOverlapInsert?: number; preview: FastqRecord[] }
const merge: Kernel<SourceArg & { minOverlap?: number; maxMismatchRate?: number }, MergeResult> = async (a, ctx) => {
  let n = 0, merged = 0; const preview: FastqRecord[] = [];
  for await (const [r1, r2] of pairs(a)) {
    n++;
    const m = mergePair(r1, r2, { minOverlap: a.minOverlap, maxMismatchRate: a.maxMismatchRate });
    if (m) { merged++; if (preview.length < 20) preview.push(m); }
    if (n % 2000 === 0) ctx.progress(Math.min(0.95, n / (n + 20_000)), `${n.toLocaleString()} pairs · ${merged.toLocaleString()} merged`);
  }
  return { pairs: n, merged, preview };
};

export interface DedupResult { input: number; kept: number; removed: number; records: FastqRecord[] }
const dedup: Kernel<SourceArg & { maxReads?: number }, DedupResult> = async (a, ctx) => {
  const max = a.maxReads ?? 500_000;
  const rows = await capped(singles(a), max);
  ctx.progress(0.8, 'Removing duplicate sequences');
  const out = dedupExact(rows);
  return { input: rows.length, kept: out.length, removed: rows.length - out.length, records: out.slice(0, 100_000) };
};

export interface SubsampleResult { sampled: FastqRecord[]; requested: number }
const subsample: Kernel<SourceArg & { n: number; seed: number }, SubsampleResult> = async (a, ctx) => {
  const want = Math.max(1, Math.min(100_000, Math.floor(a.n)));
  const sampled = await reservoirSample(singles(a), want, a.seed);
  ctx.progress(1, `${sampled.length.toLocaleString()} reads sampled`);
  return { sampled, requested: want };
};

export interface DemuxRun { counts: Record<string, number>; ambiguous: number; unassigned: number; barcodes: number; preview: FastqRecord[] }
const demux: Kernel<SourceArg & { barcodes: string; maxMismatch?: number; where?: 'start' | 'end'; maxReads?: number }, DemuxRun> = async (a, ctx) => {
  const bcs = parseBarcodes(a.barcodes);
  if (!bcs.length) throw new Error('Paste a barcode table: sample,barcode (one per line).');
  const rows = await capped(singles(a), a.maxReads ?? 500_000);
  ctx.progress(0.8, `Assigning ${rows.length.toLocaleString()} reads`);
  const out = demultiplex(rows, bcs, { maxMismatch: a.maxMismatch, where: a.where });
  const preview = [...out.samples.values()].flat().slice(0, 20);
  return { counts: out.counts, ambiguous: out.ambiguous.length, unassigned: out.unassigned.length, barcodes: bcs.length, preview };
};

export type ReadsKernels = { inspect: typeof inspect; trim: typeof trim; spectrum: typeof spectrum; merge: typeof merge; dedup: typeof dedup; subsample: typeof subsample; demux: typeof demux };
exposeKernels({ inspect, trim, spectrum, merge, dedup, subsample, demux } as Record<string, Kernel>);
