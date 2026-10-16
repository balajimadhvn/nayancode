import { exposeKernels, type Kernel } from '@/compute/rpc';
import { CRISPR_NUCLEASES, scoreHits, searchGuides, type ScoredHit } from './crispr';
import { annotateInterval, loadBundled, parseFastaCodes, parseGenes, type Genome } from './genomeData';
import { concatContigs, findSites, predictProducts, summariseProducts, type GenomeIndexBase, type KmerIndex, type PrimerSite, type Product, type SiteOpts, type SpecificitySummary } from './primerSearch';

/** Where the genome comes from: a bundled RefSeq genome, or FASTA (and optional GFF3) text the user supplied. */
export type GenomeSource = { kind: 'bundled'; id: string } | { kind: 'text'; name: string; fasta: string; gff?: string };
interface Entry { key: string; genome: Genome; gi?: GenomeIndexBase; idx: Map<number, KmerIndex> }
let last: Entry | null = null;
async function genomeFor(src: GenomeSource): Promise<Entry> {
  const key = src.kind === 'bundled' ? src.id : `${src.name}:${src.fasta.length}:${src.fasta.slice(0, 64)}:${src.fasta.slice(-64)}:${src.gff?.length ?? 0}`;
  if (last?.key === key) return last;
  const genome = src.kind === 'bundled' ? await loadBundled(src.id) : { id: 'user', name: src.name, contigs: parseFastaCodes(src.fasta), genes: src.gff ? parseGenes(src.gff) : [] };
  if (!genome.contigs.length) throw new Error('No sequence found in the genome FASTA.');
  return (last = { key, genome, idx: new Map<number, KmerIndex>() });
}
const info = (g: Genome) => ({ name: g.name, bp: g.contigs.reduce((a, c) => a + c.length, 0), contigs: g.contigs.map((c) => ({ name: c.name, length: c.length })), annotated: g.genes.length > 0 });

export interface PrimerReq { src: GenomeSource; primers: { name: string; seq: string }[]; pairs: [number, number][]; opts: SiteOpts; minSize: number; maxSize: number }
export interface PrimerRes {
  genome: ReturnType<typeof info>; ms: number; summary: SpecificitySummary; truncated: boolean;
  sites: (PrimerSite & { contigName: string; gene: string })[];
  products: (Omit<Product, 'fwd' | 'rev'> & { contigName: string; fwdPrimer: number; revPrimer: number; fwdMm: number; revMm: number; fwdPen: number; revPen: number; gene: string })[];
}
const primers: Kernel<PrimerReq, PrimerRes> = async (a, ctx) => {
  ctx.progress(0.05, 'loading genome'); const G = await genomeFor(a.src), t0 = performance.now(); G.gi ??= concatContigs(G.genome.contigs);
  ctx.progress(0.3, 'indexing and searching'); const sites = findSites(G.gi, a.primers.map((p) => p.seq), a.opts, G.idx), { products, truncated } = predictProducts(sites, a.pairs, a.minSize, a.maxSize);
  const name = (ci: number) => G.genome.contigs[ci].name, gene = (ci: number, s: number, e: number) => { const r = annotateInterval(G.genome.genes, name(ci), s, e); return r.gene ? `${r.gene}${r.where === 'intergenic' ? ` (${r.distance} bp away)` : ''}` : ''; };
  return {
    genome: info(G.genome), ms: performance.now() - t0, summary: summariseProducts(products, Math.max(1, a.pairs.length)), truncated,
    sites: sites.slice(0, 2000).map((s) => ({ ...s, contigName: name(s.contig), gene: gene(s.contig, s.pos, s.pos + s.length) })),
    products: products.slice(0, 1000).map(({ fwd, rev, ...p }) => ({ ...p, contigName: name(p.contig), fwdPrimer: fwd.primer, revPrimer: rev.primer, fwdMm: fwd.mismatches, revMm: rev.mismatches, fwdPen: fwd.penalty, revPen: rev.penalty, gene: gene(p.contig, p.start, p.end) })),
  };
};

export interface CrisprReq { src: GenomeSource; guides: { name: string; seq: string }[]; nucleaseId: string; pams: string[]; maxMismatch: number; maxDnaBulge: number; maxRnaBulge: number }
export interface CrisprHit extends ScoredHit { contigName: string; where: string; gene: string; product: string }
export interface CrisprRes { genome: ReturnType<typeof info>; ms: number; pamSites: number; truncated: boolean[]; shown: number; total: number; hits: CrisprHit[]; perGuide: ReturnType<typeof scoreHits>['perGuide'] }
const crispr: Kernel<CrisprReq, CrisprRes> = async (a, ctx) => {
  ctx.progress(0.05, 'loading genome'); const G = await genomeFor(a.src), nuc = CRISPR_NUCLEASES.find((n) => n.id === a.nucleaseId) ?? CRISPR_NUCLEASES[0], t0 = performance.now();
  ctx.progress(0.2, 'scanning both strands');
  const res = searchGuides(G.genome.contigs, a.guides.map((g) => g.seq), { nuclease: nuc, maxMismatch: a.maxMismatch, maxDnaBulge: a.maxDnaBulge, maxRnaBulge: a.maxRnaBulge, pams: a.pams, pamSide: nuc.pamSide });
  const primary = new Set(nuc.pams.filter((p) => p.primary).map((p) => p.pam)), isPrimary = (pam: string) => [...primary].some((p) => [...p].every((b, i) => b === 'N' || b === pam[i] || (b === 'V' && pam[i] !== 'T') || (b === 'R' && /[AG]/.test(pam[i]))));
  ctx.progress(0.85, 'scoring and annotating'); const { scored, perGuide } = scoreHits(res.hits, a.guides.map((g) => g.seq), isPrimary);
  // Fewest mismatches first, then highest CFD; cap what is sent to the page (the counts above stay complete).
  const order = [...scored].sort((x, y) => x.guide - y.guide || x.mismatches + x.dnaBulge + x.rnaBulge - (y.mismatches + y.dnaBulge + y.rnaBulge) || (y.cfd ?? 0) - (x.cfd ?? 0)), shown = order.slice(0, 3000);
  const hits = shown.map((h) => { const n = G.genome.contigs[h.contig].name, an = annotateInterval(G.genome.genes, n, h.start, h.end); return { ...h, contigName: n, where: an.where, gene: an.gene ? `${an.gene}${an.where === 'intergenic' ? ` (${an.distance} bp)` : ''}` : '', product: an.product }; });
  return { genome: info(G.genome), ms: performance.now() - t0, pamSites: res.pamSites, truncated: res.truncated, shown: hits.length, total: scored.length, hits, perGuide };
};
export type OffTargetKernels = { primers: typeof primers; crispr: typeof crispr };
exposeKernels({ primers, crispr } as Record<string, Kernel>);
