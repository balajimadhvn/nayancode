import { exposeKernels, type Kernel } from '@/compute/rpc';
import { readFastq, readPairs, type FastqRecord } from '../reads/fastq';
import { runAmplicon, runTaxonomy, type AmpliconOpts, type AmpliconResult, type SampleReads, type TaxonomyResult } from './pipeline';
import type { AmpSample } from './simAmplicon';

export interface AmpSource { sample: string; file?: File; file2?: File; demo?: AmpSample }
export interface AmpRunArg { sources: AmpSource[]; opts: AmpliconOpts; reference?: string }
export type TaxonomyArg = { seqs: string[]; reference: string; bootstrap?: number; seed?: number };

const MAX_UNITS = 200_000;

async function load(src: AmpSource, ctx: { progress(p: number, note?: string): void }, frac: number): Promise<SampleReads> {
  if (src.demo) return { sample: src.demo.sample, reads: src.demo.reads, reverse: src.demo.reverse };
  if (!src.file) throw new Error(`No FASTQ file for sample ${src.sample}.`);
  const reads: FastqRecord[] = [], reverse: FastqRecord[] = [];
  if (src.file2) {
    for await (const [r1, r2] of readPairs(src.file, src.file2)) {
      reads.push(r1); reverse.push(r2);
      if (reads.length % 5000 === 0) ctx.progress(frac, `Reading ${src.sample}: ${reads.length.toLocaleString()} pairs`);
      if (reads.length >= MAX_UNITS) break;
    }
    return { sample: src.sample, reads, reverse };
  }
  for await (const r of readFastq(src.file)) {
    reads.push(r);
    if (reads.length % 5000 === 0) ctx.progress(frac, `Reading ${src.sample}: ${reads.length.toLocaleString()} reads`);
    if (reads.length >= MAX_UNITS) break;
  }
  return { sample: src.sample, reads };
}

const run: Kernel<AmpRunArg, AmpliconResult> = async (a, ctx) => {
  if (!a.sources.length) throw new Error('Load at least one FASTQ file or the SYNTHETIC demo.');
  const samples: SampleReads[] = [];
  for (let i = 0; i < a.sources.length; i++) {
    ctx.progress(0.02 + (0.48 * i) / a.sources.length, `Reading ${a.sources[i].sample}`);
    samples.push(await load(a.sources[i], ctx, 0.02 + (0.48 * (i + 0.9)) / a.sources.length));
  }
  const res = runAmplicon(samples, { ...a.opts, reference: a.reference }, (stage, p) => ctx.progress(0.5 + 0.48 * p, stage));
  ctx.progress(1, `${res.rows.length} ASVs from ${res.stages.raw.toLocaleString()} reads`);
  return res;
};

const taxonomy: Kernel<TaxonomyArg, TaxonomyResult> = (a) => runTaxonomy(a.seqs, a.reference, a.bootstrap ?? 100, a.seed ?? 1);

export type AmpliconKernels = { run: typeof run; taxonomy: typeof taxonomy };
exposeKernels({ run, taxonomy } as Record<string, Kernel>);
