import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseFasta } from '@/studios/sequence/kernels';
import {
  annotateAmrRefs,
  buildAmrIndex,
  parseAmrCatalog,
  parseAmrFasta,
  parseAmrHeader,
  pickDemoRefs,
  screenContigs,
  syntheticAmrContig,
  type AmrIndex,
  type AmrRef,
} from './search';

const gz = (rel: string) => gunzipSync(readFileSync(new URL(rel, import.meta.url))).toString('utf8');

let refs: AmrRef[];
let index: AmrIndex;

beforeAll(() => {
  refs = parseAmrFasta(gz('../../../public/data/amr/AMR_CDS.fa.gz'));
  annotateAmrRefs(refs, parseAmrCatalog(gz('../../../public/data/amr/ReferenceGeneCatalog.txt.gz')));
  index = buildAmrIndex(refs);
}, 300_000);

/** Deterministic random ACGT backbone (uniform bases, so GC lands at about 50 %). */
function randomSeq(length: number, seed: number): string {
  let state = seed >>> 0 || 1;
  const rand = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const bases = 'ACGT';
  let out = '';
  for (let i = 0; i < length; i++) out += bases[Math.floor(rand() * 4)];
  return out;
}

const bySymbol = (symbol: string) => {
  const hit = refs.find((r) => r.symbol === symbol);
  if (!hit) throw new Error(`Reference gene ${symbol} is not in AMR_CDS.fa`);
  return hit;
};

describe('AMR reference parsing', () => {
  it('reads the pipe-delimited AMR_CDS header fields', () => {
    const h = parseAmrHeader('>AAA16360.1|L11078.1|1|1|stxA2b|stxA2b|Shiga_toxin_Stx2b_subunit_A L11078.1:177-1136');
    expect(h.symbol).toBe('stxA2b');
    expect(h.allele).toBe('stxA2b');
    expect(h.product).toBe('Shiga_toxin_Stx2b_subunit_A');
    expect(h.proteinAccession).toBe('AAA16360.1');
    expect(h.nucleotideAccession).toBe('L11078.1');
  });

  it('indexes every reference k-mer in ascending key order', () => {
    expect(refs.length).toBeGreaterThan(9000);
    expect(index.keys.length).toBe(index.refIds.length);
    expect(index.positions.length).toBe(index.keys.length);
    for (let i = 1; i < index.keys.length; i++) expect(index.keys[i]).toBeGreaterThanOrEqual(index.keys[i - 1]);
    expect(index.keys[0]).toBeGreaterThanOrEqual(0);
    expect(index.keys[index.keys.length - 1]).toBeLessThan(2 ** 30);
  }, 60_000);

  it('annotates drug classes from the reference gene catalogue', () => {
    expect(bySymbol('sul1').drugClass).toBe('SULFONAMIDE');
    expect(bySymbol('tet(A)').drugClass).toBe('TETRACYCLINE');
    expect(bySymbol('blaTEM-1').drugClass).toBe('BETA-LACTAM');
    expect(bySymbol("aac(6')-Ib-cr").subclass).toContain('QUINOLONE');
  });
});

