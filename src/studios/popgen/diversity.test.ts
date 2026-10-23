import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { diversityStats, parseAlignedFasta, slidingDiversity } from './diversity';

const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/popgen/reference.json', import.meta.url), 'utf8')) as {
  alignment: string[]; S: number; pi: number; thetaW: number; tajimasD: number;
};

describe('sequence diversity', () => {
  it("matches the hand-computed reference for AAAA/AAAT/AATT/ATTT", () => {
    const st = diversityStats(ref.alignment);
    expect(st.S).toBe(ref.S);
    expect(st.pi).toBeCloseTo(ref.pi, 12);
    expect(st.thetaW).toBeCloseTo(ref.thetaW, 12);
    expect(st.D).toBeCloseTo(ref.tajimasD, 12);
  });

  it('returns D = null (not NaN) for an alignment without segregating sites', () => {
    const st = diversityStats(['ACGT', 'ACGT', 'ACGT', 'ACGT']);
    expect(st.S).toBe(0);
    expect(st.pi).toBe(0);
    expect(st.D).toBeNull();
  });

  it('needs at least four sequences for Tajima’s D', () => {
    expect(() => diversityStats(['AAAA', 'AAAT', 'AATT'])).toThrow(/four sequences/);
  });

  it('drops columns with gaps or N from π and S', () => {
    const st = diversityStats(['A-AA', 'AAAA', 'AANA', 'AAAA']);
    expect(st.sites).toBe(4);
    expect(st.usableSites).toBe(2);
    expect(st.S).toBe(0);
    expect(st.pi).toBe(0);
  });

  it('reports per-window π in a sliding scan', () => {
    const st = slidingDiversity(['AAAA', 'AAAT', 'AATT', 'ATTT'], 2, 1);
    expect(st.length).toBeGreaterThan(1);
    expect(st[0]).toMatchObject({ start: 0, end: 2 });
    const later = st.find((w) => w.start === 2)!;
    expect(later.pi).toBeGreaterThan(st[0].pi);
  });
});

describe('aligned FASTA parsing', () => {
  it('keeps gaps and uppercases the sequence', () => {
    const records = parseAlignedFasta('>a first\nacg-t\n>b\nACGT');
    expect(records.map((r) => r.id)).toEqual(['a', 'b']);
    expect(records[0].seq).toBe('ACG-T');
  });
});
