/** Web Worker kernels for gene counting and peak calling (pure computation; no DOM). */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { countReads, type AlignedRead, type CountOpts } from './count';
import { parseGff, type GffGene } from './gff';
import { callPeaks, estimateFragmentSize, type Peak, type StrandRead } from './peaks';
import { fivePrime, isUnmapped, parseSamLine, passesFilter, refSpans, strandOf } from './sam';
import { simulateCounts, simulatePeaks, samFromReads } from './simCounts';

export interface CountSampleArg { name: string; sam: string }
export interface CountArg { annotation: string; samples: CountSampleArg[]; stranded: CountOpts['stranded']; minMapq: number; minOverlap: number; skipDuplicates?: boolean }
export interface SampleCount { name: string; counts: number[]; assigned: number; ambiguous: number; noFeature: number; lowMapq: number; unmapped: number }
export interface CountOut { genes: GffGene[]; samples: SampleCount[] }

interface ParsedSam { reads: AlignedRead[]; contigs: { name: string; length: number }[] }

function readSam(text: string, filter: { skipDuplicates?: boolean } = {}): ParsedSam {
  const reads: AlignedRead[] = [], contigs: { name: string; length: number }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    if (line[0] === '@') {
      if (line.startsWith('@SQ')) {
        const sn = /\tSN:([^\t]+)/.exec(line), ln = /\tLN:(\d+)/.exec(line);
        if (sn && ln) contigs.push({ name: sn[1], length: Number(ln[1]) });
      }
      continue;
    }
    let r; try { r = parseSamLine(line); } catch { continue; } // tolerate blank/trailing junk, keep real records
    if (r.flag & (256 | 2048 | 512)) continue;
    if ((r.flag & 1) && !(r.flag & 64)) continue; // paired reads are counted once, from read 1
    if (isUnmapped(r)) { reads.push({ seqid: '*', blocks: [], strand: '+', mapq: 0, unmapped: true }); continue; }
    if (filter.skipDuplicates && (r.flag & 1024)) continue;
    reads.push({ seqid: r.rname, blocks: refSpans(r.pos, r.cigar), strand: strandOf(r.flag), mapq: r.mapq });
  }
  return { reads, contigs };
}

const countSam: Kernel<CountArg, CountOut> = (a) => {
  const model = parseGff(a.annotation);
  if (!model.genes.length) throw new Error('The annotation has no genes with exons on a sequence.');
  const samples = a.samples.map((s) => {
    const parsed = readSam(s.sam, { skipDuplicates: a.skipDuplicates });
    const r = countReads(parsed.reads, model.genes, { stranded: a.stranded, minMapq: a.minMapq, minOverlap: a.minOverlap });
    return {
      name: s.name, counts: model.genes.map((g) => r.counts.get(g.id) ?? 0),
      assigned: r.assigned, ambiguous: r.ambiguous, noFeature: r.noFeature, lowMapq: r.lowMapq, unmapped: r.unmapped,
    };
  });
  return { genes: model.genes, samples };
};

export interface CountDemo {
  annotation: string;
  samples: { name: string; sam: string }[];
  out: CountOut;
}

const demoCounts: Kernel<{ seed?: number }, CountDemo> = (a) => {
  const sim = simulateCounts({ seed: a.seed ?? 11 });
  const countOne = (name: string, reads: AlignedRead[]): SampleCount => {
    const r = countReads(reads, sim.genes, { stranded: 'reverse', minMapq: 10 });
    return {
      name, counts: sim.genes.map((g) => r.counts.get(g.id) ?? 0),
      assigned: r.assigned, ambiguous: r.ambiguous, noFeature: r.noFeature, lowMapq: r.lowMapq, unmapped: r.unmapped,
    };
  };
  const second = sim.reads.filter((_, i) => i % 3 !== 0);
  const samples = [
    { name: 'SYNTHETIC_1', sam: samFromReads(sim.reads, sim.refName, sim.refLength) },
    { name: 'SYNTHETIC_2', sam: samFromReads(second, sim.refName, sim.refLength) },
  ];
  return {
    annotation: sim.annotation, samples,
    out: { genes: sim.genes, samples: [countOne('SYNTHETIC_1', sim.reads), countOne('SYNTHETIC_2', second)] },
  };
};

export interface PeakChrom { chrom: string; length: number; coverage: Int32Array; lambdaBg: number }
export interface PeakOut { d: number; peaks: Peak[]; chroms: PeakChrom[]; skipped: { chrom: string; length: number }[]; planted?: { centre: number; start: number; end: number }[] }
export interface PeaksArg { treatment: string; control?: string; d: number | 'auto'; qCutoff?: number; shift?: number; extend?: number }

const MAX_CHROM = 50_000_000;
interface ChromData { length: number; reads: StrandRead[]; fragments: [number, number][] }
const empty = () => new Map<string, ChromData>();

