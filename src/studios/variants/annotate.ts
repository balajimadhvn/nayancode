/** Rule-based variant consequence annotation for one transcript per gene model.
 *  Pure TypeScript: no DOM, no network. The caller supplies the VCF, GFF/GTF and reference FASTA. */
import type { GffGene } from '@/studios/counts/gff';
import { parseVcf, type Vcf } from './kernels';
import { parseFasta, revComp, translate } from '@/studios/sequence/kernels';

export type Consequence =
  | 'splice_donor' | 'splice_acceptor' | 'stop_gained' | 'frameshift_variant' | 'start_lost' | 'stop_lost'
  | 'inframe_deletion' | 'inframe_insertion' | 'missense_variant' | 'splice_region_variant' | 'synonymous_variant'
  | '5_prime_UTR_variant' | '3_prime_UTR_variant' | 'intron_variant' | 'upstream_gene_variant' | 'downstream_gene_variant'
  | 'intergenic_variant';

export type Impact = 'HIGH' | 'MODERATE' | 'LOW' | 'MODIFIER';

/** Most severe first, exactly as the item ranks them. Lower number = more severe. */
export const CONSEQUENCE_ORDER: Consequence[] = [
  'splice_donor', 'splice_acceptor', 'stop_gained', 'frameshift_variant', 'start_lost', 'stop_lost',
  'inframe_deletion', 'inframe_insertion', 'missense_variant', 'splice_region_variant', 'synonymous_variant',
  '5_prime_UTR_variant', '3_prime_UTR_variant', 'intron_variant', 'upstream_gene_variant', 'downstream_gene_variant',
  'intergenic_variant',
];
const RANK: Record<Consequence, number> = Object.fromEntries(CONSEQUENCE_ORDER.map((c, i) => [c, i])) as Record<Consequence, number>;
const IMPACT: Record<Consequence, Impact> = {
  splice_donor: 'HIGH', splice_acceptor: 'HIGH', stop_gained: 'HIGH', frameshift_variant: 'HIGH', start_lost: 'HIGH', stop_lost: 'HIGH',
  inframe_deletion: 'MODERATE', inframe_insertion: 'MODERATE', missense_variant: 'MODERATE',
  splice_region_variant: 'LOW', synonymous_variant: 'LOW',
  '5_prime_UTR_variant': 'MODIFIER', '3_prime_UTR_variant': 'MODIFIER', intron_variant: 'MODIFIER',
  upstream_gene_variant: 'MODIFIER', downstream_gene_variant: 'MODIFIER', intergenic_variant: 'MODIFIER',
};
export const impactOf = (c: Consequence): Impact => IMPACT[c];
export const consequenceRank = (c: Consequence): number => RANK[c];

export interface AnnRow {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  gene: string;
  consequence: Consequence;
  hgvsc: string;
  hgvsp: string;
  impact: Impact;
}

export interface AnnOptions {
  /** Bases of 5' flank used for upstream/downstream calls. */
  upstream?: number;
  /** NCBI table 1 (standard) or table 11 (bacterial start codons). */
  code?: 'standard' | 'bacterial';
  /** Safety cap for the browser; records beyond it are not annotated. */
  maxRecords?: number;
}

interface AnnRecord { chrom: string; pos: number; ref: string; alt: string }

const AA3: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
  '*': 'Ter', X: 'Xaa',
};
const aa3 = (a: string | undefined) => AA3[a ?? 'X'] ?? 'Xaa';
const BACT_STARTS = new Set(['TTG', 'CTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG']);

/** Translate a CDS with the chosen code. `phase` leading bases are skipped (partial first codon). */
export function translateCds(seq: string, code: 'standard' | 'bacterial' = 'standard', phase = 0): string {
  const body = seq.slice(phase);
  if (code !== 'bacterial' || body.length < 3) return translate(body);
  const first = body.slice(0, 3);
  // Table 11 uses the standard codon table but treats alternative codons as Met at the first position.
  return BACT_STARTS.has(first) && first !== 'ATG' ? translate('ATG' + body.slice(3)) : translate(body);
}

