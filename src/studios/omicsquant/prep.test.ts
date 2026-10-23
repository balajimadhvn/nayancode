import { describe, expect, it } from 'vitest';
import { parseGroups } from '../expression/kernels';
import { differential, filterFeatures, impute, log2Transform, missingnessSummary, normalise, parseMatrix, simulateQuantDemo, type QuantMatrix } from './prep';

const mat = (ids: string[], samples: string[], rows: number[][]): QuantMatrix => ({ ids, samples, values: Float64Array.from(rows.flat()) });
const sampleMedian = (m: QuantMatrix, j: number) => {
  const v: number[] = [];
  for (let i = 0; i < m.ids.length; i++) { const x = m.values[i * m.samples.length + j]; if (!Number.isNaN(x)) v.push(x); }
  v.sort((a, b) => a - b);
  const h = v.length >> 1;
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
};

describe('parseMatrix', () => {
  it('reads CSV, strips quotes and treats blank, NA, NaN and non-positive values as missing', () => {
    const m = parseMatrix('id,"S1",S2,S3\nA,10,0,NA\nB,20,30,\nC,40,50,NaN\nD,60,70,80\n');
    expect(m.samples).toEqual(['S1', 'S2', 'S3']);
    expect(m.ids).toEqual(['A', 'B', 'C', 'D']);
    expect(Array.from(m.values)).toEqual([10, NaN, NaN, 20, 30, NaN, 40, 50, NaN, 60, 70, 80]);
    const s = missingnessSummary(m);
    expect(s.perSample.map((x) => x.missing)).toEqual([0, 1, 3]);
    expect(s.perFeature.map((x) => x.missing)).toEqual([2, 1, 1, 0]);
  });

  it('detects MaxQuant proteinGroups.txt, strips the LFQ prefix and drops every flagged row', () => {
    const text = [
      'Protein IDs\tReverse\tPotential contaminant\tOnly identified by site\tLFQ intensity S1\tLFQ intensity S2',
      'P1\t\t\t\t1000\t2000',
      'P2\t+\t\t\t3000\t4000',
      'P3\t\t+\t\t5000\t6000',
      'P4\t\t\t+\t7000\t8000',
      'P5\t+\t\t\t9000\t10000',
      'P6\t\t\t\t11000\t12000',
    ].join('\n');
    const m = parseMatrix(text);
    expect(m.samples).toEqual(['S1', 'S2']);
    expect(m.ids).toEqual(['P1', 'P6']);
    expect(Array.from(m.values)).toEqual([1000, 2000, 11000, 12000]);
  });
});

describe('transform, filter and normalise', () => {
  it('log2-transforms positive values and makes zeros and negatives missing', () => {
    const m = mat(['A'], ['S1', 'S2', 'S3', 'S4'], [[0, -4, 8, NaN]]);
    const l = log2Transform(m);
    expect(Number.isNaN(l.values[0])).toBe(true);
    expect(Number.isNaN(l.values[1])).toBe(true);
    expect(l.values[2]).toBeCloseTo(3, 12);
    expect(Number.isNaN(l.values[3])).toBe(true);
    const p = log2Transform(mat(['A'], ['S1'], [[3]]), { addPseudocount: true });
    expect(p.values[0]).toBeCloseTo(2, 12);
  });

  it('keeps features with enough observed values in at least one group', () => {
    const m = mat(['A', 'B', 'C'], ['S1', 'S2', 'S3', 'S4'], [
      [1, 2, NaN, NaN],
      [NaN, 3, 5, 4],
      [1, NaN, NaN, NaN],
    ]);
    const f = filterFeatures(m, ['A', 'A', 'B', 'B'], 2);
    expect(f.ids).toEqual(['A', 'B']);
  });

  it('median normalisation makes every sample median equal to the grand median', () => {
    const m = mat(['A', 'B', 'C', 'D'], ['S1', 'S2', 'S3'], [
      [1, 5, 9],
      [2, 6, NaN],
      [3, 7, 10],
      [4, 8, 11],
    ]);
    const n = normalise(m, 'median');
    const meds = [0, 1, 2].map((j) => sampleMedian(n, j));
    expect(Math.abs(meds[0] - meds[1])).toBeLessThan(1e-9);
    expect(Math.abs(meds[0] - meds[2])).toBeLessThan(1e-9);
    // observed pattern and missingness are preserved
    expect(Number.isNaN(n.values[1 * 3 + 2])).toBe(true);
    expect(n.values[0 * 3 + 0]).toBeCloseTo(m.values[0] - 2.5 + 6, 12);
  });

  it('quantile normalisation gives every sample the same sorted values', () => {
    const m = mat(['A', 'B', 'C', 'D'], ['S1', 'S2', 'S3'], [
      [1, 20, 300],
      [2, 25, 400],
      [3, 30, 500],
      [4, 40, 600],
    ]);
    const n = normalise(m, 'quantile');
    const sorted = [0, 1, 2].map((j) => [0, 1, 2, 3].map((i) => n.values[i * 3 + j]).sort((a, b) => a - b));
    for (let k = 0; k < 4; k++) for (let j = 1; j < 3; j++) expect(Math.abs(sorted[0][k] - sorted[j][k])).toBeLessThan(1e-9);
    const tie = normalise(mat(['A', 'B', 'C'], ['S1', 'S2'], [[1, 10], [1, 20], [3, 30]]), 'quantile');
    expect(tie.values[0 * 2 + 0]).toBe(tie.values[1 * 2 + 0]); // equal ranks get the same averaged value
  });
});

