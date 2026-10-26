/** End-to-end amplicon pipeline: primers → filter → merge → dereplicate → denoise → chimeras → taxonomy. */
import type { FastqRecord } from '../reads/fastq';
import { mergePair } from '../reads/merge';
import { cutAtPrimer, denoise, dereplicate, medianLength, passesFilter, revCompIupac, trimPrimer, type UniqueSeq } from './denoise';
import { detectChimeras, type Chimera } from './chimera';
import { classify, parseReference, trainClassifier, type TaxCall } from './classify';

export interface SampleReads { sample: string; reads: FastqRecord[]; reverse?: FastqRecord[] }
export interface AmpliconOpts {
  fwdPrimer?: string; revPrimer?: string; maxPrimerMismatch?: number;
  maxEE?: number; minSize?: number; removeChimeras?: boolean;
  reference?: string; bootstrap?: number; seed?: number;
}
export interface StageCounts { raw: number; primerMatched: number; filtered: number; merged: number; denoised: number; nonChimeric: number; unmerged: number }
export interface AsvRow {
  id: string; seq: string; length: number; abundance: number; samples: Record<string, number>;
  taxonomy: string[]; confidence: number[]; genus: string; chimera: boolean;
}
export interface AmpliconResult { rows: AsvRow[]; chimeras: AsvRow[]; stages: StageCounts; samples: string[]; table: string; fasta: string; hasTaxonomy: boolean }
export interface TaxonomyResult { ranks: string[]; calls: TaxCall[] }

export const DEFAULT_FWD = 'GTGYCAGCMGCCGCGGTAA';
export const DEFAULT_REV = 'GGACTACNVGGGTWTCTAAT';

const trimmed = (rec: FastqRecord, primer: string, opposite: string, mm: number): FastqRecord | null => {
  const t = trimPrimer(rec, primer, { maxMismatch: mm });
  return t ? cutAtPrimer(t, revCompIupac(opposite), mm) : null;
};

/** Train the RDP-style classifier once and classify every sequence. */
export function runTaxonomy(seqs: string[], reference: string, bootstrap = 100, seed = 1): TaxonomyResult {
  if (!reference.trim()) throw new Error('Drop a reference FASTA with Kingdom;Phylum;…;Genus headers first.');
  const model = trainClassifier(parseReference(reference));
  return { ranks: model.ranks, calls: seqs.map((s, i) => classify(s, model, { bootstrap, seed: seed + i })) };
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function tableFromRows(rows: AsvRow[], samples: string[]): string {
  const header = ['ASV', ...samples, 'taxonomy'].map(csvCell).join(',');
  const body = rows.map((r) => [r.id, ...samples.map((s) => r.samples[s] ?? 0), r.taxonomy.join(';') || 'Unclassified'].map(csvCell).join(','));
  return [header, ...body].join('\n') + '\n';
}

export function fastaFromRows(rows: AsvRow[]): string {
  return rows.map((r) => `>${r.id} abundance=${r.abundance} length=${r.length}\n${r.seq}`).join('\n') + (rows.length ? '\n' : '');
}

export function runAmplicon(samples: SampleReads[], opts: AmpliconOpts = {}, onStage?: (stage: string, p: number) => void): AmpliconResult {
  const fwd = (opts.fwdPrimer ?? DEFAULT_FWD).toUpperCase(), rev = (opts.revPrimer ?? DEFAULT_REV).toUpperCase();
  const mm = opts.maxPrimerMismatch ?? 2, maxEE = opts.maxEE ?? 1, minSize = opts.minSize ?? 8;
  const names = samples.map((s) => s.sample);
  const stages: StageCounts = { raw: 0, primerMatched: 0, filtered: 0, merged: 0, denoised: 0, nonChimeric: 0, unmerged: 0 };
  const units: { sample: string; r1: FastqRecord; r2?: FastqRecord }[] = [];

  onStage?.('Trimming primers', 0.05);
  for (const s of samples) {
    if (s.reverse) {
      const n = Math.min(s.reads.length, s.reverse.length);
      for (let i = 0; i < n; i++) {
        stages.raw++;
        const r1 = trimmed(s.reads[i], fwd, rev, mm), r2 = trimmed(s.reverse[i], rev, fwd, mm);
        if (!r1 || !r2) continue;
        stages.primerMatched++; units.push({ sample: s.sample, r1, r2 });
      }
    } else {
      for (const rec of s.reads) {
        stages.raw++;
        const r1 = trimmed(rec, fwd, rev, mm);
        if (!r1) continue;
        stages.primerMatched++; units.push({ sample: s.sample, r1 });
      }
    }
  }

  onStage?.('Filtering reads', 0.3);
  const median = medianLength(units.flatMap((u) => (u.r2 ? [u.r1.seq.length, u.r2.seq.length] : [u.r1.seq.length])));
  const mergedReads: { seq: string; sample: string }[] = [];
  for (const u of units) {
    if (!passesFilter(u.r1, median, maxEE)) continue;
    if (u.r2 && !passesFilter(u.r2, median, maxEE)) continue;
    stages.filtered++;
    if (u.r2) {
      const m = mergePair(u.r1, u.r2);
      if (!m) { stages.unmerged++; continue; }
      mergedReads.push({ seq: m.seq, sample: u.sample });
    } else mergedReads.push({ seq: u.r1.seq, sample: u.sample });
  }
  stages.merged = mergedReads.length;

  onStage?.('Dereplicating and denoising', 0.55);
  const unique = dereplicate(mergedReads), den = denoise(unique, { minSize }), before = new Map(den.asvs.map((a) => [a.seq, a]));
  stages.denoised = den.asvs.length;

  onStage?.('Removing chimeras', 0.75);
  const chim = opts.removeChimeras === false ? { kept: den.asvs, chimeras: [] as Chimera[] } : detectChimeras(den.asvs);
  stages.nonChimeric = chim.kept.length;

  const kept = [...chim.kept].sort((a, b) => b.count - a.count || a.seq.localeCompare(b.seq));
  let calls: TaxCall[] = [], ranks: string[] = [];
  if (opts.reference?.trim()) {
    onStage?.('Classifying with naive Bayes', 0.88);
    const tax = runTaxonomy(kept.map((a) => a.seq), opts.reference, opts.bootstrap ?? 100, opts.seed ?? 1);
    calls = tax.calls; ranks = tax.ranks;
  }

  const row = (a: UniqueSeq, i: number, chimera: boolean, call?: TaxCall): AsvRow => ({
    id: `${chimera ? 'chimera' : 'ASV'}${i + 1}`, seq: a.seq, length: a.seq.length, abundance: a.count,
    samples: Object.fromEntries(names.map((s) => [s, a.samples.get(s) ?? 0])),
    taxonomy: call?.lineage.length ? call.lineage : [], confidence: call?.confidences ?? [],
    genus: call?.genus ?? '', chimera,
  });
  const rows = kept.map((a, i) => row(a, i, false, calls[i]));
  const chimeraRows = chim.chimeras.map((c, i) => {
    const a = before.get(c.seq) ?? { seq: c.seq, count: c.count, samples: new Map<string, number>() };
    return row(a as UniqueSeq, i, true);
  });

  const table = tableFromRows(rows, names);
  const fasta = fastaFromRows(rows);
  return { rows, chimeras: chimeraRows, stages, samples: names, table, fasta, hasTaxonomy: ranks.length > 0 };
}
