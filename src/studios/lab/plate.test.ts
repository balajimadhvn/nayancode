import { describe, expect, it } from 'vitest';
import { analysePlate, buildCurve, demoPlate, parseGrid, replicateStats, type Replicate } from './plate';

const std = (c: number, y: number): Replicate => ({ label: `std:${c}`, kind: 'std', concentration: c, n: 3, mean: y, sd: 0, cv: 0 });
const fourPl = (x: number) => 0.05 + 1.85 / (1 + (12 / x) ** 1.1);
const CONCS = [1, 2, 4, 8, 16, 32, 64];

describe('replicate statistics', () => {
  it('computes the CV of [1.0, 1.1, 0.9] as 10 %', () => {
    const s = replicateStats([1.0, 1.1, 0.9]);
    expect(s.mean).toBeCloseTo(1.0, 12);
    expect(s.sd).toBeCloseTo(0.1, 12);
    expect(s.cv).toBeCloseTo(10, 12);
  });
});

describe('plate standard curve', () => {
  it('back-calculates a 4PL concentration to 1e-6 from noise-free standards', () => {
    const curve = buildCurve(CONCS.map((c) => std(c, fourPl(c))), '4PL');
    expect(Math.abs(curve.invert(fourPl(12.5)) - 12.5)).toBeLessThan(1e-6);
    expect(curve.r2).toBeGreaterThan(1 - 1e-10);
  });

  it('inverts a linear standard curve exactly', () => {
    const curve = buildCurve([std(1, 0.2), std(2, 0.4), std(4, 0.8), std(8, 1.6)], 'linear');
    expect(curve.invert(0.6)).toBeCloseTo(3, 9);
  });

  it('needs enough standards and rejects a useless linear fit', () => {
    expect(() => buildCurve([std(1, 1)], '4PL')).toThrow(/at least 4/);
    expect(() => buildCurve([std(1, 0.5), std(2, 0.5)], 'linear')).toThrow(/zero slope/);
  });
});

/** Two-row plate: blanks and standards on row A, unknowns on row B. */
function plateWith(unknown: number[], blanks: number[] = [0.048, 0.052, 0.05]) {
  const cols = 3 + CONCS.length, rows: (number | '')[][] = [[], []];
  const layout: string[][] = [[], []];
  for (let c = 0; c < cols; c++) {
    if (c < blanks.length) { rows[0].push(blanks[c]); layout[0].push('blank'); }
    else if (c - blanks.length < CONCS.length) { const i = c - blanks.length; rows[0].push(fourPl(CONCS[i])); layout[0].push(`std:${CONCS[i]}`); }
    else { rows[0].push(''); layout[0].push(''); }
    if (c < unknown.length) { rows[1].push(unknown[c]); layout[1].push('unk:Test:2'); }
    else { rows[1].push(''); layout[1].push(''); }
  }
  const fmt = (g: (number | string)[][]) => g.map((r) => r.map((v) => (typeof v === 'number' && !Number.isFinite(v) ? '' : String(v))).join(',')).join('\n');
  return { plate: fmt(rows as unknown as (number | string)[][]), layout: fmt(layout) };
}

describe('analysePlate', () => {
  it('subtracts the blank, groups replicates and applies the dilution', () => {
    const { plate, layout } = plateWith([1.0, 1.1, 0.9]);
    const res = analysePlate(plate, layout);
    expect(res.blank.n).toBe(3);
    expect(res.blank.mean).toBeCloseTo(0.05, 12);
    expect(res.blank.sd).toBeCloseTo(0.002, 12);
    const unk = res.unknowns[0];
    expect(unk.n).toBe(3);
    expect(unk.cv).toBeCloseTo((0.1 / 0.95) * 100, 9);
    expect(unk.conc).toBeCloseTo(unk.concRaw * 2, 12);
    expect(unk.outOfRange).toBe(false);
    expect(unk.belowLod).toBe(false);
  });

  it('computes LOD and LOQ in concentration units from the blank SD', () => {
    const { plate, layout } = plateWith([1.0, 1.1, 0.9]);
    const res = analysePlate(plate, layout);
    expect(res.lod).toBeCloseTo(res.curve.invert(0.05 + 3 * 0.002), 9);
    expect(res.loq).toBeCloseTo(res.curve.invert(0.05 + 10 * 0.002), 9);
  });

  it('flags an absorbance outside the standard range', () => {
    const { plate, layout } = plateWith([3, 3.1, 2.9]);
    const res = analysePlate(plate, layout);
    expect(res.unknowns[0].outOfRange).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/outside the standard range/);
  });

  it('flags a replicate CV above 15 %', () => {
    const { plate, layout } = plateWith([1, 2, 0.5]);
    const res = analysePlate(plate, layout);
    expect(res.unknowns[0].cv).toBeGreaterThan(15);
    expect(res.warnings.join(' ')).toMatch(/CV above 15/);
  });

  it('gives a clear error when the plate and layout shapes differ', () => {
    expect(() => analysePlate('1,2,3\n4,5,6', 'blank,std:1,std:2')).toThrow(/same shape/);
  });

  it('analyses the demo plate', () => {
    const d = demoPlate();
    const res = analysePlate(d.plate, d.layout);
    expect(res.curve.model).toBe('4PL');
    expect(res.unknowns).toHaveLength(3);
    expect(res.unknowns.every((u) => u.conc > 0)).toBe(true);
    expect(parseGrid(d.plate)[0][0]).toBeCloseTo(0.048, 9);
  });
});
