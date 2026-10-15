import { describe, expect, it } from 'vitest';
import { CFD_MM } from './cfdData';
import { cfdScore, CRISPR_NUCLEASES, mitSiteScore, scoreHits, searchGuides } from './crispr';
import { annotateInterval, decodeSeq, parseFastaCodes, parseGenes, revCompCodes, encodeSeq } from './genomeData';
import { bruteForceSites, concatContigs, DEFAULT_SITE_OPTS, findSites, predictProducts, seedLength, summariseProducts, threePrimeWeight } from './primerSearch';

const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const rndSeq = (n: number, seed: number) => { const r = rng(seed); return Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join(''); };
const rc = (s: string) => decodeSeq(revCompCodes(encodeSeq(s)));
const mutate = (s: string, at: number[]) => [...s].map((c, i) => (at.includes(i) ? 'ACGT'[('ACGT'.indexOf(c) + 1) % 4] : c)).join('');
const genome = (...seqs: string[]) => parseFastaCodes(seqs.map((s, i) => `>c${i + 1} test\n${s}\n`).join(''));

describe('FASTA and GFF parsing', () => {
  it('encodes bases and keeps names', () => {
    const c = parseFastaCodes('>NC_1 some description\nACGTN\nacgt\n>x\n\n>y\nGG\n');
    expect(c.map((x) => [x.name, x.length])).toEqual([['NC_1', 9], ['y', 2]]); expect(c[0].description).toBe('some description'); expect(decodeSeq(c[0].codes)).toBe('ACGTNACGT');
  });
  it('reads RefSeq-style genes with CDS product and annotates intervals', () => {
    const gff = ['##gff-version 3', 'c1\tx\tgene\t101\t400\t.\t+\t.\tID=gene-b1;Name=thrL;locus_tag=b0001;gene_biotype=protein_coding', 'c1\tx\tCDS\t121\t390\t.\t+\t0\tID=cds-1;Parent=gene-b1;product=leader peptide', 'c1\tx\tgene\t901\t1000\t.\t-\t.\tID=gene-b2;locus_tag=b0002;gene_biotype=tRNA'].join('\n');
    const genes = parseGenes(gff); expect(genes).toHaveLength(2); expect(genes[0]).toMatchObject({ start: 100, end: 400, name: 'thrL', product: 'leader peptide', cds: [120, 390] });
    expect(annotateInterval(genes, 'c1', 200, 220)).toMatchObject({ where: 'CDS', gene: 'thrL' });
    expect(annotateInterval(genes, 'c1', 100, 118).where).toBe('gene (outside CDS)');
    expect(annotateInterval(genes, 'c1', 600, 620)).toMatchObject({ where: 'intergenic', gene: 'thrL', distance: 200 });
  });
});

describe('primer binding sites', () => {
  const g = concatContigs(genome(rndSeq(30000, 1), rndSeq(20000, 2)));
  const fwd = g.contigs[0].codes, primer = decodeSeq(fwd, 1000, 1022);
  it('finds exact sites on both strands and agrees with brute force', () => {
    const p2 = rc(decodeSeq(fwd, 1300, 1322));
    for (const opts of [{ maxMismatch: 0 }, { maxMismatch: 2 }, { maxMismatch: 3, max3Mismatch: 2 }, { maxMismatch: 4, max3Mismatch: 0, threeLen: 6 }]) {
      const a = findSites(g, [primer, p2], opts), b = bruteForceSites(g, [primer, p2], opts);
      expect(a).toEqual(b); expect(a.some((s) => s.primer === 0 && s.strand === '+' && s.pos === 1000 && s.mismatches === 0)).toBe(true); expect(a.some((s) => s.primer === 1 && s.strand === '-' && s.pos === 1300)).toBe(true);
    }
  });
  it('3′ mismatches are weighted and can veto a site', () => {
    const bad3 = mutate(primer, [21]), badMid = mutate(primer, [8]), strict = { maxMismatch: 3, max3Mismatch: 0, threeLen: 5 };
    expect(findSites(g, [bad3], strict).some((s) => s.pos === 1000)).toBe(false);
    const lax = findSites(g, [bad3, badMid], { maxMismatch: 3, max3Mismatch: 1, threeLen: 5 }).filter((s) => s.pos === 1000 && s.strand === '+');
    expect(lax).toHaveLength(2); expect(lax.find((s) => s.primer === 0)!.penalty).toBe(threePrimeWeight(0)); expect(lax.find((s) => s.primer === 1)!.penalty).toBe(1);
  });
  it('uses seeds only when they are long enough (≥ 4 bases)', () => { expect(seedLength(20, 3)).toBe(5); expect(seedLength(20, 6)).toBe(0); expect(seedLength(24, 3)).toBe(6); expect(seedLength(20, 1)).toBe(10); expect(seedLength(30, 0)).toBe(11); });
  it('predicts amplicons, flags off-target products and respects size limits', () => {
    const f = decodeSeq(fwd, 5000, 5022), r = rc(decodeSeq(fwd, 5300, 5322)), sites = findSites(g, [f, r], { maxMismatch: 0 });
    const { products } = predictProducts(sites, [[0, 1]], 100, 1000); expect(products).toHaveLength(1); expect(products[0]).toMatchObject({ contig: 0, start: 5000, end: 5322, size: 322, perfect: true, intended: true });
    expect(summariseProducts(products).verdict).toBe('specific'); expect(predictProducts(sites, [[0, 1]], 100, 300).products).toHaveLength(0);
    // A second, imperfect binding site for the forward primer one kb away creates an off-target product.
    const g2 = concatContigs(genome(decodeSeq(fwd, 0, 5322) + mutate(f, [3]) + decodeSeq(fwd, 5344, 5400) + rc(r) + rndSeq(300, 9)));
    const s2 = findSites(g2, [f, r], { maxMismatch: 2 }), pr = predictProducts(s2, [[0, 1]], 50, 2000).products; expect(pr.length).toBeGreaterThanOrEqual(2);
    expect(summariseProducts(pr).verdict).toBe('off-target products'); expect(pr.some((p) => !p.perfect)).toBe(true);
  });
  it('does not report windows that straddle two contigs', () => {
    const a = 'ACGTACGTAGCTAGCTAGGATC', gg = concatContigs(genome(rndSeq(100, 3) + a.slice(0, 10), a.slice(10) + rndSeq(100, 4)));
    expect(findSites(gg, [a], { maxMismatch: 4 }).filter((s) => s.mismatches < 3)).toHaveLength(0);
  });
});