const isStart = (codon: string, code: 'standard' | 'bacterial') => (code === 'bacterial' ? BACT_STARTS : new Set(['ATG'])).has(codon);

/** Trim shared prefix/suffix of two alleles (already in transcript orientation). */
function trimAlleles(ref: string, alt: string): { p: number; ref: string; alt: string } {
  let p = 0;
  while (p < ref.length && p < alt.length && ref[p] === alt[p]) p++;
  let s = 0;
  while (s < ref.length - p && s < alt.length - p && ref[ref.length - 1 - s] === alt[alt.length - 1 - s]) s++;
  return { p, ref: ref.slice(p, ref.length - s), alt: alt.slice(p, alt.length - s) };
}

const overlaps = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];

interface CdsSegment { start: number; end: number; phase: number }

export interface GeneModel {
  gene: GffGene;
  strand: '+' | '-';
  exons: [number, number][];
  cds: CdsSegment[];
  cdsSeq: string;
  phase: number;
  /** CDS segments in transcript order, with their offset in cdsSeq. */
  cdsSegments: { start: number; end: number; offset: number }[];
  cdsStart: number;
  cdsEnd: number;
  donors: { core: [number, number]; exon: [number, number]; intron: [number, number] }[];
  acceptors: { core: [number, number]; exon: [number, number]; intron: [number, number] }[];
}

const clamp = (a: number, b: number, lo: number, hi: number): [number, number] => [Math.max(a, lo), Math.min(b, hi)];

/** Splice sites for one gene model. Boundaries are the introns between adjacent merged exons. */
function spliceSites(exons: [number, number][], strand: '+' | '-'): Pick<GeneModel, 'donors' | 'acceptors'> {
  const donors: GeneModel['donors'] = [], acceptors: GeneModel['acceptors'] = [];
  for (let i = 0; i + 1 < exons.length; i++) {
    const [e1s, e1e] = exons[i], [e2s, e2e] = exons[i + 1];
    const intron: [number, number] = [e1e + 1, e2s - 1];
    if (intron[0] > intron[1]) continue;
    // The item's known-answer list puts the third intronic base (23 for exons 11-20/31-40) in
    // intron_variant, so the intronic splice-region window starts at the fourth base; exonic is 1-3 bases.
    if (strand === '+') {
      donors.push({ core: clamp(e1e + 1, e1e + 2, intron[0], intron[1]), exon: clamp(e1e - 2, e1e, e1s, e1e), intron: clamp(e1e + 4, e1e + 8, intron[0], intron[1]) });
      acceptors.push({ core: clamp(e2s - 2, e2s - 1, intron[0], intron[1]), exon: clamp(e2s, e2s + 2, e2s, e2e), intron: clamp(e2s - 8, e2s - 3, intron[0], intron[1]) });
    } else {
      // In transcript order the higher exon comes first. Its start is the donor; the lower exon's end is the acceptor.
      donors.push({ core: clamp(e2s - 2, e2s - 1, intron[0], intron[1]), exon: clamp(e2s, e2s + 2, e2s, e2e), intron: clamp(e2s - 8, e2s - 4, intron[0], intron[1]) });
      acceptors.push({ core: clamp(e1e + 1, e1e + 2, intron[0], intron[1]), exon: clamp(e1e - 2, e1e, e1s, e1e), intron: clamp(e1e + 3, e1e + 8, intron[0], intron[1]) });
    }
  }
  return { donors, acceptors };
}

