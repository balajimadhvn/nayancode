import { describe, expect, it } from 'vitest';
import { AMP_MAX_POINTS, ampScreen } from './amp';

describe('ampScreen heuristic', () => {
  it('scores magainin 2 and melittin at least 0.6', () => {
    const magainin = ampScreen('GIGKFLHSAKKFGKAFVGEIMNS');
    const melittin = ampScreen('GIGAVLKVLTTGLPALISWIKRKRQQ');
    expect(magainin.score).toBeGreaterThanOrEqual(0.6);
    expect(melittin.score).toBeGreaterThanOrEqual(0.6);
  });
  it('scores anionic and glycine-only peptides at most 0.2', () => {
    expect(ampScreen('EEEEDDDDEEEE').score).toBeLessThanOrEqual(0.2);
    expect(ampScreen('GGGGGSGGGGSGGGG').score).toBeLessThanOrEqual(0.2);
  });
  it('scores a five-residue peptide at most 0.3', () => {
    const r = ampScreen('GGGGS');
    expect(r.score).toBeLessThanOrEqual(0.3);
    expect(r.criteria[0].passed).toBe(false);
  });
  it('reports points and reasons for every criterion', () => {
    const r = ampScreen('GIGKFLHSAKKFGKAFVGEIMNS');
    expect(r.criteria).toHaveLength(5);
    expect(r.reasons).toHaveLength(5);
    for (const c of r.criteria) {
      expect(c.points).toBeGreaterThanOrEqual(0);
      expect(c.points).toBeLessThanOrEqual(c.max);
    }
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.criteria.reduce((s, c) => s + c.points, 0) / AMP_MAX_POINTS).toBeGreaterThanOrEqual(0.6);
  });
  it('gives the ≥ +4 charge bonus', () => {
    const r = ampScreen('GKKKKKKKKKG');
    expect(r.charge).toBeGreaterThan(6);
    expect(r.criteria[1].points).toBe(3);
  });
  it('penalises more than two cysteines', () => {
    expect(ampScreen('GCCCCGGGGGGG').criteria[4].points).toBe(0);
  });
});