describe('imputation', () => {
  const m = mat(['A', 'B', 'C', 'D'], ['S1', 'S2', 'S3'], [
    [2, 8, NaN],
    [4, 10, 16],
    [6, NaN, 18],
    [NaN, 12, 20],
  ]);

  it.each(['halfmin', 'minprob', 'knn'] as const)('%s fills exactly the missing cells and never changes observed ones', (method) => {
    const { matrix, mask } = impute(m, method, { seed: 7 });
    let filled = 0;
    for (let k = 0; k < m.values.length; k++) {
      if (Number.isNaN(m.values[k])) {
        expect(mask[k]).toBe(1);
        expect(Number.isFinite(matrix.values[k])).toBe(true);
        filled++;
      } else {
        expect(mask[k]).toBe(0);
        expect(matrix.values[k]).toBe(m.values[k]);
      }
    }
    expect(filled).toBe(3);
  });

  it('halfmin uses half of the feature minimum', () => {
    const { matrix } = impute(m, 'halfmin');
    expect(matrix.values[0 * 3 + 2]).toBe(1); // A: min 2
    expect(matrix.values[2 * 3 + 1]).toBe(3); // C: min 6
  });

  it('is deterministic for a seed and changes with it', () => {
    const a = impute(m, 'minprob', { seed: 3 }), b = impute(m, 'minprob', { seed: 3 }), c = impute(m, 'minprob', { seed: 4 });
    expect(Array.from(a.matrix.values)).toEqual(Array.from(b.matrix.values));
    expect(Array.from(a.matrix.values)).not.toEqual(Array.from(c.matrix.values));
  });
});

describe('planted differential abundance', () => {
  it('recovers the spiked features after log2, median normalisation, minprob imputation and the moderated test', () => {
    const demo = simulateQuantDemo({ seed: 11 });
    const raw = parseMatrix(demo.matrix);
    const groups = parseGroups(demo.sheet, raw.samples);
    const logged = log2Transform(raw);
    const filtered = filterFeatures(logged, groups, 2);
    const norm = normalise(filtered, 'median');
    const { matrix, mask } = impute(norm, 'minprob', { seed: 1 });
    const res = differential(matrix, groups, { numerator: 'Treated', denominator: 'Control' }, { imputed: mask });
    const isPlanted = res.rows.map((r) => demo.planted.has(r.id));
    const scores = res.rows.map((r) => -Math.log10(Math.max(r.p, 1e-300)));
    const pos = scores.filter((_, i) => isPlanted[i]), neg = scores.filter((_, i) => !isPlanted[i]);
    let wins = 0;
    for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
    const auc = wins / (pos.length * neg.length);
    const tp = res.rows.filter((r, i) => isPlanted[i] && r.fdr <= 0.05).length;
    const fp = res.rows.filter((r, i) => !isPlanted[i] && r.fdr <= 0.05).length;
    expect(res.tested).toBeGreaterThan(500);
    expect(auc).toBeGreaterThan(0.9);
    expect(tp).toBeGreaterThanOrEqual(25);
    expect(fp).toBeLessThanOrEqual(5);
  });
});