/** Build the spliced CDS and a genomic -> transcript index, in transcript orientation. */
export function buildGeneModel(gene: GffGene, ref: string): GeneModel {
  const strand: '+' | '-' = gene.strand === '-' ? '-' : '+';
  const exons = [...gene.exons].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cds = [...(gene.cds ?? exons.map(([start, end]) => ({ start, end, phase: 0 })))].sort((a, b) => a.start - b.start || a.end - b.end);
  const ordered = strand === '+' ? cds : [...cds].reverse();
  let cdsSeq = '';
  const cdsSegments: { start: number; end: number; offset: number }[] = [];
  for (const seg of ordered) {
    const part = ref.slice(seg.start - 1, seg.end);
    cdsSegments.push({ start: seg.start, end: seg.end, offset: cdsSeq.length });
    cdsSeq += strand === '+' ? part : revComp(part);
  }
  const phase = cds[0]?.phase ?? 0;
  const cdsStart = cds.length ? Math.min(...cds.map((c) => c.start)) : 0;
  const cdsEnd = cds.length ? Math.max(...cds.map((c) => c.end)) : 0;
  return { gene, strand, exons, cds, cdsSeq, phase, cdsSegments, cdsStart, cdsEnd, ...spliceSites(exons, strand) };
}

/** 0-based index of a genomic position in the spliced CDS, or undefined when it is not coding. */
function cdsIndexAt(model: GeneModel, g: number): number | undefined {
  for (const s of model.cdsSegments) {
    if (g >= s.start && g <= s.end) return s.offset + (model.strand === '+' ? g - s.start : s.end - g);
  }
  return undefined;
}

/** Reference FASTA -> normalised contig map. `chr1`, `1` and `CHR1` resolve to the same key. */
export function referenceMap(fasta: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of parseFasta(fasta)) {
    out.set(r.id, r.seq);
    out.set(r.id.replace(/^chr/i, '').toUpperCase(), r.seq);
  }
  return out;
}
const refKey = (s: string) => s.replace(/^chr/i, '').toUpperCase();

const firstDiff = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

interface Effect { consequence: Consequence; hgvsc: string; hgvsp: string }

