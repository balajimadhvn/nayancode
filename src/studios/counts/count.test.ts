import { describe, expect, it } from 'vitest';
import { countReads, tpm, tpmFromCounts, type AlignedRead } from './count';
import type { GffGene } from './gff';
import { countsGenes, simulateCounts } from './simCounts';

const g = (id: string, strand: '+' | '-', start: number, end: number): GffGene => ({ id, name: id, seqid: 'chr1', strand, exons: [[start, end]], length: end - start + 1 });
const read = (start: number, end: number, strand: '+' | '-' = '+', mapq = 60): AlignedRead => ({ seqid: 'chr1', blocks: [[start, end]], strand, mapq });

describe('countReads', () => {
  it('assigns a read that overlaps exactly one gene', () => {
    const r = countReads([read(110, 130)], [g('a', '+', 100, 200), g('b', '+', 300, 400)]);
    expect(r.counts.get('a')).toBe(1);
    expect(r.counts.get('b')).toBe(0);
    expect(r).toMatchObject({ assigned: 1, ambiguous: 0, noFeature: 0, lowMapq: 0, unmapped: 0 });
  });

  it('counts overlapping genes as ambiguous, and strand rules resolve them', () => {
    const genes = [g('plus', '+', 100, 300), g('minus', '-', 200, 400)];
    const fwd = read(220, 240, '+');
    expect(countReads([fwd], genes).ambiguous).toBe(1);
    expect(countReads([fwd], genes, { stranded: 'none' }).counts.get('plus')).toBe(0);
    expect(countReads([fwd], genes, { stranded: 'forward' }).counts.get('plus')).toBe(1);
    expect(countReads([fwd], genes, { stranded: 'reverse' }).counts.get('minus')).toBe(1);
  });

  it('counts a spliced read that hits two exons of the same gene once', () => {
    const gene: GffGene = { id: 'spliced', name: 'spliced', seqid: 'chr1', strand: '+', exons: [[100, 200], [300, 400]], length: 202 };
    const r = countReads([{ seqid: 'chr1', blocks: [[150, 160], [305, 315]], strand: '+', mapq: 60 }], [gene]);
    expect(r.counts.get('spliced')).toBe(1);
  });

  it('counts low MAPQ, unmapped and no-feature reads separately', () => {
    const r = countReads([read(110, 130, '+', 3), { seqid: '*', blocks: [], strand: '+', mapq: 0, unmapped: true }, read(5000, 5020)], [g('a', '+', 100, 200)]);
    expect(r).toMatchObject({ assigned: 0, ambiguous: 0, noFeature: 1, lowMapq: 1, unmapped: 1 });
  });

  it('requires minOverlap bases and respects minMapq', () => {
    const r = countReads([read(195, 210), read(110, 120, '+', 20)], [g('a', '+', 100, 200)], { minOverlap: 10, minMapq: 30 });
    expect(r.counts.get('a')).toBe(0);
    expect(r.lowMapq).toBe(1);
    expect(r.noFeature).toBe(1);
  });

  it('matches the planted counts of the 20-gene simulator exactly (unstranded)', () => {
    const sim = simulateCounts({ seed: 11 });
    const r = countReads(sim.reads, sim.genes);
    for (const gene of sim.genes) {
      if (gene.id === 'gene18' || gene.id === 'gene19' || gene.id === 'gene20') continue;
      expect(r.counts.get(gene.id), gene.id).toBe(sim.planted.get(gene.id));
    }
    expect(r.ambiguous).toBe(sim.overlapReads);
    expect(r.noFeature).toBe(0);
    expect(r.assigned + r.ambiguous).toBe(sim.reads.length);
    expect(r.counts.get('gene18')).toBe(5);
    expect(r.counts.get('gene19')).toBe(8);
    expect(r.counts.get('gene20')).toBe(10);
  });

  it('reverse strandedness with reverse-stranded reads resolves all 20 genes to the planted counts', () => {
    const sim = simulateCounts({ seed: 11 });
    const r = countReads(sim.reads, sim.genes, { stranded: 'reverse' });
    for (const gene of sim.genes) expect(r.counts.get(gene.id), gene.id).toBe(sim.planted.get(gene.id));
    expect(r.ambiguous).toBe(0);
    expect(r.assigned).toBe(sim.reads.length);
    expect(sim.overlapReads).toBe(52);
  });
});

describe('TPM', () => {
  it('computes the analytic TPM for counts [10,20,30] and lengths [1000,2000,1500]', () => {
    expect(tpmFromCounts([10, 20, 30], [1000, 2000, 1500])).toEqual([250000, 250000, 500000]);
  });

  it('works from maps and returns zeros when nothing is expressed', () => {
    const counts = new Map([['a', 10], ['b', 20], ['c', 30]]), lengths = new Map([['a', 1000], ['b', 2000], ['c', 1500]]);
    expect([...tpm(counts, lengths).values()]).toEqual([250000, 250000, 500000]);
    expect([...tpm(new Map([['x', 0]]), new Map([['x', 1000]])).values()]).toEqual([0]);
  });

  it('lengths its gene list from the same 20-gene annotation', () => {
    expect(countsGenes()).toHaveLength(20);
    expect(countsGenes()[17]).toMatchObject({ id: 'gene18', strand: '+', length: 2001 });
  });
});