describe('contig screening', () => {
  // Order matters: gene 1 carries the 3 % substitutions, gene 2 the 3-nt deletion, the rest are exact.
  let chosenCache: AmrRef[] | null = null, demoCache: ReturnType<typeof syntheticAmrContig> | null = null;
  const chosen = () => (chosenCache ??= pickDemoRefs(refs));
  const demo = () => (demoCache ??= syntheticAmrContig(chosen(), { seed: 7 }));

  it('builds a 20 kb contig with balanced composition and five inserts', () => {
    const d = demo();
    expect(d.contig.seq.length).toBe(20_000);
    const gc = [...d.contig.seq].filter((b) => b === 'G' || b === 'C').length / d.contig.seq.length;
    expect(gc).toBeGreaterThan(0.45);
    expect(gc).toBeLessThan(0.55);
    expect(d.truth.map((t) => t.strand).join('')).toBe('+-+-+');
    expect(d.truth[0].mutation).toBe('3 % substitutions');
    expect(d.truth[1].mutation).toBe('3-nt deletion');
  }, 120_000);

  it('finds all five genes with the right symbol, strand, coordinates and identity', () => {
    const d = demo();
    const hits = screenContigs(index, [d.contig]);
    expect(hits.length).toBe(5);
    for (const truth of d.truth) {
      const hit = hits.find((h) => h.gene === truth.gene);
      expect(hit, `no hit for ${truth.gene}`).toBeDefined();
      expect(hit!.gene).toBe(truth.gene);
      expect(hit!.allele).toBe(truth.allele);
      expect(hit!.strand).toBe(truth.strand);
      expect(Math.abs(hit!.start - truth.start)).toBeLessThanOrEqual(5);
      expect(Math.abs(hit!.end - truth.end)).toBeLessThanOrEqual(5);
      expect(hit!.coverage).toBeGreaterThan(0.95);
      if (truth.mutation === 'exact') expect(hit!.identity).toBeCloseTo(1, 6);
      else expect(hit!.identity).toBeGreaterThanOrEqual(0.96);
    }
    // Drug class comes from the catalogue, not from an invented table.
    const oxa = hits.find((h) => h.gene === 'blaOXA-1')!;
    expect(oxa.product).toContain('beta-lactamase');
    expect(oxa.drugClass).toContain('BETA-LACTAM');
  }, 120_000);

  it('reports hits sorted by contig and position', () => {
    const hits = screenContigs(index, [demo().contig]);
    for (let i = 1; i < hits.length; i++) expect(hits[i].start).toBeGreaterThan(hits[i - 1].start);
  }, 120_000);

  it('returns nothing for a 50 kb random contig', () => {
    const hits = screenContigs(index, [{ name: 'random_50kb', seq: randomSeq(50_000, 424242) }]);
    expect(hits).toEqual([]);
  }, 120_000);

  it('holds a half-length gene back at minCoverage 0.6 and reports it at 0.4', () => {
    const sul1 = bySymbol('sul1');
    const half = sul1.seq.slice(0, Math.floor(sul1.seq.length / 2));
    const backbone = randomSeq(6_000, 99).split('');
    for (let j = 0; j < half.length; j++) backbone[1_000 + j] = half[j];
    const contig = { name: 'truncated', seq: backbone.join('') };
    const strict = screenContigs(index, [contig], { minCoverage: 0.6 });
    expect(strict).toEqual([]);
    const loose = screenContigs(index, [contig], { minCoverage: 0.4 });
    expect(loose.length).toBeGreaterThan(0);
    expect(loose.some((h) => h.gene === 'sul1')).toBe(true);
    const h = loose.find((x) => x.gene === 'sul1')!;
    expect(h.coverage).toBeGreaterThanOrEqual(0.4);
    expect(h.coverage).toBeLessThan(0.6);
    // The winner at this locus is the 828 bp sul1 homologue, not the 840 bp record that was cut in half: it aligns
    // the same 420 columns over a shorter reference, so identity·coverage is 0.506 against the exact record's 0.500.
    // That homologue differs from the inserted sequence at one base inside the half, hence 419/420 = 0.9976 identity.
    expect(h.refLength).toBe(828);
    expect(h.identity).toBeGreaterThan(0.99);
  }, 120_000);

  it('collapses the homologous mecA records into the single best hit at one locus', () => {
    const mec = bySymbol('mecA');
    const backbone = randomSeq(5_000, 11).split('');
    for (let j = 0; j < mec.seq.length; j++) backbone[500 + j] = mec.seq[j];
    const hits = screenContigs(index, [{ name: 'single_locus', seq: backbone.join('') }]);
    const atLocus = hits.filter((h) => h.start < 500 + mec.seq.length && h.end > 500);
    expect(atLocus.length).toBe(1);
    expect(atLocus[0].gene).toBe('mecA');
    expect(atLocus[0].identity).toBeCloseTo(1, 6);
    expect(Math.abs(atLocus[0].start - 501)).toBeLessThanOrEqual(5);
    expect(Math.abs(atLocus[0].end - (500 + mec.seq.length))).toBeLessThanOrEqual(5);
  }, 120_000);

  it('rejects a contig longer than the 20 Mb per-contig cap', () => {
    expect(() => screenContigs(index, [{ name: 'too_long', seq: 'A'.repeat(20_000_001) }])).toThrowError(/20 Mb/);
  });

  it('screens the bundled E. coli K-12 genome in under 60 s with fewer than 25 hits', () => {
    const contigs = parseFasta(gz('../../../public/genomes/ecoli-k12.fna.gz')).map((r) => ({ name: r.id, seq: r.seq }));
    expect(contigs.length).toBe(1);
    const t0 = performance.now();
    const hits = screenContigs(index, contigs);
    const ms = performance.now() - t0;
    console.log(`E. coli K-12 (${contigs[0].seq.length.toLocaleString()} bp): ${ms.toFixed(0)} ms, ${hits.length} hit(s)`);
    for (const h of hits) console.log(`  ${h.gene}\t${h.allele}\t${h.contig}:${h.start}-${h.end}(${h.strand})\tidentity ${h.identity.toFixed(4)}\tcoverage ${h.coverage.toFixed(3)}\t${h.drugClass}`);
    if (!hits.length) console.log('  (no acquired AMR genes found)');
    expect(ms).toBeLessThan(60_000);
    expect(hits.length).toBeLessThan(25);
  }, 300_000);
});

describe('demo helpers', () => {
  it('picks the five documented reference genes for the UI demo', () => {
    const picked = pickDemoRefs(refs);
    expect(picked.length).toBe(5);
    expect(new Set(picked.map((r) => r.symbol)).size).toBe(5);
    expect(picked.map((r) => r.symbol)).toEqual(['sul1', 'tet(A)', 'mecA', 'blaOXA-1', "aac(6')-Ib-cr"]);
  });
});