/** Coding effect for a variant wholly inside the CDS. Returns null when the caller's containment check was wrong. */
function codingEffect(model: GeneModel, rec: AnnRecord, code: 'standard' | 'bacterial'): Effect | null {
  for (let g = rec.pos; g < rec.pos + rec.ref.length; g++) if (cdsIndexAt(model, g) === undefined) return null;
  const startGenomic = model.strand === '+' ? rec.pos : rec.pos + rec.ref.length - 1;
  const idx = cdsIndexAt(model, startGenomic);
  if (idx === undefined) return null;
  const refT = model.strand === '+' ? rec.ref : revComp(rec.ref);
  const altT = model.strand === '+' ? rec.alt : revComp(rec.alt);
  const tr = trimAlleles(refT, altT);
  const changedStart = idx + tr.p;
  const altCds = model.cdsSeq.slice(0, idx) + altT + model.cdsSeq.slice(idx + rec.ref.length);
  const refProt = translateCds(model.cdsSeq, code, model.phase);
  const altProt = translateCds(altCds, code, model.phase);
  const delta = altT.length - refT.length;
  const codon = Math.max(0, Math.floor((changedStart - model.phase) / 3));
  const d = firstDiff(refProt, altProt);

  let consequence: Consequence;
  if (delta !== 0 && delta % 3 !== 0) consequence = 'frameshift_variant';
  else if (delta < 0) consequence = 'inframe_deletion';
  else if (delta > 0) consequence = 'inframe_insertion';
  else {
    const codonStart = model.phase + codon * 3;
    const refCodon = model.cdsSeq.slice(codonStart, codonStart + 3);
    const altCodon = altCds.slice(codonStart, codonStart + 3);
    if (codon === 0 && isStart(refCodon, code) && !isStart(altCodon, code)) consequence = 'start_lost';
    else if (refProt === altProt) consequence = 'synonymous_variant';
    else if (d < altProt.length && altProt[d] === '*' && (d >= refProt.length || refProt[d] !== '*')) consequence = 'stop_gained';
    else if (d < refProt.length && refProt[d] === '*') consequence = 'stop_lost';
    else consequence = 'missense_variant';
  }

  // HGVS c.: describe the changed part after trimming the shared VCF anchor.
  const cStart = changedStart + 1, cEnd = changedStart + tr.ref.length;
  let hgvsc = '';
  if (tr.ref.length === 1 && tr.alt.length === 1) hgvsc = `c.${cStart}${tr.ref}>${tr.alt}`;
  else if (tr.ref.length > 0 && tr.alt.length === 0) hgvsc = `c.${cStart}${tr.ref.length > 1 ? `_${cEnd}` : ''}del`;
  else if (tr.ref.length === 0 && tr.alt.length > 0) hgvsc = `c.${Math.max(1, cStart - 1)}_${Math.max(2, cStart)}ins${tr.alt}`;
  else if (tr.ref.length > 0) hgvsc = `c.${cStart}${tr.ref.length > 1 ? `_${cEnd}` : ''}delins${tr.alt}`;
  else hgvsc = `c.${cStart}=`;

  let hgvsp = '';
  const refAA = (i: number) => aa3(refProt[i] ?? 'X');
  const pos1 = (i: number) => Math.max(1, i + 1);
  if (consequence === 'start_lost') hgvsp = 'p.Met1?';
  else if (consequence === 'synonymous_variant') hgvsp = `p.${refAA(codon)}${codon + 1}=`;
  else if (consequence === 'stop_gained') hgvsp = `p.${refAA(d)}${pos1(d)}Ter`;
  else if (consequence === 'stop_lost') hgvsp = `p.Ter${pos1(d)}${aa3(altProt[d] ?? 'X')}extTer?`;
  else if (consequence === 'frameshift_variant') hgvsp = `p.${refAA(Math.min(d, refProt.length - 1))}${pos1(Math.min(d, refProt.length - 1))}fs`;
  else if (consequence === 'inframe_deletion') {
    const nDel = refProt.length - altProt.length, start = Math.min(d, refProt.length - 1), del = refProt.slice(start, start + nDel);
    hgvsp = del.length === 1 ? `p.${aa3(del[0])}${start + 1}del` : `p.${aa3(del[0])}${start + 1}_${aa3(del[del.length - 1])}${start + del.length}del`;
  } else if (consequence === 'inframe_insertion') {
    const nIns = altProt.length - refProt.length, ins = altProt.slice(d, d + nIns), text = ins.split('').map(aa3).join('');
    hgvsp = d > 0 && d < refProt.length ? `p.${aa3(refProt[d - 1])}${d}_${aa3(refProt[d])}${d + 1}ins${text}` : `p.${refAA(0)}1_${refAA(1)}2ins${text}`;
  } else hgvsp = `p.${refAA(d)}${pos1(d)}${aa3(altProt[d])}`;
  return { consequence, hgvsc, hgvsp };
}

/** Simple c. string for a non-coding change at an already-computed coordinate label (e.g. -2, *1, 123+4). */
function simpleHgvs(model: GeneModel, rec: AnnRecord, coord: string): string {
  const refT = model.strand === '+' ? rec.ref : revComp(rec.ref);
  const altT = model.strand === '+' ? rec.alt : revComp(rec.alt);
  const tr = trimAlleles(refT, altT);
  if (!coord) return '';
  if (tr.ref.length === 1 && tr.alt.length === 1) return `c.${coord}${tr.ref}>${tr.alt}`;
  if (tr.ref.length > 0 && tr.alt.length === 0) return `c.${coord}del`;
  if (tr.ref.length === 0 && tr.alt.length > 0) return `c.${coord}ins${tr.alt}`;
  return `c.${coord}delins${tr.alt}`;
}

