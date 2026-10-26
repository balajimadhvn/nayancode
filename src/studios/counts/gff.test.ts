import { describe, expect, it } from 'vitest';
import { detectFormat, parseGff } from './gff';

const GFF3 = [
  '##gff-version 3',
  'chr1\ttest\tgene\t100\t400\t.\t+\t.\tID=gene1;Name=ALPHA',
  'chr1\ttest\tmRNA\t100\t400\t.\t+\t.\tID=tx1;Parent=gene1',
  'chr1\ttest\texon\t100\t200\t.\t+\t.\tID=ex1;Parent=tx1',
  'chr1\ttest\texon\t300\t400\t.\t+\t.\tID=ex2;Parent=tx1',
].join('\n');

const GTF = [
  'chr1\ttest\tgene\t100\t400\t.\t+\t.\tgene_id "gene1"; gene_name "ALPHA";',
  'chr1\ttest\ttranscript\t100\t400\t.\t+\t.\tgene_id "gene1"; transcript_id "tx1";',
  'chr1\ttest\texon\t100\t200\t.\t+\t.\tgene_id "gene1"; transcript_id "tx1"; exon_number "1";',
  'chr1\ttest\texon\t300\t400\t.\t+\t.\tgene_id "gene1"; transcript_id "tx1"; exon_number "2";',
].join('\n');

describe('parseGff', () => {
  it('parses GFF3 gene/exon links and uses the 202 bp exon union', () => {
    const m = parseGff(GFF3);
    expect(m.format).toBe('gff3');
    expect(m.features).toHaveLength(4);
    expect(m.genes).toHaveLength(1);
    expect(m.genes[0]).toMatchObject({ id: 'gene1', name: 'ALPHA', seqid: 'chr1', strand: '+', exons: [[100, 200], [300, 400]], length: 202 });
  });

  it('parses the GTF equivalent to the same gene model', () => {
    expect(detectFormat(GTF)).toBe('gtf');
    const m = parseGff(GTF);
    expect(m.genes).toHaveLength(1);
    const g = m.genes[0];
    expect(g.id).toBe('gene1');
    expect(g.name).toBe('ALPHA');
    expect(g.strand).toBe('+');
    expect(g.exons).toEqual([[100, 200], [300, 400]]);
    expect(g.length).toBe(202);
  });

  it('merges the exon union of overlapping transcripts', () => {
    const text = [
      'chr1\ttest\tgene\t100\t450\t.\t-\t.\tID=g2;Name=BETA',
      'chr1\ttest\tmRNA\t100\t400\t.\t-\t.\tID=t1;Parent=g2',
      'chr1\ttest\tmRNA\t150\t450\t.\t-\t.\tID=t2;Parent=g2',
      'chr1\ttest\texon\t100\t200\t.\t-\t.\tParent=t1',
      'chr1\ttest\texon\t300\t400\t.\t-\t.\tParent=t1',
      'chr1\ttest\texon\t150\t250\t.\t-\t.\tParent=t2',
      'chr1\ttest\texon\t420\t450\t.\t-\t.\tParent=t2',
    ].join('\n');
    const g = parseGff(text).genes[0];
    expect(g.strand).toBe('-');
    expect(g.exons).toEqual([[100, 250], [300, 400], [420, 450]]);
    expect(g.length).toBe(151 + 101 + 31);
  });

  it('builds a gene from exons when the gene row is absent, and skips comments', () => {
    const text = [
      '# only transcripts',
      'chrX\ttest\tmRNA\t10\t50\t.\t+\t.\tID=tx9;Parent=missingGene',
      'chrX\ttest\texon\t10\t20\t.\t+\t.\tParent=tx9',
      'chrX\ttest\texon\t40\t50\t.\t+\t.\tParent=tx9',
    ].join('\n');
    const m = parseGff(text);
    expect(m.genes).toHaveLength(1);
    expect(m.genes[0].id).toBe('missingGene');
    expect(m.genes[0].length).toBe(22);
  });
});
