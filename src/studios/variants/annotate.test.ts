import { describe, expect, it } from 'vitest';
import { revComp } from '@/studios/sequence/kernels';
import { parseGff } from '@/studios/counts/gff';
import type { GffGene } from '@/studios/counts/gff';
import { annotateVariants, annotatedVcf, recordsFromVcf, vcfRecordCount } from './annotate';

// Hand derivation (also checked by /tmp/phase4-scratch/check.py, a plain-Python codon table):
// 60 nt reference; exon 11-40, CDS 11-28 = ATG AAA CCC GGG TTT TAA (18 nt, stop at 26-28).
//   codon 1 ATG Met, 2 AAA Lys, 3 CCC Pro, 4 GGG Gly, 5 TTT Phe, 6 TAA Ter.
const REF = 'ACGTACGTAC' + 'ATGAAACCCGGGTTTTAA' + 'GGCATCGATCGA' + 'TTACGGCATGCATGCCATGC';
const FASTA = `>chr1\n${REF}\n`;

const gene = (over: Partial<GffGene> = {}): GffGene => ({
  id: 'G1', name: 'GENE1', seqid: 'chr1', strand: '+', exons: [[11, 40]], length: 30, ...over,
});

const vcfText = (records: string[]) => ['##fileformat=VCFv4.2', '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO', ...records].join('\n');
const one = (line: string, genes: GffGene[] = [gene()], ref = FASTA, opts = {}) => annotateVariants(vcfText([line]), genes, ref, opts);

describe('annotateVariants: single-exon plus-strand known answers', () => {
  it('calls synonymous, missense, stop-gained, start-lost and stop-lost SNVs', () => {
    expect(one('chr1\t16\t.\tA\tG\t.\tPASS\t.')[0]).toMatchObject({ consequence: 'synonymous_variant', hgvsc: 'c.6A>G', hgvsp: 'p.Lys2=', impact: 'LOW' });
    expect(one('chr1\t14\t.\tA\tG\t.\tPASS\t.')[0]).toMatchObject({ consequence: 'missense_variant', hgvsc: 'c.4A>G', hgvsp: 'p.Lys2Glu', impact: 'MODERATE' });
    expect(one('chr1\t14\t.\tA\tT\t.\tPASS\t.')[0]).toMatchObject({ consequence: 'stop_gained', hgvsc: 'c.4A>T', hgvsp: 'p.Lys2Ter', impact: 'HIGH' });
    expect(one('chr1\t12\t.\tT\tC\t.\tPASS\t.')[0]).toMatchObject({ consequence: 'start_lost', hgvsc: 'c.2T>C', hgvsp: 'p.Met1?', impact: 'HIGH' });
    expect(one('chr1\t26\t.\tT\tC\t.\tPASS\t.')[0]).toMatchObject({ consequence: 'stop_lost', hgvsc: 'c.16T>C', hgvsp: 'p.Ter6GlnextTer?', impact: 'HIGH' });
  });

  it('calls a 1 bp deletion as a frameshift (plain translation: first changed residue is the lost stop)', () => {
    expect(one('chr1\t17\t.\tCC\tC\t.\tPASS\t.')[0]).toMatchObject({ consequence: 'frameshift_variant', hgvsc: 'c.8del', hgvsp: 'p.Ter6fs', impact: 'HIGH' });
  });

  it('calls a 3 bp deletion and a 3 bp insertion as in-frame changes', () => {
    expect(one('chr1\t16\t.\tACCC\tA\t.\tPASS\t.')[0]).toMatchObject({ consequence: 'inframe_deletion', hgvsc: 'c.7_9del', hgvsp: 'p.Pro3del', impact: 'MODERATE' });
    expect(one('chr1\t16\t.\tA\tAGGG\t.\tPASS\t.')[0]).toMatchObject({ consequence: 'inframe_insertion', hgvsc: 'c.6_7insGGG', hgvsp: 'p.Lys2_Pro3insGly', impact: 'MODERATE' });
  });
});

