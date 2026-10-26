import { describe, expect, it } from 'vitest';
import { MAX_SEQUENCES, demoDatabase, parseDb } from './db';
import { RESIDUES } from './sw';

describe('parseDb', () => {
  it('keeps non-empty records, counts residues and reports empty ones', () => {
    const db = parseDb('>a first protein\nACDE\n>b empty\n\n>c ambiguous\nXX\n');
    expect(db.seqs.map((s) => s.id)).toEqual(['a', 'c']);
    expect(db.seqs[0].description).toBe('first protein');
    expect(db.residues).toBe(6);
    expect(db.skipped).toBe(1);
  });

  it('encodes residues in BLOSUM62 order and maps unknown letters to X', () => {
    const db = parseDb('>a\nACDEJ\n');
    expect(Array.from(db.seqs[0].codes)).toEqual([
      RESIDUES.indexOf('A'), RESIDUES.indexOf('C'), RESIDUES.indexOf('D'),
      RESIDUES.indexOf('E'), 24,
    ]);
    expect(db.seqs[0].length).toBe(5);
  });

  it('fails clearly when the sequence cap is exceeded', () => {
    const tooMany = '>s\nA\n'.repeat(MAX_SEQUENCES + 1);
    expect(() => parseDb(tooMany)).toThrow(/limit is 300,000/);
  });

  it('fails clearly on an empty file', () => {
    expect(() => parseDb('>\n\n')).toThrow(/No protein sequences/);
  });
});

describe('synthetic demo database', () => {
  it('has 2,000 labelled sequences and five planted family members', () => {
    const { query, db, familyIds } = demoDatabase();
    expect(query).toHaveLength(300);
    expect(db.seqs).toHaveLength(2000);
    expect(familyIds).toHaveLength(5);
    for (const id of familyIds) {
      const s = db.seqs.find((x) => x.id === id);
      expect(s, id).toBeDefined();
      expect(s!.length).toBe(300);
      let diff = 0;
      for (let i = 0; i < 300; i++) if (s!.seq[i] !== query[i]) diff++;
      expect(diff / 300).toBeLessThan(0.45);
    }
    expect(db.seqs.every((s) => s.description.includes('SYNTHETIC'))).toBe(true);
  });
});