describe('CRISPR scoring', () => {
  it('CFD: perfect NGG is 1, NAG is 0.259, mismatches multiply the published weights', () => {
    const guide = 'AGGTGTAGTGTGTGTGATAA';
    expect(cfdScore(guide, guide, 'TGG')).toBe(1); expect(cfdScore(guide, guide, 'TAG')).toBeCloseTo(0.259259259, 8); expect(cfdScore(guide, guide, 'TCC')).toBe(0);
    const t = 'CGGTGTAGTGTGTGTGATAA'; expect(cfdScore(guide, t, 'AGG')).toBeCloseTo(CFD_MM.AC1, 9);
  });
  it('MIT: single PAM-proximal mismatch scores much lower than a PAM-distal one', () => {
    expect(mitSiteScore([])).toBe(100); expect(mitSiteScore([20])).toBeLessThan(mitSiteScore([1])); expect(mitSiteScore([1])).toBeCloseTo(100, 6);
  });
});

const sp = CRISPR_NUCLEASES[0];
describe('CRISPR off-target search', () => {
  const guide = 'GACGCATAAAGATGAGACGC', base = rndSeq(8000, 11).replace(/GG/g, 'GA').replace(/CC/g, 'CA');
  // Plant: exact site (+ strand, TGG), a 2-mismatch site with AGG on the − strand, a 4-mismatch NAG site, a 5-mismatch site (excluded).
  const planted = base.slice(0, 1000) + guide + 'TGG' + base.slice(1023, 3000) + rc(mutate(guide, [3, 12]) + 'AGG') + base.slice(3023, 5000) + mutate(guide, [0, 5, 10, 15]) + 'CAG' + base.slice(5023, 6000) + mutate(guide, [0, 4, 8, 12, 16]) + 'TGG' + base.slice(6023);
  const cs = genome(planted);
  it('finds planted sites with the expected mismatches, strands and coordinates', () => {
    const r = searchGuides(cs, [guide], { nuclease: sp, maxMismatch: 4, pams: ['NGG', 'NAG'] }), at = (p: number) => r.hits.find((h) => h.siteStart === p);
    expect(at(1000)).toMatchObject({ strand: '+', mismatches: 0, pam: 'TGG', start: 1000, end: 1020 }); expect(at(3000)).toMatchObject({ strand: '-', mismatches: 2, pam: 'AGG' }); expect(at(3000)!.mmPos.length).toBe(2);
    expect(r.hits.find((h) => h.pam === 'CAG')).toMatchObject({ mismatches: 4, strand: '+' });
    expect(r.hits.some((h) => h.mismatches === 5)).toBe(false); expect(r.hits.every((h) => h.mismatches <= 4)).toBe(true);
    expect(r.hits.find((h) => h.siteStart === 3000)!.target.replace(/[a-z]/g, '').length).toBe(18);
  });
  it('matches an independent brute-force scan on random guides', () => {
    const g = rndSeq(60000, 21), cs2 = genome(g, rndSeq(15000, 22)), guides = Array.from({ length: 4 }, (_, i) => g.slice(2000 + i * 5000, 2020 + i * 5000));
    for (const [mm, pams] of [[2, ['NGG']], [4, ['NGG', 'NAG']]] as const) {
      const got = searchGuides(cs2, guides, { nuclease: sp, maxMismatch: mm, pams: [...pams] }).hits.map((h) => `${h.guide}:${h.contig}:${h.strand}:${h.siteStart}:${h.mismatches}`).sort();
      const want: string[] = [];
      cs2.forEach((c, ci) => {
        const seq = decodeSeq(c.codes);
        for (const strand of ['+', '-'] as const) {
          const s = strand === '+' ? seq : rc(seq);
          for (let i = 0; i + 23 <= s.length; i++) {
            const pam = s.slice(i + 20, i + 23); if (!pams.some((p) => [...p].every((b, j) => b === 'N' || b === pam[j]))) continue;
            guides.forEach((gd, gi) => { let m = 0; for (let j = 0; j < 20; j++) if (s[i + j] !== gd[j]) m++; if (m <= mm) want.push(`${gi}:${ci}:${strand}:${strand === '+' ? i : s.length - i - 23}:${m}`); });
          }
        }
      });
      expect(got).toEqual(want.sort());
    }
  });
  it('Cas12a uses a 5′ TTTV PAM', () => {
    const g12 = 'ACGTTGCAAGGCTTAACCGATGC', body = rndSeq(3000, 5).replace(/TTT/g, 'TTA'), s = body.slice(0, 500) + 'TTTG' + g12 + body.slice(527), r = searchGuides(genome(s), [g12], { nuclease: CRISPR_NUCLEASES[2], maxMismatch: 2 });
    expect(r.hits).toHaveLength(1); expect(r.hits[0]).toMatchObject({ strand: '+', pam: 'TTTG', siteStart: 500, siteEnd: 527, start: 504, end: 527, mismatches: 0 });
    const rr = searchGuides(genome(rc(s)), [g12], { nuclease: CRISPR_NUCLEASES[2], maxMismatch: 2 }); expect(rr.hits[0]).toMatchObject({ strand: '-', mismatches: 0, siteStart: rc(s).length - 527 });
  });
  it('finds DNA and RNA bulges when allowed, and nothing extra when not', () => {
    const noBulge = searchGuides(genome(base.slice(0, 500) + guide.slice(0, 10) + 'T' + guide.slice(10) + 'TGG' + base.slice(523)), [guide], { nuclease: sp, maxMismatch: 1 });
    expect(noBulge.hits).toHaveLength(0);
    const dnaB = searchGuides(genome(base.slice(0, 500) + guide.slice(0, 10) + 'T' + guide.slice(10) + 'TGG' + base.slice(524)), [guide], { nuclease: sp, maxMismatch: 1, maxDnaBulge: 1 });
    expect(dnaB.hits.find((h) => h.dnaBulge === 1 && h.mismatches === 0)).toBeTruthy();
    const rnaB = searchGuides(genome(base.slice(0, 500) + guide.slice(0, 10) + guide.slice(11) + 'TGG' + base.slice(522)), [guide], { nuclease: sp, maxMismatch: 1, maxRnaBulge: 1 });
    const h = rnaB.hits.find((x) => x.rnaBulge === 1 && x.mismatches === 0); expect(h).toBeTruthy(); expect(h!.target).toContain('-');
    // Ungapped hits are unchanged by turning bulges on.
    const a = searchGuides(cs, [guide], { nuclease: sp, maxMismatch: 3 }).hits.map((x) => x.siteStart), b = searchGuides(cs, [guide], { nuclease: sp, maxMismatch: 3, maxDnaBulge: 1, maxRnaBulge: 1 }).hits.filter((x) => !x.dnaBulge && !x.rnaBulge).map((x) => x.siteStart);
    for (const p of a) expect(b).toContain(p);
  });
  it('scores hits: on-target excluded, CFD and MIT aggregate fall with more off-targets', () => {
    const r = searchGuides(cs, [guide], { nuclease: sp, maxMismatch: 4, pams: ['NGG', 'NAG'] }), { scored, perGuide } = scoreHits(r.hits, [guide], new Set(['TGG', 'AGG', 'CGG', 'GGG']));
    expect(scored.filter((h) => h.onTarget)).toHaveLength(1); expect(perGuide[0].offTargets).toBe(r.hits.length - 1); expect(perGuide[0].cfdSpecificity!).toBeLessThan(100); expect(perGuide[0].cfdSpecificity!).toBeGreaterThan(0);
    expect(scored.find((h) => h.pam === 'CAG')!.cfd!).toBeLessThan(0.3);
  });
});
export { DEFAULT_SITE_OPTS };