describe('annotateVariants: two-exon gene, splice sites and the spliced junction', () => {
  // Exons 11-20 + 31-40; spliced CDS = ATG AAA CCC GGG TTT TAA GC = MKPGF*.
  // Intron 21-30. Donor core 21-22, acceptor core 29-30. Position 19 is exonic 2 bases from the donor.
  const REF2 = 'ACGTACGTAC' + 'ATGAAACCCG' + 'TACGTACGTA' + 'GGTTTTAAGC' + 'TTACGGCATGCATGCCATGC';
  const g2 = gene({ exons: [[11, 20], [31, 40]], length: 20, cds: [{ start: 11, end: 20, phase: 0 }, { start: 31, end: 40, phase: 0 }] });
  const at = (line: string) => one(line, [g2], `>chr1\n${REF2}\n`)[0];

  it('calls the two intronic bases on each side of the intron', () => {
    expect(at('chr1\t21\t.\tT\tC\t.\tPASS\t.').consequence).toBe('splice_donor');
    expect(at('chr1\t22\t.\tA\tG\t.\tPASS\t.').consequence).toBe('splice_donor');
    expect(at('chr1\t29\t.\tA\tG\t.\tPASS\t.').consequence).toBe('splice_acceptor');
    expect(at('chr1\t30\t.\tC\tG\t.\tPASS\t.').consequence).toBe('splice_acceptor');
    expect(at('chr1\t23\t.\tG\tA\t.\tPASS\t.').consequence).toBe('intron_variant');
    expect(at('chr1\t24\t.\tG\tA\t.\tPASS\t.').consequence).toBe('splice_region_variant');
    expect(at('chr1\t28\t.\tG\tA\t.\tPASS\t.').consequence).toBe('splice_region_variant');
  });

  it('mirrors the splice cores on the minus strand', () => {
    const mr = revComp(REF2);
    const mg2 = gene({ exons: [[21, 30], [41, 50]], length: 20, strand: '-', cds: [{ start: 21, end: 30, phase: 0 }, { start: 41, end: 50, phase: 0 }] });
    const at2 = (line: string) => one(line, [mg2], `>chr1\n${mr}\n`)[0];
    expect(at2('chr1\t40\t.\tA\tG\t.\tPASS\t.').consequence).toBe('splice_donor');
    expect(at2('chr1\t39\t.\tA\tG\t.\tPASS\t.').consequence).toBe('splice_donor');
    expect(at2('chr1\t31\t.\tA\tG\t.\tPASS\t.').consequence).toBe('splice_acceptor');
    expect(at2('chr1\t32\t.\tA\tG\t.\tPASS\t.').consequence).toBe('splice_acceptor');
  });

  it('lets the higher-ranked splice_region win over a synonymous coding change at position 19', () => {
    const r = at('chr1\t19\t.\tC\tT\t.\tPASS\t.');
    expect(r.consequence).toBe('splice_region_variant');
    expect(r.impact).toBe('LOW');
  });

  it('translates across the exon-exon junction (position 31 is c.11, codon 4 is GGG)', () => {
    expect(at('chr1\t31\t.\tG\tA\t.\tPASS\t.')).toMatchObject({ consequence: 'missense_variant', hgvsc: 'c.11G>A', hgvsp: 'p.Gly4Glu' });
  });
});

describe('annotateVariants: UTR, flanking and intergenic calls', () => {
  it('calls a 5 prime UTR variant when the CDS starts after the exon', () => {
    const r = one('chr1\t9\t.\tA\tG\t.\tPASS\t.', [gene({ exons: [[8, 40]], length: 33, cds: [{ start: 11, end: 28, phase: 0 }] })])[0];
    expect(r).toMatchObject({ consequence: '5_prime_UTR_variant', hgvsc: 'c.-2A>G', impact: 'MODIFIER' });
  });

  it('calls upstream within the window and intergenic on a contig with no genes', () => {
    expect(one('chr1\t5\t.\tA\tG\t.\tPASS\t.')[0].consequence).toBe('upstream_gene_variant');
    expect(one('chr2\t5\t.\tA\tG\t.\tPASS\t.', [gene()], '>chr1\n' + REF + '\n>chr2\nACGTACGTACGTACGTACGT\n')[0].consequence).toBe('intergenic_variant');
  });

  it('annotates both ALTs of a multi-allelic record', () => {
    const rows = annotateVariants(vcfText(['chr1\t14\t.\tA\tC,G\t.\tPASS\t.']), [gene()], FASTA);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.alt, r.consequence, r.hgvsp])).toEqual([
      ['C', 'missense_variant', 'p.Lys2Gln'],
      ['G', 'missense_variant', 'p.Lys2Glu'],
    ]);
  });
});

