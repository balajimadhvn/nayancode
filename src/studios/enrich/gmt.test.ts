import { describe, expect, it } from 'vitest';
import { parseGeneList, parseGmt, parseRanked } from './gmt';

describe('parseGmt', () => {
  it('parses names, descriptions and de-duplicated upper-case genes while skipping blanks', () => {
    const text = [
      'SET_A\tfirst set\tTP53\tBRCA1\ttp53\tEGFR',
      '',
      'SET_B\tsecond set\tMYC\tKRAS',
      'SET_C\tthird set\tCDK1',
    ].join('\n');
    const sets = parseGmt(text);
    expect(sets.map((s) => s.name)).toEqual(['SET_A', 'SET_B', 'SET_C']);
    expect(sets[0].description).toBe('first set');
    expect(sets[0].genes).toEqual(['TP53', 'BRCA1', 'EGFR']);
    expect(sets[1].genes).toEqual(['MYC', 'KRAS']);
  });

  it('skips a line without a third tab-separated field', () => {
    expect(parseGmt('BROKEN\tdescription')).toEqual([]);
  });
});

describe('parseGeneList', () => {
  it('splits on whitespace, commas and semicolons, upper-cases and de-duplicates', () => {
    expect(parseGeneList('tp53, BRCA1;egfr\ntp53  MYC,,')).toEqual(['TP53', 'BRCA1', 'EGFR', 'MYC']);
  });
});

describe('parseRanked', () => {
  it('skips a non-numeric header, keeps the first duplicate and sorts descending', () => {
    const rows = parseRanked('gene\tscore\nG1\t1.5\nG2\t3\nG1\t99\nG3\t-2\nbad\tx');
    expect(rows).toEqual([
      { gene: 'G2', score: 3 },
      { gene: 'G1', score: 1.5 },
      { gene: 'G3', score: -2 },
    ]);
  });

  it('accepts comma separators', () => {
    expect(parseRanked('A,2\nB,1')).toEqual([{ gene: 'A', score: 2 }, { gene: 'B', score: 1 }]);
  });
});