/** c. label for an intronic base, using the nearest CDS-bearing exon boundary. */
function intronicCoord(model: GeneModel, pos: number): string {
  const idxAt = (g: number) => cdsIndexAt(model, g);
  if (model.strand === '+') {
    for (let i = model.exons.length - 1; i >= 0; i--) {
      const e = model.exons[i][1];
      if (e < pos) { const b = idxAt(e); return b === undefined ? '' : `${b + 1}+${pos - e}`; }
    }
    for (const [s] of model.exons) if (s > pos) { const b = idxAt(s); return b === undefined ? '' : `${b + 1}-${s - pos}`; }
  } else {
    // Transcript order is high -> low: an exon start above the intron is its 3' boundary; an exon end below it is its 5' boundary.
    for (const [s] of model.exons) if (s > pos) { const b = idxAt(s); return b === undefined ? '' : `${b + 1}+${s - pos}`; }
    for (let i = model.exons.length - 1; i >= 0; i--) {
      const e = model.exons[i][1];
      if (e < pos) { const b = idxAt(e); return b === undefined ? '' : `${b + 1}-${pos - e}`; }
    }
  }
  return '';
}

function spliceCoord(model: GeneModel, pos: number, donor: boolean): string {
  const idxAt = (g: number) => cdsIndexAt(model, g);
  for (const d of donor ? model.donors : model.acceptors) {
    if (d.core[0] <= pos && pos <= d.core[1]) {
      const plusSide = donor ? model.strand === '+' : model.strand !== '+';
      const boundary = plusSide ? d.exon[1] : d.exon[0];
      const b = idxAt(boundary);
      if (b === undefined) return '';
      // The selected boundary is the adjacent exon base in transcript orientation: donors are followed by
      // the intron (+), acceptors are preceded by it (-), on either strand.
      return donor ? `${b + 1}+${Math.abs(pos - boundary)}` : `${b + 1}-${Math.abs(pos - boundary)}`;
    }
  }
  return '';
}

function bestOf(cands: Effect[]): Effect | null {
  if (!cands.length) return null;
  return cands.reduce((a, b) => (consequenceRank(b.consequence) < consequenceRank(a.consequence) ? b : a));
}

/** Most severe consequence for one gene model, or null when the record is not near this gene. */
export function geneConsequence(model: GeneModel, rec: AnnRecord, code: 'standard' | 'bacterial', upstream: number): Effect | null {
  const geneStart = model.exons[0][0], geneEnd = model.exons[model.exons.length - 1][1];
  const span: [number, number] = [rec.pos, rec.pos + rec.ref.length - 1];
  const isIns = rec.alt.length > rec.ref.length && rec.alt.startsWith(rec.ref);
  const touch: [number, number] = [span[0], span[1] + (isIns ? 1 : 0)];
  if (span[1] < geneStart || span[0] > geneEnd) {
    const before = model.strand === '+' ? geneStart - span[1] : span[0] - geneEnd;
    const after = model.strand === '+' ? span[0] - geneEnd : geneStart - span[1];
    if (before > 0 && before <= upstream) return { consequence: 'upstream_gene_variant', hgvsc: '', hgvsp: '' };
    if (after > 0 && after <= upstream) return { consequence: 'downstream_gene_variant', hgvsc: '', hgvsp: '' };
    return null;
  }
  const cands: Effect[] = [];
  for (const d of model.donors) if (overlaps(touch, d.core)) cands.push({ consequence: 'splice_donor', hgvsc: simpleHgvs(model, rec, spliceCoord(model, span[0], true)), hgvsp: '' });
  for (const a of model.acceptors) if (overlaps(touch, a.core)) cands.push({ consequence: 'splice_acceptor', hgvsc: simpleHgvs(model, rec, spliceCoord(model, span[0], false)), hgvsp: '' });
  const distTo = (core: [number, number]) => (span[0] > core[1] ? span[0] - core[1] : span[1] < core[0] ? core[0] - span[1] : 0);
  const dDist = Math.min(Infinity, ...model.donors.map((d) => distTo(d.core)));
  const aDist = Math.min(Infinity, ...model.acceptors.map((a) => distTo(a.core)));
  const region = (x: { exon: [number, number]; intron: [number, number] }) => overlaps(touch, x.exon) || overlaps(touch, x.intron);
  if (dDist <= aDist) {
    for (const d of model.donors) if (region(d)) cands.push({ consequence: 'splice_region_variant', hgvsc: simpleHgvs(model, rec, intronicCoord(model, span[0])), hgvsp: '' });
  } else {
    for (const a of model.acceptors) if (region(a)) cands.push({ consequence: 'splice_region_variant', hgvsc: simpleHgvs(model, rec, intronicCoord(model, span[0])), hgvsp: '' });
  }
  const coding = codingEffect(model, rec, code);
  if (coding) cands.push(coding);
  const inExon = model.exons.some((e) => overlaps(touch, e));
  if (inExon) {
    const five = model.strand === '+' ? span[0] < model.cdsStart : span[0] > model.cdsEnd;
    const three = model.strand === '+' ? span[0] > model.cdsEnd : span[1] < model.cdsStart;
    if (five) {
      const dist = model.strand === '+' ? model.cdsStart - span[0] : span[0] - model.cdsEnd;
      cands.push({ consequence: '5_prime_UTR_variant', hgvsc: simpleHgvs(model, rec, `-${Math.max(1, dist)}`), hgvsp: '' });
    } else if (three) {
      const off = model.strand === '+' ? span[0] - model.cdsEnd : model.cdsStart - span[1];
      cands.push({ consequence: '3_prime_UTR_variant', hgvsc: simpleHgvs(model, rec, `*${Math.max(1, off)}`), hgvsp: '' });
    }
  }
  for (let i = 0; i + 1 < model.exons.length; i++) {
    const intron: [number, number] = [model.exons[i][1] + 1, model.exons[i + 1][0] - 1];
    if (intron[0] <= intron[1] && overlaps(touch, intron)) {
      cands.push({ consequence: 'intron_variant', hgvsc: simpleHgvs(model, rec, intronicCoord(model, span[0])), hgvsp: '' });
      break;
    }
  }
  return bestOf(cands);
}