function parsePeaksSam(text: string, filter: { skipDuplicates?: boolean } = {}): { chroms: Map<string, ChromData>; allReads: StrandRead[]; tlen: number[] } {
  const chroms = empty(), allReads: StrandRead[] = [], tlen: number[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    if (line[0] === '@') {
      if (line.startsWith('@SQ')) {
        const sn = /\tSN:([^\t]+)/.exec(line), ln = /\tLN:(\d+)/.exec(line);
        if (sn && ln && !chroms.has(sn[1])) chroms.set(sn[1], { length: Number(ln[1]), reads: [], fragments: [] });
      }
      continue;
    }
    let r; try { r = parseSamLine(line); } catch { continue; }
    if (isUnmapped(r) || !passesFilter(r, filter)) continue;
    if (!chroms.has(r.rname)) chroms.set(r.rname, { length: 0, reads: [], fragments: [] });
    const c = chroms.get(r.rname)!;
    const end = Math.max(...refSpans(r.pos, r.cigar).map((b) => b[1]), r.pos);
    c.length = Math.max(c.length, end);
    if (r.flag & 1 && r.tlen) {
      tlen.push(Math.abs(r.tlen));
      const left = Math.min(r.pos, r.pos + r.tlen), right = Math.max(r.pos, r.pos + r.tlen) - 1;
      c.fragments.push([left, right]);
      c.reads.push({ pos: left, strand: '+' }, { pos: right, strand: '-' });
      allReads.push({ pos: left, strand: '+' }, { pos: right, strand: '-' });
      c.length = Math.max(c.length, right);
    } else {
      const p = fivePrime(r);
      c.reads.push({ pos: p, strand: strandOf(r.flag) });
      allReads.push({ pos: p, strand: strandOf(r.flag) });
      c.length = Math.max(c.length, p);
    }
  }
  return { chroms, allReads, tlen };
}

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

function resolveD(arg: PeaksArg, allReads: StrandRead[], tlen: number[]): number {
  if (typeof arg.d === 'number') return Math.max(20, Math.round(arg.d));
  const t = median(tlen);
  if (t) return Math.round(t);
  const est = estimateFragmentSize(allReads);
  return est || 200;
}

const peaksSam: Kernel<PeaksArg, PeakOut> = (a) => {
  const treat = parsePeaksSam(a.treatment), ctrl = a.control ? parsePeaksSam(a.control) : null;
  if (!treat.chroms.size) throw new Error('No mapped reads were found in the treatment file.');
  const d = resolveD(a, treat.allReads, treat.tlen);
  const peaks: Peak[] = [], chroms: PeakChrom[] = [], skipped: { chrom: string; length: number }[] = [];
  for (const [chrom, c] of treat.chroms) {
    if (c.length <= 0) continue;
    if (!c.reads.length && !c.fragments.length) continue;
    if (c.length > MAX_CHROM) { skipped.push({ chrom, length: c.length }); continue; }
    const cc = ctrl?.chroms.get(chrom), controlFragments = cc?.fragments ?? [], controlReads = cc && !cc.fragments.length ? cc.reads : [];
    const res = callPeaks(c.fragments.length ? [] : c.reads, {
      genomeLength: c.length, chrom, d, qCutoff: a.qCutoff, shift: a.shift, extend: a.extend,
      fragments: c.fragments, controlFragments, control: controlReads,
    });
    peaks.push(...res.peaks); chroms.push({ chrom, length: c.length, coverage: res.coverage, lambdaBg: res.lambdaBg });
  }
  peaks.sort((x, y) => (x.chrom < y.chrom ? -1 : x.chrom > y.chrom ? 1 : x.start - y.start));
  peaks.forEach((p, i) => { p.name = `peak_${i + 1}`; });
  return { d, peaks, chroms, skipped };
};

const demoPeaks: Kernel<{ seed?: number; qCutoff?: number }, PeakOut> = (a) => {
  const sim = simulatePeaks({ seed: a.seed ?? 7 });
  const res = callPeaks(sim.treatment, { genomeLength: sim.genomeLength, chrom: sim.refName, d: sim.d, control: sim.control, qCutoff: a.qCutoff });
  return {
    d: res.d, peaks: res.peaks,
    chroms: [{ chrom: sim.refName, length: sim.genomeLength, coverage: res.coverage, lambdaBg: res.lambdaBg }],
    skipped: [], planted: sim.planted.map((p) => ({ centre: p.centre, start: p.start, end: p.end })),
  };
};

export type CountsKernels = { countSam: typeof countSam; demoCounts: typeof demoCounts; peaksSam: typeof peaksSam; demoPeaks: typeof demoPeaks };
exposeKernels({ countSam, demoCounts, peaksSam, demoPeaks } as Record<string, Kernel>);
