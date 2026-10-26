/** RDP-style naive Bayes 8-mer taxonomy classifier with bootstrap confidence. */
import { parseFasta } from '../sequence/kernels';
import { mulberry32 } from '../reads/tools';

export const RANKS = ['Kingdom', 'Phylum', 'Class', 'Order', 'Family', 'Genus', 'Species'] as const;
export interface RefSeq { seq: string; lineage: string[] }
export interface TaxModel {
  k: number; ranks: string[]; genusRank: number;
  counts: Map<string, Map<string, number>>; totals: Map<string, number>;
  lineageOf: Map<string, string[]>; allKmers: Set<string>;
}
export interface TaxCall { lineage: string[]; confidences: number[]; genus: string; score: number; informative: number }

const key = (rank: number, taxon: string) => `${rank}\u0000${taxon}`;

export function parseReference(text: string): RefSeq[] {
  const recs = parseFasta(text), out: RefSeq[] = [];
  for (const r of recs) {
    const raw = (r.description.includes(';') ? r.description : r.id).split(';').map((s) => s.trim()).filter(Boolean);
    if (raw.length < 2) throw new Error(`Reference "${r.id.slice(0, 40)}" needs a lineage after the id, e.g. >id Bacteria;Firmicutes;...;Genus.`);
    out.push({ seq: r.seq.toUpperCase().replace(/[^ACGT]/g, ''), lineage: raw });
  }
  return out;
}

export function kmersOf(seq: string, k: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + k <= seq.length; i++) out.push(seq.slice(i, i + k));
  return out;
}

export function trainClassifier(refs: RefSeq[], k = 8): TaxModel {
  if (!refs.length) throw new Error('The reference FASTA is empty.');
  const depth = Math.min(RANKS.length, Math.max(...refs.map((r) => r.lineage.length)));
  const ranks = RANKS.slice(0, depth), genusRank = Math.min(5, depth - 1);
  const counts = new Map<string, Map<string, number>>(), totals = new Map<string, number>(), lineageOf = new Map<string, string[]>(), allKmers = new Set<string>();
  for (const r of refs) {
    const seen = new Set(kmersOf(r.seq, k));
    for (const w of seen) allKmers.add(w);
    for (let rank = 0; rank < depth && rank < r.lineage.length; rank++) {
      const taxon = r.lineage[rank], kk = key(rank, taxon);
      if (!lineageOf.has(kk)) lineageOf.set(kk, r.lineage);
      totals.set(kk, (totals.get(kk) ?? 0) + 1);
      let m = counts.get(kk); if (!m) { m = new Map(); counts.set(kk, m); }
      for (const w of seen) m.set(w, (m.get(w) ?? 0) + 1);
    }
  }
  return { k, ranks, genusRank, counts, totals, lineageOf, allKmers };
}

function taxaAt(model: TaxModel, rank: number): string[] {
  const out = new Set<string>();
  for (const kk of model.counts.keys()) { const [r, t] = kk.split('\u0000'); if (+r === rank) out.add(t); }
  return [...out].sort();
}

function scoreTaxon(model: TaxModel, rank: number, taxon: string, kmers: string[]): number {
  const kk = key(rank, taxon), N = model.totals.get(kk) ?? 1, m = model.counts.get(kk), base = 0.5 / (N + 1);
  let s = 0;
  for (const w of kmers) s += Math.log(m?.has(w) ? ((m.get(w)! + 0.5) / (N + 1)) : base);
  return s;
}

function bestAt(model: TaxModel, rank: number, kmers: string[], tieBreak?: number): { taxon: string; score: number } {
  const taxa = taxaAt(model, rank);
  let best = taxa[0] ?? '', bs = -Infinity, ties: string[] = [];
  for (const t of taxa) {
    const s = scoreTaxon(model, rank, t, kmers);
    if (s > bs) { bs = s; best = t; ties = [t]; }
    else if (s === bs) ties.push(t);
  }
  if (ties.length > 1) best = tieBreak === undefined ? ties.sort()[0] : ties[Math.floor(tieBreak % ties.length)];
  return { taxon: best, score: bs };
}

/** Classify one sequence; confidence is the bootstrap agreement at each rank. */
export function classify(query: string, model: TaxModel, opts: { bootstrap?: number; seed?: number; minConfidence?: number } = {}): TaxCall {
  const reps = opts.bootstrap ?? 100, seed = opts.seed ?? 1, minConf = opts.minConfidence ?? 0.8;
  const all = kmersOf(query.toUpperCase().replace(/[^ACGT]/g, ''), model.k);
  const main = bestAt(model, model.genusRank, all);
  const mainLineage = model.lineageOf.get(key(model.genusRank, main.taxon)) ?? [];
  const perRep = Math.max(1, Math.floor(query.length / 8)), rnd = mulberry32(seed);
  const agree = new Array(model.ranks.length).fill(0);
  for (let b = 0; b < reps; b++) {
    const sample: string[] = [];
    for (let i = 0; i < perRep; i++) sample.push(all[Math.floor(rnd() * all.length)] ?? '');
    const win = bestAt(model, model.genusRank, sample.filter(Boolean), Math.floor(rnd() * 1e9));
    const lin = model.lineageOf.get(key(model.genusRank, win.taxon)) ?? [];
    for (let rank = 0; rank < model.ranks.length; rank++) if (lin[rank] === mainLineage[rank]) agree[rank]++;
  }
  const confidences = agree.map((n) => n / reps);
  let deepest = 0;
  while (deepest < confidences.length && confidences[deepest] >= minConf) deepest++;
  const informative = all.reduce((n, w) => n + (model.allKmers.has(w) ? 1 : 0), 0);
  return {
    lineage: mainLineage.slice(0, deepest), confidences: confidences.slice(0, deepest),
    genus: main.taxon, score: main.score, informative: all.length ? informative / all.length : 0,
  };
}