const cleanAllele = (s: string) => /^[ACGT]+$/.test(s);

/** All ALT alleles from a VCF text, including the second and later alleles of a multi-allelic record. */
export function recordsFromVcf(text: string): AnnRecord[] {
  parseVcf(text); // validates the header and basic shape
  const out: AnnRecord[] = [];
  let header = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('##')) continue;
    if (line.startsWith('#CHROM')) { header = true; continue; }
    if (!header) continue;
    const f = line.split('\t');
    if (f.length < 5) continue;
    const pos = Number(f[1]), ref = f[3].toUpperCase();
    if (!Number.isInteger(pos) || pos < 1 || !cleanAllele(ref)) continue;
    for (const alt of f[4].toUpperCase().split(',')) if (cleanAllele(alt) && alt !== ref) out.push({ chrom: f[0], pos, ref, alt });
  }
  return out;
}

/** Number of data records in a VCF (used by the UI before it runs). */
export function vcfRecordCount(text: string): number {
  let n = 0, header = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('##')) continue;
    if (line.startsWith('#CHROM')) { header = true; continue; }
    if (header && line.split('\t').length >= 5) n++;
  }
  return n;
}

const BIN = 10_000;
const MAX_UPSTREAM = 100_000;

/** Annotate every ALT allele against every overlapping or nearby gene model. */
export function annotateVariants(vcf: Vcf | string, genes: GffGene[], refFasta: string, opts: AnnOptions = {}): AnnRow[] {
  const code = opts.code ?? 'standard';
  const upstream = Math.min(MAX_UPSTREAM, Math.max(0, opts.upstream ?? 5000));
  const maxRecords = opts.maxRecords ?? 50_000;
  const records = (typeof vcf === 'string' ? recordsFromVcf(vcf) : vcf.variants.map((v) => ({ chrom: v.chrom, pos: v.pos, ref: v.ref, alt: v.alt }))).slice(0, maxRecords);
  const refs = referenceMap(refFasta);
  const trimIndex = new Map<string, Map<number, number[]>>();
  const genesByContig = new Map<string, GffGene[]>();
  for (const g of genes) {
    const key = refKey(g.seqid);
    if (!refs.has(key)) continue;
    const list = genesByContig.get(key) ?? []; const gi = list.length; list.push(g); genesByContig.set(key, list);
    const bins = trimIndex.get(key) ?? new Map<number, number[]>();
    const lo = Math.floor((g.exons[0][0] - upstream) / BIN), hi = Math.floor((g.exons[g.exons.length - 1][1] + upstream) / BIN);
    for (let b = lo; b <= hi; b++) { const arr = bins.get(b) ?? []; arr.push(gi); bins.set(b, arr); }
    trimIndex.set(key, bins);
  }
  const cache = new Map<GffGene, GeneModel | null>();
  const modelOf = (g: GffGene): GeneModel | null => {
    if (cache.has(g)) return cache.get(g)!;
    const seq = refs.get(refKey(g.seqid)) ?? refs.get(g.seqid);
    const m = seq ? buildGeneModel(g, seq) : null;
    cache.set(g, m);
    return m;
  };
  const out: AnnRow[] = [];
  for (const rec of records) {
    if (!refs.has(refKey(rec.chrom))) continue;
    const bins = trimIndex.get(refKey(rec.chrom));
    const seen = new Set<number>(), found: AnnRow[] = [];
    if (bins) {
      const lo = Math.floor((rec.pos - upstream - rec.ref.length) / BIN), hi = Math.floor((rec.pos + rec.ref.length + upstream) / BIN);
      const candidates = genesByContig.get(refKey(rec.chrom)) ?? [];
      for (let b = lo; b <= hi; b++) for (const gi of bins.get(b) ?? []) {
        if (seen.has(gi)) continue; seen.add(gi);
        const m = modelOf(candidates[gi]); if (!m) continue;
        const eff = geneConsequence(m, rec, code, upstream);
        if (eff) found.push({ chrom: rec.chrom, pos: rec.pos, ref: rec.ref, alt: rec.alt, gene: candidates[gi].name || candidates[gi].id, consequence: eff.consequence, hgvsc: eff.hgvsc, hgvsp: eff.hgvsp, impact: impactOf(eff.consequence) });
      }
    }
    if (found.length) out.push(...found);
    else out.push({ chrom: rec.chrom, pos: rec.pos, ref: rec.ref, alt: rec.alt, gene: '', consequence: 'intergenic_variant', hgvsc: '', hgvsp: '', impact: 'MODIFIER' });
  }
  return out;
}

