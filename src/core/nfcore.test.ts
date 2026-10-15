import { describe, expect, it } from 'vitest';
import { buildSheet, convertRnaseqCounts, detect, parseMultiqc, suggestGroups } from './nfcore';

describe('nf-core import', () => {
  it('recognises the common nf-core outputs by name and content', () => {
    expect(detect('salmon.merged.gene_counts.tsv', 'gene_id\tgene_name\tA\tB').kind).toBe('rnaseq-counts');
    expect(detect('matrix.mtx.gz', '').kind).toBe('tenx-matrix'); expect(detect('features.tsv.gz', '').kind).toBe('tenx-features'); expect(detect('barcodes.tsv', '').kind).toBe('tenx-barcodes');
    expect(detect('sample1.vcf.gz', '').kind).toBe('vcf'); expect(detect('multiqc_general_stats.txt', '').kind).toBe('multiqc-general');
    expect(detect('samplesheet.csv', 'sample,fastq_1,fastq_2,strandedness').kind).toBe('samplesheet'); expect(detect('notes.txt', 'hello').kind).toBe('unknown');
  });
  it('converts the rnaseq merged table, preferring symbols and summing duplicates', () => {
    const t = 'gene_id\tgene_name\tWT_REP1\tWT_REP2\tKO_REP1\tKO_REP2\nENSG1\tTP53\t10\t12\t30\t28\nENSG2\tTP53\t1\t1\t1\t1\nENSG3\t\t5\t5\t5\t5\n';
    const c = convertRnaseqCounts(t); expect(c.samples).toEqual(['WT_REP1', 'WT_REP2', 'KO_REP1', 'KO_REP2']); expect(c.mergedDuplicates).toBe(1);
    expect(c.csv.split('\n')).toEqual(['gene,WT_REP1,WT_REP2,KO_REP1,KO_REP2', 'TP53,11,13,31,29', 'ENSG3,5,5,5,5']);
    expect(convertRnaseqCounts(t, false).idColumn).toBe('gene_id'); expect(() => convertRnaseqCounts('a\tb\n1\t2')).toThrow(/gene_id/);
  });
  it('suggests groups from replicate suffixes and leaves unique names blank', () => {
    expect(suggestGroups(['WT_REP1', 'WT_REP2', 'KO_rep1', 'KO-2'])).toEqual(['WT', 'WT', 'KO', 'KO']); expect(suggestGroups(['a', 'b'])).toEqual(['', '']);
    expect(buildSheet(['s1', 's2'], ['x', 'y'], ['b1', 'b2'])).toBe('sample,group,batch\ns1,x,b1\ns2,y,b2');
  });
  it('parses MultiQC general stats', () => { const r = parseMultiqc('Sample\tfastqc-total_sequences\ns1\t1000\ns2\t2000'); expect(r.rows[1]['fastqc-total_sequences']).toBe('2000'); });
});
