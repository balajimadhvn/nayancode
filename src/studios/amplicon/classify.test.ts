import { describe, expect, it } from 'vitest';
import { classify, parseReference, trainClassifier } from './classify';
import { syntheticTaxonomy, randomDna } from './simAmplicon';
import { mulberry32 } from '../reads/tools';

const sim = syntheticTaxonomy(7);
const model = trainClassifier(parseReference(sim.reference));

describe('RDP-style naive Bayes classifier', () => {
  it('reads a semicolon lineage from the FASTA description', () => {
    const refs = parseReference(sim.reference);
    expect(refs).toHaveLength(36);
    expect(refs[0].lineage).toHaveLength(3);
    expect(() => parseReference('>only_an_id\nACGTACGTACGT\n')).toThrow(/lineage/i);
  });

  it('classifies held-out 3 % variants to the right genus with confident bootstraps', () => {
    const calls = sim.queries.map((q) => classify(q.seq, model, { bootstrap: 100, seed: 11, minConfidence: 0 }));
    const correct = calls.filter((c, i) => c.genus === sim.queries[i].genus).length;
    expect(correct / sim.queries.length).toBeGreaterThanOrEqual(0.95);
    const confident = calls.filter((c) => c.confidences[model.genusRank] >= 0.8).length;
    expect(confident / calls.length).toBeGreaterThanOrEqual(0.9);
    expect(calls[0].lineage[0]).toBe('Bacteria');
  });

  it('gives a random sequence low confidence at the phylum rank', () => {
    const call = classify(randomDna(250, mulberry32(1000)), model, { bootstrap: 100, seed: 3, minConfidence: 0 });
    expect(call.confidences[1]).toBeLessThan(0.5);
    expect(call.confidences[model.genusRank]).toBeLessThan(0.8);
  });
});
