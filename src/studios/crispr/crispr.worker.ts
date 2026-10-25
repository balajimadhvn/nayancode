/** CRISPR worker: guide enumeration and up to 5 Mb of off-target background scanning stay off the UI thread. */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { loadBundledText } from '@/studios/genome/genomeData';
import { parseFasta } from '@/studios/sequence/kernels';
import { findGuides, type Guide, type NucleaseId } from './guides';
import { mitSiteScore, mitSpecificity, offTargets, type OffTargetHit } from './offtarget';

export interface LabelledGuide extends Guide { seqId: string }
export interface DesignResult { guides: LabelledGuide[]; records: number; length: number }

export interface ScanRequest {
  guide: string;
  guideId: string;
  seqId?: string;
  pos: number;
  strand: 1 | -1;
  background: { kind: 'bundled'; id: string } | { kind: 'text'; text: string };
  maxMm: number;
}
export interface ScanResult {
  guideId: string;
  background: string;
  length: number;
  hits: OffTargetHit[];
  sites: number;
  specificity: number;
  maxMm: number;
  off0to2: number;
  off3to4: number;
  truncated: boolean;
  ms: number;
}

const MAX_DESIGN_BP = 50_000;
const MAX_BACKGROUND_BP = 5_000_000;

const design: Kernel<{ text: string; nuclease: NucleaseId }, DesignResult> = async (a) => {
  const recs = parseFasta(a.text);
  if (!recs.length) throw new Error('No FASTA records found. Paste or drop a DNA sequence.');
  const length = recs.reduce((n, r) => n + r.seq.length, 0);
  if (length > MAX_DESIGN_BP) throw new Error(`The design sequence is ${length.toLocaleString()} bp; the limit is 50,000 bp.`);
  const guides = recs.flatMap((r, ri) => findGuides(r.seq, a.nuclease).map((g) => ({ ...g, id: `${ri + 1}:${r.id}:${g.id}`, seqId: r.id })));
  return { guides, records: recs.length, length };
};

const scan: Kernel<ScanRequest, ScanResult> = async (a, ctx) => {
  ctx.progress(0.05, a.background.kind === 'bundled' ? 'loading genome' : 'reading background');
  const text = a.background.kind === 'bundled' ? await loadBundledText(a.background.id, 'fasta') : a.background.text;
  const recs = parseFasta(text);
  if (!recs.length) throw new Error('No FASTA records found in the off-target background.');
  const length = recs.reduce((n, r) => n + r.seq.length, 0);
  if (length > MAX_BACKGROUND_BP) throw new Error(`The off-target background is ${length.toLocaleString()} bp; the limit is 5,000,000 bp.`);
  const t0 = performance.now();
  const hits: OffTargetHit[] = [];
  for (let i = 0; i < recs.length; i++) {
    ctx.progress(0.15 + 0.75 * (i / recs.length), `scanning ${recs[i].id}`);
    hits.push(...offTargets(a.guide, /[ACGT]GG/, [{ id: recs[i].id, seq: recs[i].seq }], a.maxMm, { seqId: a.seqId, pos: a.pos, strand: a.strand }));
  }
  const sites = hits.filter((h) => h.mismatches.length > 0).map((h) => mitSiteScore(h.mismatches));
  hits.sort((x, y) => x.mismatches.length - y.mismatches.length || x.seq.localeCompare(y.seq) || x.pos - y.pos);
  ctx.progress(1, 'done');
  return {
    guideId: a.guideId,
    background: a.background.kind === 'bundled' ? a.background.id : `${recs.length} sequence${recs.length === 1 ? '' : 's'}`,
    length,
    hits: hits.slice(0, 5000),
    sites: hits.length,
    specificity: mitSpecificity(sites),
    maxMm: a.maxMm,
    off0to2: hits.filter((h) => h.mismatches.length <= 2).length,
    off3to4: hits.filter((h) => h.mismatches.length > 2).length,
    truncated: hits.length > 5000,
    ms: performance.now() - t0,
  };
};

export type CrisprKernels = { design: typeof design; scan: typeof scan };
exposeKernels({ design, scan } as Record<string, Kernel>);