describe('annotateVariants: minus strand gives the same consequences and proteins', () => {
  // Reverse-complement the whole reference. Exon 11-40 becomes 21-50; CDS 11-28 becomes 33-50.
  const MREF = revComp(REF);
  const mg = gene({ exons: [[21, 50]], length: 30, strand: '-', cds: [{ start: 33, end: 50, phase: 0 }] });
  const at = (line: string) => one(line, [mg], `>chr1\n${MREF}\n`)[0];

  it('mirrors the five SNVs', () => {
    expect(at('chr1\t47\t.\tT\tC\t.\tPASS\t.')).toMatchObject({ consequence: 'missense_variant', hgvsc: 'c.4A>G', hgvsp: 'p.Lys2Glu' });
    expect(at('chr1\t45\t.\tT\tC\t.\tPASS\t.')).toMatchObject({ consequence: 'synonymous_variant', hgvsc: 'c.6A>G', hgvsp: 'p.Lys2=' });
    expect(at('chr1\t47\t.\tT\tA\t.\tPASS\t.')).toMatchObject({ consequence: 'stop_gained', hgvsc: 'c.4A>T', hgvsp: 'p.Lys2Ter' });
    expect(at('chr1\t49\t.\tA\tG\t.\tPASS\t.')).toMatchObject({ consequence: 'start_lost', hgvsc: 'c.2T>C', hgvsp: 'p.Met1?' });
    expect(at('chr1\t35\t.\tA\tG\t.\tPASS\t.')).toMatchObject({ consequence: 'stop_lost', hgvsc: 'c.16T>C', hgvsp: 'p.Ter6GlnextTer?' });
  });

  it('mirrors the three indels', () => {
    expect(at('chr1\t43\t.\tGG\tG\t.\tPASS\t.')).toMatchObject({ consequence: 'frameshift_variant', hgvsc: 'c.8del', hgvsp: 'p.Ter6fs' });
    expect(at('chr1\t42\t.\tGGGT\tT\t.\tPASS\t.')).toMatchObject({ consequence: 'inframe_deletion', hgvsc: 'c.7_9del', hgvsp: 'p.Pro3del' });
    expect(at('chr1\t45\t.\tT\tCCCT\t.\tPASS\t.')).toMatchObject({ consequence: 'inframe_insertion', hgvsc: 'c.6_7insGGG', hgvsp: 'p.Lys2_Pro3insGly' });
  });
});

describe('GFF CDS phase and VCF export helpers', () => {
  it('parseGff keeps CDS phase information', () => {
    const gff = [
      '##gff-version 3',
      'chr1\ttest\tgene\t11\t40\t.\t+\t.\tID=g1;Name=G1',
      'chr1\ttest\tmRNA\t11\t40\t.\t+\t.\tID=t1;Parent=g1',
      'chr1\ttest\texon\t11\t40\t.\t+\t.\tParent=t1',
      'chr1\ttest\tCDS\t11\t28\t.\t+\t0\tParent=t1',
    ].join('\n');
    expect(parseGff(gff).genes[0].cds).toEqual([{ start: 11, end: 28, phase: 0 }]);
  });

  it('recordsFromVcf splits multi-allelic ALTs and counts data records', () => {
    const text = vcfText(['chr1\t14\t.\tA\tC,G\t.\tPASS\t.', 'chr1\t16\t.\tA\tG\t.\tPASS\t.']);
    expect(recordsFromVcf(text).map((r) => r.alt)).toEqual(['C', 'G', 'G']);
    expect(vcfRecordCount(text)).toBe(2);
  });

  it('writes a CSQ INFO field with one entry per ALT', () => {
    const text = vcfText(['chr1\t14\t.\tA\tC,G\t.\tPASS\t.']);
    const rows = annotateVariants(text, [gene()], FASTA);
    const out = annotatedVcf(text, rows);
    expect(out).toContain('##INFO=<ID=CSQ');
    expect(out).toContain('CSQ=GENE1|missense_variant|c.4A>C|p.Lys2Gln|MODERATE,GENE1|missense_variant|c.4A>G|p.Lys2Glu|MODERATE');
  });
});