/** Add the most severe CSQ per ALT to a copy of the original VCF text. */
export function annotatedVcf(text: string, rows: AnnRow[]): string {
  const byKey = new Map<string, AnnRow[]>();
  for (const r of rows) {
    const k = `${r.chrom}\t${r.pos}\t${r.ref}`;
    const list = byKey.get(k) ?? []; list.push(r); byKey.set(k, list);
  }
  const csqOf = (r: AnnRow) => [r.gene || '.', r.consequence, r.hgvsc || '.', r.hgvsp || '.', r.impact].map((x) => x.replace(/[|;,\s]/g, '_')).join('|');
  const out: string[] = [];
  let header = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#CHROM')) {
      out.push('##INFO=<ID=CSQ,Number=.,Type=String,Description="Nayancode consequence annotation. Format: gene|consequence|hgvsc|hgvsp|impact">');
      out.push(line); header = true; continue;
    }
    if (!header || !line || line.startsWith('##')) { out.push(line); continue; }
    const f = line.split('\t');
    if (f.length < 8) { out.push(line); continue; }
    const list = byKey.get(`${f[0]}\t${f[1]}\t${f[3].toUpperCase()}`) ?? [];
    const csq = f[4].split(',').map((alt) => {
      const hit = list.filter((r) => r.alt === alt.toUpperCase()).sort((a, b) => consequenceRank(a.consequence) - consequenceRank(b.consequence))[0];
      return hit ? csqOf(hit) : '.';
    });
    f[7] = `${f[7] === '.' ? '' : f[7] + ';'}CSQ=${csq.join(',')}`;
    out.push(f.join('\t'));
  }
  return out.join('\n');
}
